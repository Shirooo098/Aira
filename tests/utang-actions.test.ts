import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeSqliteAdapter } from '../src/db/node-sqlite-adapter.ts';
import { runMigrations } from '../src/db/migrations.ts';
import { saveProduct } from '../src/actions/catalog-actions.ts';
import { setStockCount, getStockLevel, getInventoryHistory } from '../src/actions/inventory-actions.ts';
import {
  createCustomer,
  getCustomers,
  getCustomerById,
  recordOpeningBalance,
  completeCreditSale,
  getCustomerLedger,
} from '../src/actions/utang-actions.ts';
import {
  CustomerValidationError,
  CreditValidationError,
} from '../src/domain/utang.ts';
import {
  SaleValidationError,
  InsufficientStockError,
} from '../src/domain/sales.ts';

test('customer creation distinguishes duplicate names using unique IDs and distinguishing notes', async (t) => {
  const syncDb = new DatabaseSync(':memory:');
  t.after(() => syncDb.close());
  const db = new NodeSqliteAdapter(syncDb);
  await runMigrations(db);

  const customer1 = await createCustomer(db, {
    name: 'Mang Jose',
    nickname: 'Jose',
    note: 'tapat ng tindahan',
  });

  const customer2 = await createCustomer(db, {
    name: 'Mang Jose',
    nickname: 'Jose',
    note: 'kapitbahay sa kanto',
  });

  assert.notEqual(customer1.id, customer2.id);
  assert.equal(customer1.name, 'Mang Jose');
  assert.equal(customer1.note, 'tapat ng tindahan');
  assert.equal(customer2.name, 'Mang Jose');
  assert.equal(customer2.note, 'kapitbahay sa kanto');

  const all = await getCustomers(db);
  assert.equal(all.length, 2);

  // Rejects empty or invalid customer name
  await assert.rejects(
    createCustomer(db, { name: '   ' }),
    CustomerValidationError
  );
});

test('opening balance creates debt without creating sales or altering inventory, retains null date honestly', async (t) => {
  const syncDb = new DatabaseSync(':memory:');
  t.after(() => syncDb.close());
  const db = new NodeSqliteAdapter(syncDb);
  await runMigrations(db);

  const product = await saveProduct(db, {
    name: 'Lucky Me Pancit Canton',
    variant: 'Original 80g',
    unit: 'pack',
    priceCentavos: 1800,
  });
  await setStockCount(db, { productId: product.id, newQuantity: 50 });

  const customer = await createCustomer(db, {
    name: 'Aling Nena',
  });

  // Record opening balance with unknown date
  const entry = await recordOpeningBalance(db, {
    customerId: customer.id,
    amountCentavos: 35000, // ₱350.00
    description: 'Utang Bago Nag-Aira',
    originalDate: null,
  });

  assert.equal(entry.customerId, customer.id);
  assert.equal(entry.entryType, 'opening_balance');
  assert.equal(entry.saleId, null);
  assert.equal(entry.originalAmountCentavos, 35000);
  assert.equal(entry.remainingAmountCentavos, 35000);
  assert.equal(entry.originalDate, null);
  assert.equal(entry.description, 'Utang Bago Nag-Aira');

  // Verify NO sales were created
  const sales = await db.getAll('SELECT * FROM sales;');
  assert.equal(sales.length, 0);

  // Verify stock was NOT altered
  const stock = await getStockLevel(db, product.id);
  assert.equal(stock?.quantity, 50);

  // Verify inventory movements are untouched (only set_count)
  const history = await getInventoryHistory(db, product.id);
  assert.equal(history.length, 1);
  assert.equal(history[0]?.movementType, 'set_count');

  // Verify customer balance reflects opening balance
  const customerWithBal = await getCustomerById(db, customer.id);
  assert.equal(customerWithBal?.totalDebtCentavos, 35000);
  assert.equal(customerWithBal?.activeCreditCount, 1);

  // Test opening balance with specific historic date string
  const entryWithDate = await recordOpeningBalance(db, {
    customerId: customer.id,
    amountCentavos: 15000,
    description: 'Bale noong Agosto',
    originalDate: '2026-08-15',
  });
  assert.equal(entryWithDate.originalDate, '2026-08-15');

  const updatedCustomer = await getCustomerById(db, customer.id);
  assert.equal(updatedCustomer?.totalDebtCentavos, 50000);
  assert.equal(updatedCustomer?.activeCreditCount, 2);

  // Rejects non-positive opening balance
  await assert.rejects(
    recordOpeningBalance(db, { customerId: customer.id, amountCentavos: 0 }),
    CreditValidationError
  );
  await assert.rejects(
    recordOpeningBalance(db, { customerId: customer.id, amountCentavos: -500 }),
    CreditValidationError
  );
});

