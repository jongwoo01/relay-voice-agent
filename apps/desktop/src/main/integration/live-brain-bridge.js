export function createLiveBrainBridge({ runtime }) {
  return {
    async handleFinalTranscript(text) {
      await runtime.handleVoiceTranscript(text);
    }
  };
}
