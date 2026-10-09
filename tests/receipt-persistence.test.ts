import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { NodeSqliteAdapter } from '../src/db/node-sqlite-adapter.ts';
import { runMigrations } from '../src/db/migrations.ts';
import { saveProduct } from '../src/actions/catalog-actions.ts';
import { setStockCount, getStockLevel } from '../src/actions/inventory-actions.ts';
import {
  createPendingGcashDraft,
  confirmGcashSale,
  getSaleById,
} from '../src/actions/sales-actions.ts';
import {
  attachReceipt,
  getReceiptAttachment,
  getReceiptAttachmentById,
  searchReceiptAttachments,
  deleteReceiptAttachment,
  ReceiptValidationError,
} from '../src/actions/receipt-actions.ts';

test('attaches receipt to pending GCash draft and transfers to confirmed sale atomically', async (t) => {
  const syncDb = new DatabaseSync(':memory:');
  t.after(() => syncDb.close());
  const db = new NodeSqliteAdapter(syncDb);
  await runMigrations(db);

  const product = await saveProduct(db, {
    name: 'Sari-sari Load',
    variant: '100',
    unit: 'load',
    priceCentavos: 10000,
  });
  await setStockCount(db, { productId: product.id, newQuantity: 50 });

  // 1. Create a pending draft
  const draft = await createPendingGcashDraft(db, {
    items: [{ productId: product.id, quantity: 1 }],
  });

  // 2. Attach receipt to pending draft
  const attachment = await attachReceipt(db, {
    targetKind: 'pending_draft',
    targetId: draft.id,
    imagePath: 'file:///data/user/0/aira/receipts/rcpt-001.jpg',
    amountCentavos: 10000,
    referenceNumber: '1002 9847 1234',
    senderName: 'JUAN DELA CRUZ',
    senderMobile: '0917 *** 4567',
    rawText: 'Amount: 100.00\nRef: 1002 9847 1234\nSender: JUAN DELA CRUZ',
  });

  assert.equal(attachment.targetKind, 'pending_draft');
  assert.equal(attachment.targetId, draft.id);
  assert.equal(attachment.amountCentavos, 10000);
  assert.equal(attachment.referenceNumber, '1002 9847 1234');
  assert.equal(attachment.senderName, 'JUAN DELA CRUZ');

  // Verify attachment can be queried for draft
  const fetchedForDraft = await getReceiptAttachment(db, 'pending_draft', draft.id);
  assert.notEqual(fetchedForDraft, null);
  assert.equal(fetchedForDraft?.id, attachment.id);

  // 3. Confirm GCash sale from draft
  const sale = await confirmGcashSale(db, {
    draftId: draft.id,
    referenceNumber: '1002 9847 1234',
  });

  // Draft should no longer have the active attachment, it transferred to the sale!
  const draftAttachmentAfter = await getReceiptAttachment(db, 'pending_draft', draft.id);
  assert.equal(draftAttachmentAfter, null);

  // Sale now holds the attachment!
  const saleAttachment = await getReceiptAttachment(db, 'sale', sale.id);
  assert.notEqual(saleAttachment, null);
  assert.equal(saleAttachment?.id, attachment.id);
  assert.equal(saleAttachment?.targetKind, 'sale');
  assert.equal(saleAttachment?.targetId, sale.id);
  assert.equal(saleAttachment?.imagePath, 'file:///data/user/0/aira/receipts/rcpt-001.jpg');
});

test('searchReceiptAttachments finds attachments by normalized reference, name, or phone', async (t) => {
  const syncDb = new DatabaseSync(':memory:');
  t.after(() => syncDb.close());
  const db = new NodeSqliteAdapter(syncDb);
  await runMigrations(db);

  const product = await saveProduct(db, {
    name: 'Asukal',
    variant: '1kg',
    unit: 'kilo',
    priceCentavos: 5000,
  });
  await setStockCount(db, { productId: product.id, newQuantity: 10 });

  const sale1 = await confirmGcashSale(db, {
    items: [{ productId: product.id, quantity: 1 }],
    referenceNumber: 'REF-998877',
  });
  const sale2 = await confirmGcashSale(db, {
    items: [{ productId: product.id, quantity: 1 }],
    referenceNumber: 'REF-112233',
  });

  await attachReceipt(db, {
    targetKind: 'sale',
    targetId: sale1.id,
    imagePath: 'file:///data/receipt-1.jpg',
    amountCentavos: 5000,
    referenceNumber: 'REF 998877',
    senderName: 'MARIA SANTOS',
    senderMobile: '0918-123-4567',
  });

  await attachReceipt(db, {
    targetKind: 'sale',
    targetId: sale2.id,
    imagePath: 'file:///data/receipt-2.jpg',
    amountCentavos: 5000,
    referenceNumber: 'REF 112233',
    senderName: 'PEDRO PENDUKO',
    senderMobile: '0920-987-6543',
  });

  // Search by reference ignoring spaces
  const byRef = await searchReceiptAttachments(db, { referenceNumber: 'ref998877' });
  assert.equal(byRef.length, 1);
  assert.equal(byRef[0].senderName, 'MARIA SANTOS');

  // Search by sender name substring
  const byName = await searchReceiptAttachments(db, { senderName: 'maria' });
  assert.equal(byName.length, 1);
  assert.equal(byName[0].referenceNumber, 'REF 998877');

  // Search by mobile ignoring hyphens
  const byMobile = await searchReceiptAttachments(db, { senderMobile: '09209876543' });
  assert.equal(byMobile.length, 1);
  assert.equal(byMobile[0].senderName, 'PEDRO PENDUKO');
});

