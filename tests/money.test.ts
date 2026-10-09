import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCentavos, formatCentavos } from '../src/domain/money.ts';

test('parses decimal peso strings to integer centavos correctly', () => {
  assert.equal(parseCentavos('15.50'), 1550);
  assert.equal(parseCentavos('15.5'), 1550);
  assert.equal(parseCentavos('15'), 1500);
  assert.equal(parseCentavos('0.25'), 25);
  assert.equal(parseCentavos('₱25.75'), 2575);
  assert.equal(parseCentavos('P 100.00'), 10000);
});

test('rejects invalid money inputs', () => {
  assert.throws(() => parseCentavos(''), /Kailangan maglagay ng presyo/);
  assert.throws(() => parseCentavos('abc'), /Maling format ng presyo/);
  assert.throws(() => parseCentavos('-10'), /Maling format ng presyo/);
  assert.throws(() => parseCentavos('10.999'), /Maling format ng presyo/);
  assert.throws(() => parseCentavos('10.5.5'), /Maling format ng presyo/);
});

test('formats integer centavos to peso display string without float drift', () => {
  assert.equal(formatCentavos(0), '₱0.00');
  assert.equal(formatCentavos(5), '₱0.05');
  assert.equal(formatCentavos(50), '₱0.50');
  assert.equal(formatCentavos(1550), '₱15.50');
  assert.equal(formatCentavos(10000), '₱100.00');
  assert.throws(() => formatCentavos(-1), /Maling centavos/);
  assert.throws(() => formatCentavos(1.5), /Maling centavos/);
});

