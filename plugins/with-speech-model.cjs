const { withDangerousMod } = require('expo/config-plugins');
const { readFileSync, mkdirSync, copyFileSync, writeFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const { join } = require('node:path');

module.exports = function withSpeechModel(config, options = {}) {
  const candidate = options.candidate ?? 'tiny';
  if (candidate !== 'tiny' && candidate !== 'base') throw new Error('Speech model must be multilingual tiny or base.');
  return withDangerousMod(config, ['android', async (mod) => {
    const root = mod.modRequest.projectRoot;
    const manifest = JSON.parse(readFileSync(join(root, 'assets/models/manifest.json'), 'utf8'));
    const model = manifest.candidates[candidate];
    if (!model) throw new Error('Speech model must be multilingual tiny or base.');
    const source = join(root, 'assets/models', model.file);
    let bytes;
    try { bytes = readFileSync(source); }
    catch { throw new Error(`Missing speech model. Run npm run speech:model -- ${candidate} before prebuild.`); }
    if (bytes.length !== model.bytes || createHash('sha256').update(bytes).digest('hex') !== model.sha256) {
      throw new Error('Speech model integrity check failed. Reacquire the model before building.');
    }
    const assets = join(mod.modRequest.platformProjectRoot, 'app/src/main/assets');
    mkdirSync(join(assets, 'models'), { recursive: true });
    // Stable native asset name: only this candidate is packaged, even if both exist locally.
    copyFileSync(source, join(assets, 'models/whisper.bin'));
    copyFileSync(join(root, 'assets/models/WHISPER-LICENSE.txt'), join(assets, 'models/WHISPER-LICENSE.txt'));
    writeFileSync(join(assets, 'models/model-manifest.json'), JSON.stringify({ candidate, ...model, revision: manifest.revision }, null, 2));
    return mod;
  }]);
};
