module.exports = ({ config }) => ({
  ...config,
  plugins: [
    ...(config.plugins ?? []),
    ['llama.rn', { enableOpenCLAndHexagon: false }],
    ['./plugins/with-speech-model.cjs', { candidate: process.env.AIRA_SPEECH_MODEL ?? 'tiny' }],
    ['./plugins/with-agent-model.cjs', { enabled: process.env.AIRA_AGENT_MODEL === '1' }],
  ],
});