test('fully unpaid sale (0 paid) records full credit and stock deductions', async (t) => {
  const syncDb = new DatabaseSync(':memory:');
  t.after(() => syncDb.close());
  const db = new NodeSqliteAdapter(syncDb);
  await runMigrations(db);

  const coke = await saveProduct(db, {
    name: 'Coke',
    variant: '1.5L',
    unit: 'bote',
    priceCentavos: 7000,
  });
  await setStockCount(db, { productId: coke.id, newQuantity: 10 });

  const customer = await createCustomer(db, { name: 'Kuya Cardo' });

  const result = await completeCreditSale(db, {
    customerId: customer.id,
    items: [{ productId: coke.id, quantity: 2 }],
    paidCentavos: 0,
    paymentMethod: 'cash',
  });

  assert.equal(result.sale.totalCentavos, 14000);
  assert.equal(result.sale.paidCentavos, 0);
  assert.equal(result.sale.creditCentavos, 14000);
  assert.equal(result.sale.customerId, customer.id);

  assert.ok(result.creditEntry);
  assert.equal(result.creditEntry?.customerId, customer.id);
  assert.equal(result.creditEntry?.entryType, 'sale_credit');
  assert.equal(result.creditEntry?.saleId, result.sale.id);
  assert.equal(result.creditEntry?.originalAmountCentavos, 14000);
  assert.equal(result.creditEntry?.remainingAmountCentavos, 14000);

  // Stock deducted
  const stock = await getStockLevel(db, coke.id);
  assert.equal(stock?.quantity, 8);

  const history = await getInventoryHistory(db, coke.id);
  assert.equal(history[0]?.movementType, 'sale_deduction');
  assert.equal(history[0]?.quantityDelta, -2);
  assert.equal(history[0]?.newQuantity, 8);

  // Customer debt
  const customerBal = await getCustomerById(db, customer.id);
  assert.equal(customerBal?.totalDebtCentavos, 14000);
  assert.equal(customerBal?.activeCreditCount, 1);
});

test('partially paid sale (paid > 0) records paid centavos, unpaid remainder, and stock deductions', async (t) => {
  const syncDb = new DatabaseSync(':memory:');
  t.after(() => syncDb.close());
  const db = new NodeSqliteAdapter(syncDb);
  await runMigrations(db);

  const bigas = await saveProduct(db, {
    name: 'Sinandomeng',
    variant: '1kg',
    unit: 'kilo',
    priceCentavos: 5200,
  });
  await setStockCount(db, { productId: bigas.id, newQuantity: 20 });

  const customer = await createCustomer(db, { name: 'Ate Lorna' });

  // 2 kilos = 10400 centavos (₱104.00), pays ₱50.00 cash (5000 centavos), remaining ₱54.00 (5400 centavos)
  const result = await completeCreditSale(db, {
    customerId: customer.id,
    items: [{ productId: bigas.id, quantity: 2 }],
    paidCentavos: 5000,
    paymentMethod: 'cash',
  });

  assert.equal(result.sale.totalCentavos, 10400);
  assert.equal(result.sale.paidCentavos, 5000);
  assert.equal(result.sale.creditCentavos, 5400);

  assert.ok(result.creditEntry);
  assert.equal(result.creditEntry?.originalAmountCentavos, 5400);
  assert.equal(result.creditEntry?.remainingAmountCentavos, 5400);

  // Stock deducted
  const stock = await getStockLevel(db, bigas.id);
  assert.equal(stock?.quantity, 18);

  // Partially paid via GCash with reference number
  const sardinas = await saveProduct(db, {
    name: 'Mega Sardines',
    variant: '155g Red',
    unit: 'lata',
    priceCentavos: 2500,
  });
  await setStockCount(db, { productId: sardinas.id, newQuantity: 10 });

  // 4 cans = 10000 centavos, pays 8000 via GCash
  const gcashResult = await completeCreditSale(db, {
    customerId: customer.id,
    items: [{ productId: sardinas.id, quantity: 4 }],
    paidCentavos: 8000,
    paymentMethod: 'gcash',
    gcashReference: 'GCASH-REF-8899',
  });

  assert.equal(gcashResult.sale.paymentMethod, 'gcash');
  assert.equal(gcashResult.sale.referenceNumber, 'GCASH-REF-8899');
  assert.equal(gcashResult.sale.paidCentavos, 8000);
  assert.equal(gcashResult.sale.creditCentavos, 2000);

  const customerBal = await getCustomerById(db, customer.id);
  assert.equal(customerBal?.totalDebtCentavos, 5400 + 2000); // 7400
  assert.equal(customerBal?.activeCreditCount, 2);
});

