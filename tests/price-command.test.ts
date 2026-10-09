import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePriceCommand } from '../src/domain/price-command.ts';

test('parses only the supported anchored price-command forms', () => {
  const accepted: Array<[string, string]> = [
    ['Magkano Coke?', 'coke'],
    ['Magkano po Coke?', 'coke'],
    ['Magkano ba Coke?', 'coke'],
    ['Magkano po ba ang Coke?', 'coke'],
    ['Magkano yung Coke?', 'coke'],
    ['Magkano po ba yung Coke Zero???', 'coke zero'],
    ['Ano ang presyo ng Coke?', 'coke'],
    ['  MAGKANO   ANG   ISANG   COKE?  ', 'isang coke'],
    ['Magkano ang Ang Ketchup?', 'ang ketchup'],
    ['Magkano Ng Ketchup?', 'ng ketchup'],
    ['Magkano ang kape ng bata na may ang?', 'kape ng bata na may ang'],
    ['Ano ang presyo ng Coca-Cola zero-sugar 1.5-L？', 'coca-cola zero-sugar 1.5-l'],
    ['Magkano ba Coke؟', 'coke'],
    ['Ano ang presyo ng produkto na wala sa catalog?', 'produkto na wala sa catalog'],
    ['Ano ang presyo ng café, na may “presyo” sa pangalan?', 'café, na may “presyo” sa pangalan'],
    ['Ano ang presyo ng Cafe\u0301 de olla?', 'café de olla'],
  ];

  for (const [command, expected] of accepted) {
    assert.equal(parsePriceCommand(command), expected, command);
  }
});

test('rejects incomplete commands and unsupported shared speech samples', () => {
  const unsupported = [
    '',
    'Magkano?',
    'Magkano po?',
    'Magkano po ba?',
    'Magkano ang?',
    'Magkano yung?',
    'Magkano ang po?',
    'Magkano ba',
    'Ano ang presyo ng?',
    'Ano presyo ng Coke?',
    'Dalawang Lucky Me chicken.',
    'Tatlong sachet ng shampoo.',
    'Isang Bear Brand na maliit.',
    'Limang SkyFlakes, magkano lahat?',
    'Coke mismo, hindi Sprite.',
    'Isa lang pala.',
    'Dalawa, dagdagan ng isa.',
    'May malaking Tang orange ba?',
  ];

  for (const command of unsupported) {
    assert.equal(parsePriceCommand(command), null, command);
  }
});
