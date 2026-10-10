import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm } from 'node:fs/promises';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(await readFile(resolve(root, 'assets/models/agent-manifest.json'), 'utf8'));
if (
  manifest.repository !== 'Qwen/Qwen3-0.6B-GGUF' ||
  manifest.revision !== '1eaf4d9657fe65ad10a51eab76a8db5b363bddaa' ||
  manifest.file !== 'Qwen3-0.6B-Q8_0.gguf' ||
  manifest.asset !== 'models/aira-qwen.gguf' ||
  manifest.bytes !== 639446688 ||
  manifest.sha256 !== '9465e63a22add5354d9bb4b99e90117043c7124007664907259bd16d043bb031' ||
  manifest.license !== 'Apache-2.0' ||
  manifest.source !== 'https://huggingface.co/Qwen/Qwen3-0.6B-GGUF/resolve/1eaf4d9657fe65ad10a51eab76a8db5b363bddaa/Qwen3-0.6B-Q8_0.gguf'
) {
  throw new Error('Agent model manifest does not match the pinned Qwen3-0.6B-Q8_0 model.');
}
const destination = resolve(root, 'assets/models', manifest.file);
const optionalSource = process.argv[2];

function integrityTransform() {
  const hash = createHash('sha256');
  let bytes = 0;
  const stream = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  return {
    stream,
    matches() {
      return bytes === manifest.bytes && hash.digest('hex') === manifest.sha256;
    },
  };
}

async function isVerifiedFile(path) {
  const hash = createHash('sha256');
  let bytes = 0;
  try {
    for await (const chunk of createReadStream(path)) {
      bytes += chunk.length;
      hash.update(chunk);
    }
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
  return bytes === manifest.bytes && hash.digest('hex') === manifest.sha256;
}

async function* responseChunks(response) {
  if (!response.body) throw new Error('The pinned model response had no streaming body.');
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

if (await isVerifiedFile(destination)) {
  console.log(`${manifest.file}: already verified locally.`);
  process.exit(0);
}

await mkdir(dirname(destination), { recursive: true });
const temporary = `${destination}.partial`;
const check = integrityTransform();

try {
  let source;
  if (optionalSource) {
    source = createReadStream(resolve(optionalSource));
  } else {
    // Build-time acquisition only. The installed application never calls this script.
    const response = await fetch(manifest.source, { signal: AbortSignal.timeout(600000) });
    if (!response.ok) throw new Error(`Pinned model download failed: HTTP ${response.status}`);
    source = responseChunks(response);
  }

  await pipeline(source, check.stream, createWriteStream(temporary));
  if (!check.matches()) {
    throw new Error(`Model integrity check failed. Expected ${manifest.bytes} bytes and SHA-256 ${manifest.sha256}; the verified model was not installed.`);
  }

  await rm(destination, { force: true });
  await rename(temporary, destination);
  console.log(`${manifest.file}: verified ${manifest.bytes} bytes, SHA-256 ${manifest.sha256}`);
} finally {
  await rm(temporary, { force: true });
}
