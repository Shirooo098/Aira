import test from 'node:test';
import assert from 'node:assert/strict';
import { joinPcm16, hasAudiblePcm16 } from '../src/speech/pcm.ts';

test('joins PCM16 preserving bytes and refuses malformed or oversized captures', () => {
  const pcm = joinPcm16([new Uint8Array([0, 128]).buffer, new Uint8Array([255, 127]).buffer]);
  assert.equal(new DataView(pcm).getInt16(0, true), -32768);
  assert.equal(new DataView(pcm).getInt16(2, true), 32767);
  assert.throws(() => joinPcm16([]));
  assert.throws(() => joinPcm16([new Uint8Array(3).buffer]));
  assert.throws(() => joinPcm16([new Uint8Array(8).buffer], 2));
});

test('rejects silence and very short capture without claiming speech recognition accuracy', () => {
  assert.equal(hasAudiblePcm16(new ArrayBuffer(32000)), false);
  assert.equal(hasAudiblePcm16(new Int16Array(1600).fill(3000).buffer), false);
  assert.equal(hasAudiblePcm16(new Int16Array(8000).fill(3000).buffer), true);
});
