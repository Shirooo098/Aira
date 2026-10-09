const INCOMPLETE_PRODUCT_PARTICLES = new Set(['po', 'ba', 'ang', 'yung']);

/**
 * Extracts a product phrase from the small set of supported price questions.
 * This recognizes command shape only; callers must still resolve the phrase
 * through the catalog lookup action.
 */
export function parsePriceCommand(text: string): string | null {
  const normalized = text
    .normalize('NFC')
    .trim()
    .replace(/\s+/gu, ' ')
    .toLowerCase()
    .replace(/[?？؟]+$/u, '')
    .trim();

  if (!normalized) return null;

  const words = normalized.split(' ');
  let productWords: string[] | null = null;

  if (words[0] === 'magkano') {
    let index = 1;

    // Consume optional command particles only in their documented order.
    if (words[index] === 'po') index += 1;
    if (words[index] === 'ba') index += 1;
    if (words[index] === 'ang' || words[index] === 'yung') index += 1;

    productWords = words.slice(index);
  } else if (
    words[0] === 'ano' &&
    words[1] === 'ang' &&
    words[2] === 'presyo' &&
    words[3] === 'ng'
  ) {
    productWords = words.slice(4);
  }

  if (!productWords || productWords.length === 0) return null;

  const productPhrase = productWords.join(' ').trim();
  if (!productPhrase || INCOMPLETE_PRODUCT_PARTICLES.has(productPhrase)) return null;

  return productPhrase;
}
