import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(await readFile(resolve(root, 'assets/models/manifest.json'), 'utf8'));
const candidate = process.argv[2] ?? 'tiny';
if (candidate !== 'tiny' && candidate !== 'base') throw new Error('Choose tiny or base (multilingual).');
const model = manifest.candidates[candidate];
if (!model) throw new Error('Choose tiny or base (multilingual).');
const destination = resolve(root, 'assets/models', model.file);
const verify = (bytes) => bytes.length === model.bytes && createHash('sha256').update(bytes).digest('hex') === model.sha256;
try {
  if (verify(await readFile(destination))) {
    console.log(`${model.file}: verified locally.`);
    process.exit(0);
  }
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
// Build-time acquisition only. The installed application never calls this script.
const response = await fetch(`https://huggingface.co/${manifest.repository}/resolve/${manifest.revision}/${model.file}`, { signal: AbortSignal.timeout(600000) });
if (!response.ok) throw new Error(`Model download failed: HTTP ${response.status}`);
const bytes = Buffer.from(await response.arrayBuffer());
if (!verify(bytes)) throw new Error('Model integrity check failed; no asset was installed.');
await mkdir(dirname(destination), { recursive: true });
const temporary = `${destination}.partial`;
try {
  await writeFile(temporary, bytes);
  await rename(temporary, destination);
} finally {
  await rm(temporary, { force: true });
}
console.log(`${model.file}: verified SHA-256 ${model.sha256}`);
