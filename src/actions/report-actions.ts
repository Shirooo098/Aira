import type { DatabaseSession } from '../db/database.ts';
import {
  calculatePeriodRange,
  type ReportPeriodKey,
  type StoreReport,
  type TopSellingProduct,
} from '../domain/reports.ts';

export interface ReportQueryOptions {
  periodKey: ReportPeriodKey;
  evaluationDate?: Date | string;
  selectedPriorMonthOffset?: number;
}

interface SalesMetricsRow {
  net_sales_centavos: number;
  cancelled_sales_centavos: number;
  gross_sales_centavos: number;
  sales_count: number;
  cancelled_sales_count: number;
  new_credit_centavos: number;
}

interface SingleValueRow {
  val: number;
}

interface TopProductRow {
  product_id: string;
  product_name: string;
  variant: string;
  unit: string;
  units_sold: number;
  revenue_centavos: number;
}

/**
 * Computes the store performance report for the selected calendar period.
 * Strictly read-only; executes zero database writes.
 * Follows the attribution model in docs/REVERSAL-REPORT-ATTRIBUTION.md.
 */
export async function getStoreReport(
  db: DatabaseSession,
  options: ReportQueryOptions
): Promise<StoreReport> {
  const period = calculatePeriodRange(
    options.periodKey,
    options.evaluationDate,
    options.selectedPriorMonthOffset
  );

  const startIso = period.startUtcIso;
  const endIso = period.endUtcIso;

  // 1. Sales metrics (active vs cancelled)
  const salesRows = await db.getAll<SalesMetricsRow>(
    `SELECT
       COALESCE(SUM(CASE WHEN status != 'cancelled' THEN total_centavos ELSE 0 END), 0) AS net_sales_centavos,
       COALESCE(SUM(CASE WHEN status = 'cancelled' THEN total_centavos ELSE 0 END), 0) AS cancelled_sales_centavos,
       COALESCE(SUM(total_centavos), 0) AS gross_sales_centavos,
       COALESCE(SUM(CASE WHEN status != 'cancelled' THEN 1 ELSE 0 END), 0) AS sales_count,
       COALESCE(SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END), 0) AS cancelled_sales_count,
       COALESCE(SUM(CASE WHEN status != 'cancelled' THEN credit_centavos ELSE 0 END), 0) AS new_credit_centavos
     FROM sales
     WHERE created_at >= ? AND created_at <= ?;`,
    [startIso, endIso]
  );
  const salesMetrics = salesRows[0] ?? {
    net_sales_centavos: 0,
    cancelled_sales_centavos: 0,
    gross_sales_centavos: 0,
    sales_count: 0,
    cancelled_sales_count: 0,
    new_credit_centavos: 0,
  };

  // 2. Cash collections: active cash sales + non-reversed cash repayments
  const cashSalesRows = await db.getAll<SingleValueRow>(
    `SELECT COALESCE(SUM(
       CASE
         WHEN credit_centavos > 0 THEN paid_centavos
         ELSE total_centavos
       END
     ), 0) AS val
     FROM sales
     WHERE payment_method = 'cash'
       AND status != 'cancelled'
       AND created_at >= ? AND created_at <= ?;`,
    [startIso, endIso]
  );
  const cashRepayRows = await db.getAll<SingleValueRow>(
    `SELECT COALESCE(SUM(amount_centavos), 0) AS val
     FROM credit_repayments
     WHERE payment_method = 'cash'
       AND (status IS NULL OR status != 'reversed')
       AND created_at >= ? AND created_at <= ?;`,
    [startIso, endIso]
  );
  // 3. GCash collections: active GCash sales + non-reversed GCash repayments
  const gcashSalesRows = await db.getAll<SingleValueRow>(
    `SELECT COALESCE(SUM(
       CASE
         WHEN credit_centavos > 0 THEN paid_centavos
         ELSE total_centavos
       END
     ), 0) AS val
     FROM sales
     WHERE payment_method = 'gcash'
       AND status != 'cancelled'
       AND created_at >= ? AND created_at <= ?;`,
    [startIso, endIso]
  );
  const gcashRepayRows = await db.getAll<SingleValueRow>(
    `SELECT COALESCE(SUM(amount_centavos), 0) AS val
     FROM credit_repayments
     WHERE payment_method = 'gcash'
       AND (status IS NULL OR status != 'reversed')
       AND created_at >= ? AND created_at <= ?;`,
    [startIso, endIso]
  );
  const collectionBreakdown = {
    cashSalesCentavos: cashSalesRows[0]?.val ?? 0,
    cashRepaymentsCentavos: cashRepayRows[0]?.val ?? 0,
    gcashSalesCentavos: gcashSalesRows[0]?.val ?? 0,
    gcashRepaymentsCentavos: gcashRepayRows[0]?.val ?? 0,
  };
  const cashCollectionsCentavos =
    collectionBreakdown.cashSalesCentavos + collectionBreakdown.cashRepaymentsCentavos;
  const gcashCollectionsCentavos =
    collectionBreakdown.gcashSalesCentavos + collectionBreakdown.gcashRepaymentsCentavos;

  const totalCollectionsCentavos =
    cashCollectionsCentavos + gcashCollectionsCentavos;

  // 4. Current Outstanding Credit (as of now)
  const outstandingRows = await db.getAll<SingleValueRow>(
    `SELECT COALESCE(SUM(remaining_amount_centavos), 0) AS val
     FROM credit_entries
     WHERE (status IS NULL OR status != 'cancelled')
       AND remaining_amount_centavos > 0;`
  );
  const currentOutstandingCreditCentavos = outstandingRows[0]?.val ?? 0;

  // 5. Stock Now (as of now, excluding uncounted nulls)
  const stockRows = await db.getAll<SingleValueRow>(
    `SELECT COALESCE(SUM(quantity), 0) AS val
     FROM stock_levels
     WHERE quantity IS NOT NULL;`
  );
  const stockNowUnits = stockRows[0]?.val ?? 0;

  // 6. Top Selling Products in period
  const topRows = await db.getAll<TopProductRow>(
    `SELECT
       p.id AS product_id,
       p.name AS product_name,
       p.variant,
       p.unit,
       COALESCE(SUM(si.quantity), 0) AS units_sold,
       COALESCE(SUM(si.subtotal_centavos), 0) AS revenue_centavos
     FROM sale_items si
     JOIN sales s ON si.sale_id = s.id
     JOIN products p ON si.product_id = p.id
     WHERE s.status != 'cancelled'
       AND s.created_at >= ? AND s.created_at <= ?
     GROUP BY p.id, p.name, p.variant, p.unit
     ORDER BY units_sold DESC, revenue_centavos DESC;`,
    [startIso, endIso]
  );

  const topProducts: TopSellingProduct[] = topRows.map((r) => ({
    productId: r.product_id,
    productName: r.product_name,
    variant: r.variant,
    unit: r.unit,
    unitsSold: r.units_sold,
    revenueCentavos: r.revenue_centavos,
  }));

  return {
    period,
    asOfUtcIso: new Date().toISOString(),
    netSalesCentavos: salesMetrics.net_sales_centavos,
    grossSalesCentavos: salesMetrics.gross_sales_centavos,
    cancelledSalesCentavos: salesMetrics.cancelled_sales_centavos,
    salesCount: salesMetrics.sales_count,
    cancelledSalesCount: salesMetrics.cancelled_sales_count,
    collectionBreakdown,
    cashCollectionsCentavos,
    gcashCollectionsCentavos,
    totalCollectionsCentavos,
    newCreditCentavos: salesMetrics.new_credit_centavos,
    currentOutstandingCreditCentavos,
    stockNowUnits,
    topProducts,
  };
}
