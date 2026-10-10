import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateRestockSuggestions,
  buildRestockPrompt,
  parseRestockPriorityFocus,
  applyRestockPriority,
  validateChecklistQuantity,
  RESTOCK_SUGGESTIONS_SCHEMA,
  type RestockCandidateInput,
} from '../src/domain/restock.ts';
import type { ProductWithStock } from '../src/types.ts';
import type { StoreReport } from '../src/domain/reports.ts';

function makeMockReport(overrides: Partial<StoreReport> = {}): StoreReport {
  return {
    period: {
      periodKey: 'today',
      labelFilipino: 'Ngayong Araw (Today)',
      startUtcIso: '2026-10-09T16:00:00.000Z',
      endUtcIso: '2026-10-10T06:00:00.000Z',
      startManilaDate: '2026-10-10',
      endManilaDate: '2026-10-10',
    },
    asOfUtcIso: '2026-10-10T06:00:00.000Z',
    netSalesCentavos: 5000,
    grossSalesCentavos: 5000,
    cancelledSalesCentavos: 0,
    salesCount: 3,
    cancelledSalesCount: 0,
    collectionBreakdown: {
      cashSalesCentavos: 5000,
      cashRepaymentsCentavos: 0,
      gcashSalesCentavos: 0,
      gcashRepaymentsCentavos: 0,
    },
    cashCollectionsCentavos: 5000,
    gcashCollectionsCentavos: 0,
    totalCollectionsCentavos: 5000,
    newCreditCentavos: 0,
    currentOutstandingCreditCentavos: 0,
    stockNowUnits: 15,
    topProducts: [
      {
        productId: 'prod_1',
        productName: 'Coke',
        variant: 'Mismo 250ml',
        unit: 'bote',
        unitsSold: 12,
        revenueCentavos: 2400,
      },
      {
        productId: 'prod_2',
        productName: 'Sprite',
        variant: 'Mismo 250ml',
        unit: 'bote',
        unitsSold: 5,
        revenueCentavos: 1000,
      },
    ],
    ...overrides,
  };
}

function makeProducts(): ProductWithStock[] {
  return [
    {
      id: 'prod_1',
      name: 'Coke',
      variant: 'Mismo 250ml',
      unit: 'bote',
      priceCentavos: 2000,
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
      quantity: 0, // Ubos na (out of stock)
      stockUpdatedAt: '2026-10-01T00:00:00.000Z',
    },
    {
      id: 'prod_2',
      name: 'Sprite',
      variant: 'Mismo 250ml',
      unit: 'bote',
      priceCentavos: 2000,
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
      quantity: 2, // Mababa (low stock)
      stockUpdatedAt: '2026-10-01T00:00:00.000Z',
    },
    {
      id: 'prod_3',
      name: 'Bear Brand',
      variant: '33g sachet',
      unit: 'piraso',
      priceCentavos: 1500,
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
      quantity: 0, // Ubos na, but 0 sales in period (insufficient history)
      stockUpdatedAt: '2026-10-01T00:00:00.000Z',
    },
    {
      id: 'prod_4',
      name: 'Safeguard',
      variant: 'Puti 60g',
      unit: 'piraso',
      priceCentavos: 3500,
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
      quantity: null, // Hindi pa nabibilang (uncounted)
      stockUpdatedAt: null,
    },
    {
      id: 'prod_5',
      name: 'Lucky Me Pancit Canton',
      variant: 'Original 80g',
      unit: 'piraso',
      priceCentavos: 1600,
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
      quantity: 50, // Sapat na stock, walang benta (should not be candidate)
      stockUpdatedAt: '2026-10-01T00:00:00.000Z',
    },
  ];
}

test('grounds restock suggestions in current stock and report sales', () => {
  const report = makeMockReport();
  const products = makeProducts();
  const suggestions = generateRestockSuggestions({ products, report });

  // prod_1 (Coke) has quantity 0 and 12 units sold
  const coke = suggestions.find((s) => s.productId === 'prod_1');
  assert.ok(coke);
  assert.equal(coke.reason, 'out_of_stock');
  assert.equal(coke.currentStock, 0);
  assert.equal(coke.unitsSold, 12);
  assert.equal(coke.hasSufficientHistory, true);
  assert.equal(coke.suggestedQuantity, 12); // Grounded in 12 sold
  assert.equal(coke.requestedQuantity, 12);
  assert.match(coke.historyExplanation, /12/);

  // prod_2 (Sprite) has quantity 2 and 5 units sold
  const sprite = suggestions.find((s) => s.productId === 'prod_2');
  assert.ok(sprite);
  assert.equal(sprite.reason, 'low_stock');
  assert.equal(sprite.currentStock, 2);
  assert.equal(sprite.unitsSold, 5);
  assert.equal(sprite.hasSufficientHistory, true);
  assert.equal(sprite.suggestedQuantity, 5);
  assert.match(sprite.historyExplanation, /5/);

  // prod_5 with plenty of stock and no sales is excluded from auto-suggestions
  const pancit = suggestions.find((s) => s.productId === 'prod_5');
  assert.equal(pancit, undefined);
});

