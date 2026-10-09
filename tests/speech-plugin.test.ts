import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

type MockMod = {
  modRequest: { projectRoot: string; platformProjectRoot: string };
  modResults?: unknown;
};

type PluginConfig = {
  mods?: { android?: Record<string, (mod: MockMod) => Promise<unknown>> };
};

type SpeechPlugin = (config: PluginConfig, options: { candidate: string }) => PluginConfig;

const withSpeechModel = createRequire(import.meta.url)('../plugins/with-speech-model.cjs') as SpeechPlugin;
const tinyBytes = new Uint8Array([1, 2, 3, 4, 5]);
const baseBytes = new Uint8Array([9, 8, 7, 6, 5, 4]);

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function fixture<T>(run: (root: string, platformRoot: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), 'aira-speech-plugin-'));
  const modelDir = join(root, 'assets', 'models');
  const platformRoot = join(root, 'android');
  await mkdir(modelDir, { recursive: true });
  await writeFile(join(modelDir, 'ggml-tiny.bin'), tinyBytes);
  await writeFile(join(modelDir, 'ggml-base.bin'), baseBytes);
  await writeFile(join(modelDir, 'WHISPER-LICENSE.txt'), 'fixture license');
  await writeFile(join(modelDir, 'manifest.json'), JSON.stringify({
    repository: 'fixture/repository',
    revision: 'fixture-revision',
    candidates: {
      tiny: { file: 'ggml-tiny.bin', bytes: tinyBytes.length, sha256: sha256(tinyBytes) },
      base: { file: 'ggml-base.bin', bytes: baseBytes.length, sha256: sha256(baseBytes) },
    },
  }));

  try {
    return await run(root, platformRoot);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function applyPlugin(root: string, platformRoot: string, candidate: string): Promise<void> {
  const config = withSpeechModel({}, { candidate });
  const dangerousMod = config.mods?.android?.dangerous;
  assert.ok(dangerousMod, 'plugin registers an Android dangerous mod');
  await dangerousMod({ modRequest: { projectRoot: root, platformProjectRoot: platformRoot }, modResults: {} });
}

async function modelAssets(platformRoot: string): Promise<string> {
  return join(platformRoot, 'app', 'src', 'main', 'assets', 'models');
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

for (const [candidate, expectedBytes, expectedFile] of [
  ['tiny', tinyBytes, 'ggml-tiny.bin'],
  ['base', baseBytes, 'ggml-base.bin'],
] as const) {
  test(`packages only the selected ${candidate} model under the stable Android asset name`, async () => {
    await fixture(async (root, platformRoot) => {
      await applyPlugin(root, platformRoot, candidate);
      const outputDir = await modelAssets(platformRoot);
      assert.deepEqual(new Uint8Array(await readFile(join(outputDir, 'whisper.bin'))), expectedBytes);
      assert.deepEqual((await readdir(outputDir)).sort(), [
        'WHISPER-LICENSE.txt',
        'model-manifest.json',
        'whisper.bin',
      ]);
      const packagedManifest = JSON.parse(await readFile(join(outputDir, 'model-manifest.json'), 'utf8')) as {
        candidate: string;
        file: string;
        sha256: string;
      };
      assert.equal(packagedManifest.candidate, candidate);
      assert.equal(packagedManifest.file, expectedFile);
      assert.equal(packagedManifest.sha256, sha256(expectedBytes));
    });
  });
}

test('rejects a candidate other than tiny or base before writing Android assets', async () => {
  await fixture(async (root, platformRoot) => {
    await assert.rejects(applyPlugin(root, platformRoot, 'tiny.en'), /multilingual tiny or base/);
    assert.equal(await pathExists(await modelAssets(platformRoot)), false);
  });
});

test('reports a missing selected model with the acquisition command', async () => {
  await fixture(async (root, platformRoot) => {
    await rm(join(root, 'assets', 'models', 'ggml-tiny.bin'));
    await assert.rejects(applyPlugin(root, platformRoot, 'tiny'), /npm run speech:model -- tiny/);
    assert.equal(await pathExists(await modelAssets(platformRoot)), false);
  });
});

test('rejects a model whose SHA-256 does not match the manifest', async () => {
  await fixture(async (root, platformRoot) => {
    await writeFile(join(root, 'assets', 'models', 'ggml-tiny.bin'), new Uint8Array([1, 2, 3, 4, 6]));
    await assert.rejects(applyPlugin(root, platformRoot, 'tiny'), /integrity check failed/);
    assert.equal(await pathExists(await modelAssets(platformRoot)), false);
  });
});

test('rejects a model whose byte count does not match the manifest', async () => {
  await fixture(async (root, platformRoot) => {
    const manifestPath = join(root, 'assets', 'models', 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      candidates: { tiny: { bytes: number } };
    };
    manifest.candidates.tiny.bytes += 1;
    await writeFile(manifestPath, JSON.stringify(manifest));
    await assert.rejects(applyPlugin(root, platformRoot, 'tiny'), /integrity check failed/);
    assert.equal(await pathExists(await modelAssets(platformRoot)), false);
  });
});