test('deleteReceiptAttachment removes attachment without modifying sale record or inventory', async (t) => {
  const syncDb = new DatabaseSync(':memory:');
  t.after(() => syncDb.close());
  const db = new NodeSqliteAdapter(syncDb);
  await runMigrations(db);

  const product = await saveProduct(db, {
    name: 'Bigas',
    variant: 'Sinandomeng',
    unit: 'kilo',
    priceCentavos: 6000,
  });
  await setStockCount(db, { productId: product.id, newQuantity: 20 });

  const sale = await confirmGcashSale(db, {
    items: [{ productId: product.id, quantity: 2 }],
  });
  const attachment = await attachReceipt(db, {
    targetKind: 'sale',
    targetId: sale.id,
    imagePath: 'file:///data/receipt-to-delete.jpg',
    amountCentavos: 12000,
  });

  const deleted = await deleteReceiptAttachment(db, attachment.id);
  assert.equal(deleted, true);

  // Attachment is gone
  const lookup = await getReceiptAttachmentById(db, attachment.id);
  assert.equal(lookup, null);

  // Sale still exists intact
  const saleCheck = await getSaleById(db, sale.id);
  assert.notEqual(saleCheck, null);
  assert.equal(saleCheck?.totalCentavos, 12000);

  // Stock deduction still intact (20 - 2 = 18)
  const stock = await getStockLevel(db, product.id);
  assert.equal(stock?.quantity, 18);
});

test('validates target existence and amount safety', async (t) => {
  const syncDb = new DatabaseSync(':memory:');
  t.after(() => syncDb.close());
  const db = new NodeSqliteAdapter(syncDb);
  await runMigrations(db);

  // Non-existent target
  await assert.rejects(
    attachReceipt(db, {
      targetKind: 'sale',
      targetId: 'non-existent-id',
      imagePath: 'file:///data/some.jpg',
    }),
    ReceiptValidationError
  );

  // Missing path
  await assert.rejects(
    attachReceipt(db, {
      targetKind: 'sale',
      targetId: 'some-id',
      imagePath: '',
    }),
    ReceiptValidationError
  );
});

test('persists receipt attachments across SQLite database restart on real file', async (t) => {
  const tempDir = mkdtempSync(join(tmpdir(), 'aira-receipt-test-'));
  const dbPath = join(tempDir, 'receipt-test.sqlite');
  t.after(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  // Session 1: Create sale and attach receipt
  let saleId = '';
  let attachmentId = '';
  {
    const fileDb = new DatabaseSync(dbPath);
    const db = new NodeSqliteAdapter(fileDb);
    await runMigrations(db);

    const product = await saveProduct(db, {
      name: 'Sabon',
      variant: 'Pampaputi',
      unit: 'piraso',
      priceCentavos: 4000,
    });
    await setStockCount(db, { productId: product.id, newQuantity: 15 });

    const sale = await confirmGcashSale(db, {
      items: [{ productId: product.id, quantity: 1 }],
      referenceNumber: 'REF-RESTART-001',
    });
    saleId = sale.id;

    const attachment = await attachReceipt(db, {
      targetKind: 'sale',
      targetId: sale.id,
      imagePath: 'file:///storage/app/receipts/proof-restart.jpg',
      amountCentavos: 4000,
      referenceNumber: 'REF-RESTART-001',
      senderName: 'ALEXIS GOMEZ',
      senderMobile: '0922-333-4444',
    });
    attachmentId = attachment.id;
    fileDb.close();
  }

  // Session 2: Reopen file and verify receipt attachment survives intact
  {
    const fileDb = new DatabaseSync(dbPath);
    const db = new NodeSqliteAdapter(fileDb);
    await runMigrations(db);

    const retrieved = await getReceiptAttachment(db, 'sale', saleId);
    assert.notEqual(retrieved, null);
    assert.equal(retrieved?.id, attachmentId);
    assert.equal(retrieved?.imagePath, 'file:///storage/app/receipts/proof-restart.jpg');
    assert.equal(retrieved?.amountCentavos, 4000);
    assert.equal(retrieved?.referenceNumber, 'REF-RESTART-001');
    assert.equal(retrieved?.senderName, 'ALEXIS GOMEZ');
    assert.equal(retrieved?.senderMobile, '0922-333-4444');
    fileDb.close();
  }
});