test('explains insufficient history honestly and does not invent reorder quantities', () => {
  const report = makeMockReport();
  const products = makeProducts();
  const suggestions = generateRestockSuggestions({ products, report });

  // prod_3 (Bear Brand) is out of stock (quantity 0), but has 0 sales in the report
  const bearBrand = suggestions.find((s) => s.productId === 'prod_3');
  assert.ok(bearBrand);
  assert.equal(bearBrand.reason, 'out_of_stock');
  assert.equal(bearBrand.currentStock, 0);
  assert.equal(bearBrand.unitsSold, 0);
  assert.equal(bearBrand.hasSufficientHistory, false);
  assert.equal(bearBrand.suggestedQuantity, null); // NO invented quantity!
  assert.equal(bearBrand.requestedQuantity, 1); // Safe editable starter
  assert.match(bearBrand.historyExplanation, /Kulang ang kasaysayan/i);
});

test('flags uncounted stock honestly without pretending it is zero', () => {
  const report = makeMockReport();
  const products = makeProducts();
  const suggestions = generateRestockSuggestions({ products, report });

  // prod_4 (Safeguard) is uncounted (quantity null)
  const safeguard = suggestions.find((s) => s.productId === 'prod_4');
  assert.ok(safeguard);
  assert.equal(safeguard.reason, 'uncounted');
  assert.equal(safeguard.currentStock, null);
  assert.match(safeguard.reasonExplanation, /Hindi pa nabibilang/i);
});

test('handles completely empty report activity without inventing history', () => {
  const emptyReport = makeMockReport({
    netSalesCentavos: 0,
    grossSalesCentavos: 0,
    salesCount: 0,
    topProducts: [],
  });
  const products = makeProducts();
  const suggestions = generateRestockSuggestions({ products, report: emptyReport });

  // Out of stock and low stock items are still identified, but none have sufficient history
  for (const item of suggestions) {
    assert.equal(item.hasSufficientHistory, false);
    assert.equal(item.suggestedQuantity, null);
    assert.match(item.historyExplanation, /Kulang ang kasaysayan/i);
  }
});

test('validateChecklistQuantity strictly requires positive safe integer', () => {
  assert.equal(validateChecklistQuantity(1), 1);
  assert.equal(validateChecklistQuantity(50), 50);
  assert.equal(validateChecklistQuantity('10'), 10);

  assert.throws(() => validateChecklistQuantity(0), /positibo/i);
  assert.throws(() => validateChecklistQuantity(-5), /positibo/i);
  assert.throws(() => validateChecklistQuantity(1.5), /buong bilang/i);
  assert.throws(() => validateChecklistQuantity('abc'), /bilang/i);
  assert.throws(() => validateChecklistQuantity(9007199254740992), /limit/i);
});

test('buildRestockPrompt encapsulates candidate metrics as untrusted JSON data', () => {
  const report = makeMockReport();
  const products = makeProducts();
  const suggestions = generateRestockSuggestions({ products, report });
  const prompt = buildRestockPrompt(suggestions, report.period.labelFilipino);

  assert.equal(prompt.messages[0]?.role, 'system');
  assert.equal(prompt.messages[1]?.role, 'user');
  assert.match(prompt.messages[0]?.content ?? '', /priorityProductIds/i);
  assert.match(prompt.messages[1]?.content ?? '', /prod_1/);
});

test('parseRestockPriorityFocus validates priority product IDs against candidate set', () => {
  const candidateIds = new Set(['prod_1', 'prod_2', 'prod_3']);

  const valid = parseRestockPriorityFocus('{"priorityProductIds":["prod_1","prod_2"]}', candidateIds);
  assert.deepEqual(valid, ['prod_1', 'prod_2']);

  // Empty array is valid (no priorities)
  const empty = parseRestockPriorityFocus('{"priorityProductIds":[]}', candidateIds);
  assert.deepEqual(empty, []);

  // Unknown product ID is rejected
  assert.throws(
    () => parseRestockPriorityFocus('{"priorityProductIds":["prod_99"]}', candidateIds),
    /hindi kilalang/i
  );

  // Duplicate ID is rejected
  assert.throws(
    () => parseRestockPriorityFocus('{"priorityProductIds":["prod_1","prod_1"]}', candidateIds),
    /doble/i
  );

  // Non-JSON or extra keys rejected
  assert.throws(() => parseRestockPriorityFocus('not json', candidateIds), /JSON/i);
  assert.throws(
    () => parseRestockPriorityFocus('{"priorityProductIds":[],"extra":1}', candidateIds),
    /field/i
  );
});

test('applyRestockPriority moves priority items to top of list', () => {
  const report = makeMockReport();
  const products = makeProducts();
  const suggestions = generateRestockSuggestions({ products, report });

  // prod_3 was initially lower than prod_1
  const prioritized = applyRestockPriority(suggestions, ['prod_3']);
  assert.equal(prioritized[0]?.productId, 'prod_3');
  assert.equal(prioritized[0]?.isPriority, true);
  assert.equal(prioritized[1]?.isPriority, false);
});
