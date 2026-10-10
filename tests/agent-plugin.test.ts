import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { cleanupAgentAssets, verifyModelFile } = require('../plugins/with-agent-model.cjs') as {
  cleanupAgentAssets: (assets: string) => void;
  verifyModelFile: (path: string, model: { bytes: number; sha256: string }) => Promise<boolean>;
};

test('agent model plugin verifies byte count and SHA-256 without loading the model into memory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aira-agent-plugin-'));
  const modelFile = join(root, 'model.gguf');
  const contents = Buffer.from('fixed local model fixture');
  const model = {
    bytes: contents.length,
    sha256: createHash('sha256').update(contents).digest('hex'),
  };

  try {
    await writeFile(modelFile, contents);
    assert.equal(await verifyModelFile(modelFile, model), true);
    assert.equal(await verifyModelFile(modelFile, { ...model, bytes: model.bytes + 1 }), false);
    assert.equal(await verifyModelFile(modelFile, { ...model, sha256: '0'.repeat(64) }), false);
    assert.equal(await verifyModelFile(join(root, 'missing.gguf'), model), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('disabling the agent model removes only its generated Android asset files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aira-agent-assets-'));
  const models = join(root, 'models');

  try {
    await mkdir(models, { recursive: true });
    await Promise.all([
      writeFile(join(models, 'aira-qwen.gguf'), 'agent model'),
      writeFile(join(models, 'agent-manifest.json'), '{}'),
      writeFile(join(models, 'QWEN-LICENSE.txt'), 'model license'),
      writeFile(join(models, 'LLAMA-RN-LICENSE.txt'), 'runtime license'),
      writeFile(join(models, 'whisper.bin'), 'unrelated speech model'),
    ]);

    cleanupAgentAssets(root);

    await assert.rejects(readFile(join(models, 'aira-qwen.gguf')));
    await assert.rejects(readFile(join(models, 'agent-manifest.json')));
    assert.equal(await readFile(join(models, 'whisper.bin'), 'utf8'), 'unrelated speech model');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
