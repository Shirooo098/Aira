import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractCatalogTranscript,
} from '../src/domain/catalog-dictation.ts';

test('owner example keeps the spoken product name and asks for a missing variant', () => {
  const result = extractCatalogTranscript('Lucky Me chicken, 15 pesos, 10 pieces');

  assert.equal(result.fields.kind, 'new_product');
  assert.equal(result.fields.name, 'Lucky Me chicken');
  assert.equal(result.fields.variant, '', 'variant must not be guessed from the product name');
  assert.equal(result.fields.unit, 'piraso');
  assert.equal(result.fields.priceInput, '15');
  assert.equal(result.fields.quantityInput, '10');
  assert.match(result.warnings.join(' '), /variant|sukat/i);
});

test('explicit product variant and unit stay separate from price and initial count', () => {
  const result = extractCatalogTranscript(
    'Lucky Me, variant chicken, unit pack, price 15.50 pesos, quantity 10 packs'
  );

  assert.deepEqual(result.warnings, []);
  assert.equal(result.fields.name, 'Lucky Me');
  assert.equal(result.fields.variant, 'chicken');
  assert.equal(result.fields.unit, 'pack');
  assert.equal(result.fields.priceInput, '15.50');
  assert.equal(result.fields.quantityInput, '10');
});

test('conflicting explicit unit and quantity units are blocked for owner correction', () => {
  const result = extractCatalogTranscript(
    'Lucky Me, variant chicken, unit pack, price 15 pesos, quantity 10 pieces'
  );

  assert.match(result.warnings.join(' '), /unit|magkahalo|ayusin/i);
  assert.equal(result.fields.name, '');
});

test('numeric product and variant labels are not mistaken for price or quantity', () => {
  const result = extractCatalogTranscript(
    'Coca-Cola 1.5L, variant Original 80g, price 15 pesos, quantity 10 packs'
  );

  assert.deepEqual(result.warnings, []);
  assert.equal(result.fields.name, 'Coca-Cola 1.5L');
  assert.equal(result.fields.variant, 'Original 80g');
  assert.equal(result.fields.priceInput, '15');
  assert.equal(result.fields.quantityInput, '10');
});

test('currency-like letters inside product names do not get stripped as a currency prefix', () => {
  const result = extractCatalogTranscript(
    'Lucky Me Pancit Canton, variant Original 80g, price 15 pesos, quantity 10 packs'
  );

  assert.equal(result.fields.name, 'Lucky Me Pancit Canton');
  assert.equal(result.fields.variant, 'Original 80g');
  assert.equal(result.fields.priceInput, '15');
  assert.equal(result.fields.quantityInput, '10');
});

test('a product size in a lookup query remains part of the product identity', () => {
  const result = extractCatalogTranscript('change price of Coke 1.5 L, price 15 pesos');

  assert.equal(result.fields.productQuery, 'Coke 1.5 L');
  assert.equal(result.fields.quantityInput, '');
  assert.equal(result.fields.unit, '');
});

test('repeated explicit variants require transcript correction instead of last-value-wins', () => {
  const result = extractCatalogTranscript(
    'Lucky Me, variant chicken, variant beef, unit pack, price 15 pesos, quantity 10 pieces'
  );

  assert.match(result.warnings.join(' '), /variant|magkahalo|ayusin/i);
  assert.equal(result.fields.name, '');
});

test('explicit price, count, and delivery prefixes select distinct change kinds', () => {
  const price = extractCatalogTranscript('change price of Lucky Me, price 12.75 pesos');
  const count = extractCatalogTranscript('set count for Lucky Me, quantity 8');
  const delivery = extractCatalogTranscript('add delivery for Lucky Me, quantity 8');

  assert.equal(price.fields.kind, 'price_update');
  assert.equal(price.fields.productQuery, 'Lucky Me');
  assert.equal(price.fields.priceInput, '12.75');
  assert.equal(count.fields.kind, 'set_count');
  assert.equal(count.fields.productQuery, 'Lucky Me');
  assert.equal(count.fields.quantityInput, '8');
  assert.equal(delivery.fields.kind, 'add_delivery');
  assert.equal(delivery.fields.productQuery, 'Lucky Me');
  assert.equal(delivery.fields.quantityInput, '8');
});

test('price text retains exact decimal digits and does not silently truncate unsafe values', () => {
  const exact = extractCatalogTranscript('Lucky Me, price 15.90 pesos');
  const unsafe = extractCatalogTranscript('Lucky Me, price 90071992547409.92 pesos');

  assert.equal(exact.fields.priceInput, '15.90');
  assert.equal(unsafe.fields.priceInput, '90071992547409.92');
  assert.notEqual(unsafe.fields.priceInput, '90071992547409.91');
});

test('mixed intents and unsupported destructive commands are blocked with warnings', () => {
  const mixed = extractCatalogTranscript(
    'set count for Coke, quantity 10 pieces, then add delivery for Lucky Me'
  );
  const unsupported = extractCatalogTranscript('delete Coke, price 12 pesos');

  assert.match(mixed.warnings.join(' '), /magkahalo|uri ng pagbabago/i);
  assert.match(unsupported.warnings.join(' '), /hindi suportadong utos/i);
  assert.equal(mixed.fields.productQuery, '');
  assert.equal(unsupported.fields.productQuery, '');
});

test('a requested mode that conflicts with the spoken mode requires a new transcript', () => {
  const result = extractCatalogTranscript(
    'change price of Lucky Me, price 12 pesos',
    'set_count'
  );

  assert.equal(result.fields.kind, 'price_update');
  assert.match(result.warnings.join(' '), /magkahalo|uri ng pagbabago/i);
  assert.equal(result.fields.productQuery, '');
});