test('fully paid sale via completeCreditSale records 0 credit entry', async (t) => {
  const syncDb = new DatabaseSync(':memory:');
  t.after(() => syncDb.close());
  const db = new NodeSqliteAdapter(syncDb);
  await runMigrations(db);

  const item = await saveProduct(db, {
    name: 'Chippy',
    variant: 'Red 110g',
    unit: 'pack',
    priceCentavos: 3500,
  });
  await setStockCount(db, { productId: item.id, newQuantity: 10 });
  const customer = await createCustomer(db, { name: 'Ben' });

  const result = await completeCreditSale(db, {
    customerId: customer.id,
    items: [{ productId: item.id, quantity: 1 }],
    paidCentavos: 3500,
    paymentMethod: 'cash',
  });

  assert.equal(result.sale.creditCentavos, 0);
  assert.equal(result.creditEntry, null);

  const customerBal = await getCustomerById(db, customer.id);
  assert.equal(customerBal?.totalDebtCentavos, 0);
  assert.equal(customerBal?.activeCreditCount, 0);
});

test('stock insufficiency or uncounted stock blocks credit sale without modifying state', async (t) => {
  const syncDb = new DatabaseSync(':memory:');
  t.after(() => syncDb.close());
  const db = new NodeSqliteAdapter(syncDb);
  await runMigrations(db);

  const p1 = await saveProduct(db, {
    name: 'Kape',
    variant: 'Nescafe 3in1',
    unit: 'sachet',
    priceCentavos: 1200,
  });
  // p1 stock is uncounted (null)

  const p2 = await saveProduct(db, {
    name: 'Asukal',
    variant: 'White 1/4kg',
    unit: 'pack',
    priceCentavos: 2500,
  });
  await setStockCount(db, { productId: p2.id, newQuantity: 2 });

  const customer = await createCustomer(db, { name: 'Aling Tess' });

  // Test uncounted stock fails
  await assert.rejects(
    completeCreditSale(db, {
      customerId: customer.id,
      items: [{ productId: p1.id, quantity: 1 }],
      paidCentavos: 0,
      paymentMethod: 'cash',
    }),
    InsufficientStockError
  );

  // Test insufficient stock fails (demands 5, only 2 available)
  await assert.rejects(
    completeCreditSale(db, {
      customerId: customer.id,
      items: [{ productId: p2.id, quantity: 5 }],
      paidCentavos: 0,
      paymentMethod: 'cash',
    }),
    InsufficientStockError
  );

  // Verify stock unchanged
  const stock2 = await getStockLevel(db, p2.id);
  assert.equal(stock2?.quantity, 2);

  // Verify no sales or credit entries created
  const sales = await db.getAll('SELECT * FROM sales;');
  assert.equal(sales.length, 0);
  const credits = await db.getAll('SELECT * FROM credit_entries;');
  assert.equal(credits.length, 0);
});

test('customer ledger retrieves credit entries and associated sales in order', async (t) => {
  const syncDb = new DatabaseSync(':memory:');
  t.after(() => syncDb.close());
  const db = new NodeSqliteAdapter(syncDb);
  await runMigrations(db);

  const customer = await createCustomer(db, { name: 'Tatay Berting' });

  await recordOpeningBalance(db, {
    customerId: customer.id,
    amountCentavos: 10000,
    description: 'Dating utang',
  });

  const tinapay = await saveProduct(db, {
    name: 'Monay',
    variant: 'Special',
    unit: 'piraso',
    priceCentavos: 500,
  });
  await setStockCount(db, { productId: tinapay.id, newQuantity: 50 });

  await completeCreditSale(db, {
    customerId: customer.id,
    items: [{ productId: tinapay.id, quantity: 10 }],
    paidCentavos: 2000,
    paymentMethod: 'cash',
  });

  const ledger = await getCustomerLedger(db, customer.id);
  assert.equal(ledger.customer.id, customer.id);
  assert.equal(ledger.customer.totalDebtCentavos, 10000 + 3000); // 13000
  assert.equal(ledger.customer.activeCreditCount, 2);
  assert.equal(ledger.creditEntries.length, 2);
  assert.equal(ledger.sales.length, 1);
  assert.equal(ledger.sales[0]?.items.length, 1);
});

