// Compatibility patch for the pinned published Android wrapper; reapplied by npm ci.
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const root = join(__dirname, '..', 'node_modules', '@react-native-ml-kit', 'text-recognition');
const metadata = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
if (metadata.version !== '2.0.0') throw new Error('Review receipt OCR Android compatibility before changing the pinned version.');
const gradlePath = join(root, 'android', 'build.gradle');
let gradle = readFileSync(gradlePath, 'utf8');
if (!gradle.includes("implementation 'com.google.mlkit:text-recognition:16.0.1'")) throw new Error('Bundled Latin OCR dependency is missing.');
if (!gradle.includes('namespace "com.rnmlkit.textrecognition"')) {
  if (!gradle.includes('android {')) throw new Error('Unexpected OCR Gradle layout.');
  gradle = gradle.replace('android {', 'android {\n    namespace "com.rnmlkit.textrecognition"');
}
gradle = gradle.replace("implementation 'com.facebook.react:react-native:+'", "implementation 'com.facebook.react:react-android'");
// The wrapper's Java code imports all five scripts; retain their bundled libraries.
gradle = gradle.split(/\r?\n/).filter(line => !/^\s*implementation 'com\.google\.mlkit:text-recognition-(?:chinese|devanagari|japanese|korean):16\.0\.1'/.test(line)).join('\n');
for (const script of ['chinese', 'devanagari', 'japanese', 'korean']) {
  const dependency = `implementation 'com.google.mlkit:text-recognition-${script}:16.0.1'`;
  gradle = gradle.replace("implementation 'com.google.mlkit:text-recognition:16.0.1'", `implementation 'com.google.mlkit:text-recognition:16.0.1'\n    ${dependency}`);
}
writeFileSync(gradlePath, gradle);
const manifestPath = join(root, 'android', 'src', 'main', 'AndroidManifest.xml');
const manifest = readFileSync(manifestPath, 'utf8').replace(/\s+package="com\.rnmlkit\.textrecognition"/, '');
writeFileSync(manifestPath, manifest);
console.log('Receipt OCR: Android namespace, React dependency and bundled Latin model prepared.');

// The app already supplies AGP. Whisper's legacy standalone classpath otherwise
// downloads a second AGP 7.2.1 tree and can conflict with the host build.
const whisperRoot = join(__dirname, '..', 'node_modules', 'whisper.rn');
const whisperMetadata = JSON.parse(readFileSync(join(whisperRoot, 'package.json'), 'utf8'));
if (whisperMetadata.version !== '0.7.4') throw new Error('Review Whisper Android build compatibility before upgrading.');
const whisperGradlePath = join(whisperRoot, 'android', 'build.gradle');
let whisperGradle = readFileSync(whisperGradlePath, 'utf8').replace(/\r\n/g, '\n');
const standaloneBuildscript = /^buildscript \{[\s\S]*?\n\}\n/;
if (standaloneBuildscript.test(whisperGradle)) {
  whisperGradle = whisperGradle.replace(standaloneBuildscript, block => `if (project == rootProject) {\n${block}}\n`);
} else if (!whisperGradle.startsWith('if (project == rootProject) {')) {
  throw new Error('Unexpected Whisper Gradle buildscript layout.');
}
writeFileSync(whisperGradlePath, whisperGradle);
console.log('Whisper: integrated Android build uses the host Android Gradle plugin.');
