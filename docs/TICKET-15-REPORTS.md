# Ticket #15 — Store Reports Across Calendar Periods

Prepared: 2026-10-10. Owner: Developer 4 (App Shell, OCR & Integration Lead).
Target Issue: [#15](https://github.com/Shirooo098/Aira/issues/15).
Attribution Baseline: [docs/REVERSAL-REPORT-ATTRIBUTION.md](REVERSAL-REPORT-ATTRIBUTION.md).

---

## 1. Executive Summary

Ticket #15 implements on-device, offline financial and inventory performance reporting for Aira store owners on the Oppo Reno6 Z 5G.
Store owners can view accurate summaries of sales, collections, credit, and product rankings across key Philippine calendar periods (Today, Monday-start Week, Month, current plus preceding 5 months, and Year), all ending at the current evaluation timestamp (`now`).

---

## 2. Calendar Periods & Boundary Definitions (Asia/Manila, UTC+8)

All period calculations are evaluated in **Asia/Manila (UTC+8)** Standard Time and end at `now`:

| Period Identifier | Filipino Label | Start Boundary (Manila Midnight 00:00:00) | End Boundary |
|---|---|---|---|
| `today` | Ngayong Araw | Midnight (00:00:00) of current Manila calendar day | Current evaluation timestamp (`now`) |
| `week` | Linggong Ito | Monday 00:00:00 of current Manila week (Monday-start) | Current evaluation timestamp (`now`) |
| `month` | Buwang Ito | 1st day 00:00:00 of current Manila calendar month | Current evaluation timestamp (`now`) |
| `six_months` | Huling 6 na Buwan | 1st day 00:00:00 of month 5 months before current month | Current evaluation timestamp (`now`) |
| `prior_month` | Bawat Nakaraang Buwan | 1st day 00:00:00 of selected historical month | End of selected month (or `now` if current) |
| `year` | Taong Ito | January 1 00:00:00 of current Manila year | Current evaluation timestamp (`now`) |

- **Midnight Crossing**: `16:00:00 UTC` corresponds to `00:00:00` in Manila. Crossing `16:00:00 UTC` rolls into the next Manila day.
- **Monday-start Week**: Sunday is day 7 of the week; Monday is day 1.

---

## 3. Metrics & Query Attribution Specification

Following the D3 attribution baseline in [`docs/REVERSAL-REPORT-ATTRIBUTION.md`](REVERSAL-REPORT-ATTRIBUTION.md):

### 3.1 Net Sales vs. Gross Sales
- **Net Sales (`netSalesCentavos`)**:
  $$\sum \text{total\_centavos} \quad \text{for } \text{sales where } \text{status} \ne \text{'cancelled'} \text{ and } \text{created\_at} \in [\text{start}, \text{end}]$$
- **Cancelled Sales (`cancelledSalesCentavos`)**:
  $$\sum \text{total\_centavos} \quad \text{for } \text{sales where } \text{status} = \text{'cancelled'} \text{ and } \text{created\_at} \in [\text{start}, \text{end}]$$
- **Gross Sales (`grossSalesCentavos`)**: $\text{Net Sales} + \text{Cancelled Sales}$.
- **Sales Count (`salesCount`)**: Count of active sales; cancelled sales count is tracked separately (`cancelledSalesCount`).

### 3.2 Collections (Cash and GCash)
- **Cash Collections (`cashCollectionsCentavos`)**:
  - Cash Tendered in active sales: $\text{paid\_centavos}$ from sales where `payment_method = 'cash'`, `status != 'cancelled'`.
  - Cash Repayments: $\text{amount\_centavos}$ from `credit_repayments` where `payment_method = 'cash'`, `status != 'reversed'`.
- **GCash Collections (`gcashCollectionsCentavos`)**:
  - Confirmed GCash in active sales: $\text{paid\_centavos}$ from sales where `payment_method = 'gcash'`, `status != 'cancelled'`.
  - GCash Repayments: $\text{amount\_centavos}$ from `credit_repayments` where `payment_method = 'gcash'`, `status != 'reversed'`.
- **Total Collections (`totalCollectionsCentavos`)**: $\text{Cash Collections} + \text{GCash Collections}$.
- **Repayments are NOT New Sales**: Repayments reduce customer credit debts; they are accounted for under collections, never double-counted as new retail sales.

### 3.3 Credit Metrics
- **New Credit Issued (`newCreditCentavos`)**:
  - Sum of $\text{credit\_centavos}$ from active sales created during the period.
- **Current Outstanding Credit (`currentCreditCentavos`)**:
  - Snapshot sum of all `remaining_amount_centavos` across all active `credit_entries` where `status = 'active'` as of the query moment. Labeled explicitly as *"Kasalukuyang Pautang (Current Credit)"*.

### 3.4 Inventory ("Stock Now")
- **Stock Now (`stockNowUnits`)**:
  - Total physical units on hand summed from `stock_levels` where `quantity IS NOT NULL`. Labeled explicitly as *"Stock now (Kasalukuyang Imbentaryo)"*. Uncounted products remain omitted from the sum.

### 3.5 Top Selling Products (Units Sold Ranking)
- Joins `sale_items` with active sales created within the period.
- Computes `unitsSold` and `revenueCentavos` per product identity (`productId`, `name`, `variant`, `unit`).
- Ranked by `unitsSold DESC`, then `revenueCentavos DESC`.

---

## 4. Invariants & Guardrails

1. **No Unsupported Profit Claims**: Store owners do not enter wholesale acquisition cost prices in this version. The report states total sales and collections truthfully and never manufactures estimated margin or profit.
2. **Honest Empty / Partial History**: If a store has no transactions in a period, the report displays ₱0.00 and 0 units clearly without errors or mock data.
3. **Integer Centavos**: All monetary operations use integer centavos without floating-point math.
4. **Offline First**: All queries execute against local SQLite on the phone; zero cloud or network dependencies.
