import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSpokenOrder } from '../src/domain/spoken-order.ts';

test('parses a Filipino multi-item order and leaves omitted quantities for review', () => {
  const order = parseSpokenOrder('Pabili ng dalawang Coke maliit at tatlong Lucky Me chicken');
  assert.equal(order.kind, 'add');
  if (order.kind === 'add') {
    assert.deepEqual(
      order.items.map((item) => ({ query: item.query.toLocaleLowerCase(), quantity: item.quantity })),
      [
        { query: 'coke maliit', quantity: 2 },
        { query: 'lucky me chicken', quantity: 3 },
      ],
    );
  }

  const missingQuantity = parseSpokenOrder('Pabili ng Coke maliit');
  assert.equal(missingQuantity.kind, 'add');
  if (missingQuantity.kind === 'add') {
    assert.deepEqual(
      missingQuantity.items.map((item) => ({ query: item.query.toLocaleLowerCase(), quantity: item.quantity })),
      [{ query: 'coke maliit', quantity: null }],
    );
  }
});

test('parses bounded quantity corrections and explicit removals', () => {
  assert.deepEqual(parseSpokenOrder('isa lang pala'), {
    kind: 'set_quantity',
    query: null,
    quantity: 1,
  });
  const correction = parseSpokenOrder('gawing isa ang Coke maliit');
  assert.equal(correction.kind, 'set_quantity');
  if (correction.kind === 'set_quantity') {
    assert.equal(correction.query?.toLocaleLowerCase(), 'coke maliit');
    assert.equal(correction.quantity, 1);
  }
  const removal = parseSpokenOrder('tanggalin ang Lucky Me chicken');
  assert.equal(removal.kind, 'remove');
  if (removal.kind === 'remove') {
    assert.equal(removal.query?.toLocaleLowerCase(), 'lucky me chicken');
  }
});

test('audio wording cannot request checkout, saving, or payment actions', () => {
  for (const utterance of [
    'checkout na',
    'i-save ang sale',
    'bayaran na ang order',
    'markahan na paid via GCash',
  ]) {
    assert.equal(parseSpokenOrder(utterance).kind, 'unsupported', utterance);
  }
});

test('rejects negative, fractional, unsafe, scientific, and hexadecimal quantities', () => {
  for (const utterance of [
    'pabili ng negative dalawang Coke',
    'pabili ng 1.5 Coke',
    'pabili ng 9007199254740992 Coke',
    'gawing 1e3 ang Coke maliit',
    'gawing 0x10 ang Coke maliit',
  ]) {
    assert.equal(parseSpokenOrder(utterance).kind, 'unsupported', utterance);
  }
});
