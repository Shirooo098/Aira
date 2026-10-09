module.exports = ({ config }) => ({
  ...config,
  plugins: [...(config.plugins ?? []), ['./plugins/with-speech-model.cjs', { candidate: process.env.AIRA_SPEECH_MODEL ?? 'tiny' }]],
});
