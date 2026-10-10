const { withDangerousMod } = require('expo/config-plugins');
const { createReadStream, readFileSync, mkdirSync, copyFileSync, writeFileSync, rmSync } = require('node:fs');
const { createHash } = require('node:crypto');
const { join } = require('node:path');

const PACKAGED_FILES = [
  'models/aira-qwen.gguf',
  'models/agent-manifest.json',
  'models/QWEN-LICENSE.txt',
  'models/LLAMA-RN-LICENSE.txt',
];

async function verifyModelFile(path, model) {
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
  return bytes === model.bytes && hash.digest('hex') === model.sha256;
}

function cleanupAgentAssets(assets) {
  for (const path of PACKAGED_FILES) rmSync(join(assets, path), { force: true });
}

function withAgentModel(config, options = {}) {
  const enabled = options.enabled === true;
  return withDangerousMod(config, ['android', async (mod) => {
    const assets = join(mod.modRequest.platformProjectRoot, 'app/src/main/assets');

    if (!enabled) {
      // Remove only files owned by this plugin when re-prebuilding an existing native project.
      cleanupAgentAssets(assets);
      return mod;
    }

    const root = mod.modRequest.projectRoot;
    const manifestPath = join(root, 'assets/models/agent-manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (
      manifest.repository !== 'Qwen/Qwen3-0.6B-GGUF' ||
      manifest.revision !== '1eaf4d9657fe65ad10a51eab76a8db5b363bddaa' ||
      manifest.file !== 'Qwen3-0.6B-Q8_0.gguf' ||
      manifest.asset !== 'models/aira-qwen.gguf' ||
      manifest.bytes !== 639446688 ||
      manifest.sha256 !== '9465e63a22add5354d9bb4b99e90117043c7124007664907259bd16d043bb031' ||
      manifest.license !== 'Apache-2.0'
    ) {
      throw new Error('Agent model manifest does not match the pinned Qwen3-0.6B-Q8_0 model.');
    }

    const source = join(root, 'assets/models', manifest.file);
    if (!(await verifyModelFile(source, manifest))) {
      throw new Error(`Missing or invalid agent model. Run npm run agent:model before prebuild; expected ${manifest.bytes} bytes and SHA-256 ${manifest.sha256}.`);
    }

    const destination = join(assets, manifest.asset);
    mkdirSync(join(assets, 'models'), { recursive: true });
    copyFileSync(source, destination);
    if (!(await verifyModelFile(destination, manifest))) {
      rmSync(destination, { force: true });
      throw new Error('The copied Android model asset failed its pinned SHA-256 or byte-count check.');
    }
    copyFileSync(join(root, 'assets/models/QWEN-LICENSE.txt'), join(assets, 'models/QWEN-LICENSE.txt'));
    copyFileSync(join(root, 'assets/models/LLAMA-RN-LICENSE.txt'), join(assets, 'models/LLAMA-RN-LICENSE.txt'));
    writeFileSync(join(assets, 'models/agent-manifest.json'), JSON.stringify({
      ...manifest,
      runtime: { package: 'llama.rn', version: '0.12.9', license: 'MIT' },
      privateCopy: 'The bundled Android asset is copied to app-private storage before llama.rn loads it.',
    }, null, 2));
    return mod;
  }]);
}

module.exports = withAgentModel;
module.exports.verifyModelFile = verifyModelFile;
module.exports.cleanupAgentAssets = cleanupAgentAssets;