test('idempotency key prevents duplicate credit sales and duplicate inventory deductions', async (t) => {
  const syncDb = new DatabaseSync(':memory:');
  t.after(() => syncDb.close());
  const db = new NodeSqliteAdapter(syncDb);
  await runMigrations(db);

  const sabon = await saveProduct(db, {
    name: 'Safeguard',
    variant: 'White 135g',
    unit: 'bar',
    priceCentavos: 4500,
  });
  await setStockCount(db, { productId: sabon.id, newQuantity: 10 });
  const customer = await createCustomer(db, { name: 'Grace' });

  const params = {
    customerId: customer.id,
    items: [{ productId: sabon.id, quantity: 2 }],
    paidCentavos: 1000,
    paymentMethod: 'cash' as const,
    idempotencyKey: 'credit-idemp-001',
  };

  const firstCall = await completeCreditSale(db, params);
  const secondCall = await completeCreditSale(db, params);

  assert.equal(firstCall.sale.id, secondCall.sale.id);
  assert.equal(firstCall.creditEntry?.id, secondCall.creditEntry?.id);

  // Stock deduction should happen only once (10 - 2 = 8)
  const stock = await getStockLevel(db, sabon.id);
  assert.equal(stock?.quantity, 8);

  const sales = await db.getAll('SELECT * FROM sales;');
  assert.equal(sales.length, 1);

  const credits = await db.getAll('SELECT * FROM credit_entries;');
  assert.equal(credits.length, 1);
});

test('persists customer credit, ledger, and inventory state across SQLite restart on real file', async (t) => {
  const tempDir = mkdtempSync(join(tmpdir(), 'aira-utang-test-'));
  const dbPath = join(tempDir, 'aira.db');

  try {
    // Phase 1: Setup and credit sale
    {
      const syncDb = new DatabaseSync(dbPath);
      const db = new NodeSqliteAdapter(syncDb);
      await runMigrations(db);

      const customer = await createCustomer(db, {
        name: 'Nanay Gloria',
        nickname: 'Glo',
        note: 'katapat ng baranggay hall',
      });

      await recordOpeningBalance(db, {
        customerId: customer.id,
        amountCentavos: 25000,
        originalDate: null,
      });

      const kape = await saveProduct(db, {
        name: 'Great Taste White',
        variant: 'Twin Pack 50g',
        unit: 'sachet',
        priceCentavos: 1400,
      });
      await setStockCount(db, { productId: kape.id, newQuantity: 20 });

      await completeCreditSale(db, {
        customerId: customer.id,
        items: [{ productId: kape.id, quantity: 5 }],
        paidCentavos: 2000,
        paymentMethod: 'cash',
      });

      syncDb.close();
    }

    // Phase 2: Reopen from disk and verify persistence
    {
      const syncDb = new DatabaseSync(dbPath);
      const db = new NodeSqliteAdapter(syncDb);

      const customers = await getCustomers(db);
      assert.equal(customers.length, 1);
      assert.equal(customers[0]?.name, 'Nanay Gloria');
      assert.equal(customers[0]?.totalDebtCentavos, 25000 + (7000 - 2000)); // 30000 centavos
      assert.equal(customers[0]?.activeCreditCount, 2);

      const ledger = await getCustomerLedger(db, customers[0]!.id);
      assert.equal(ledger.creditEntries.length, 2);
      assert.equal(ledger.sales.length, 1);
      assert.equal(ledger.sales[0]?.paidCentavos, 2000);
      assert.equal(ledger.sales[0]?.creditCentavos, 5000);

      // Inventory check
      const movements = await db.getAll<{ movement_type: string; new_quantity: number }>(
        'SELECT movement_type, new_quantity FROM inventory_movements ORDER BY rowid ASC;'
      );
      assert.equal(movements.length, 2);
      assert.equal(movements[0]?.movement_type, 'set_count');
      assert.equal(movements[0]?.new_quantity, 20);
      assert.equal(movements[1]?.movement_type, 'sale_deduction');
      assert.equal(movements[1]?.new_quantity, 15);

      syncDb.close();
    }
  } finally {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});
