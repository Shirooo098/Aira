/** whisper.rn 0.7.4's native data decoder expects little-endian signed PCM16. */
export function joinPcm16(chunks: readonly ArrayBuffer[], maxSamples = 16_000 * 15): ArrayBuffer {
  const bytes = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  if (bytes === 0 || bytes % 2 !== 0 || bytes > maxSamples * 2) {
    throw new Error('Invalid or oversized PCM16 capture.');
  }
  const joined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    if (chunk.byteLength % 2 !== 0) throw new Error('Incomplete PCM16 sample.');
    joined.set(new Uint8Array(chunk), offset);
    offset += chunk.byteLength;
  }
  return joined.buffer;
}

/** Conservative empty-input guard; hardware testing must validate quiet speech/noise. */
export function hasAudiblePcm16(data: ArrayBuffer): boolean {
  if (data.byteLength < 16000 * 2 * 0.15) return false;
  const view = new DataView(data);
  let squareSum = 0;
  for (let offset = 0; offset < data.byteLength; offset += 2) {
    const sample = view.getInt16(offset, true) / 32768;
    squareSum += sample * sample;
  }
  return Math.sqrt(squareSum / (data.byteLength / 2)) >= 0.001;
}
