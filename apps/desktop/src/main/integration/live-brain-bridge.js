export function createLiveBrainBridge({ runtime, liveVoiceSession }) {
  return {
    async handleFinalTranscript(text) {
      await runtime.handleVoiceTranscript(text);
    },

    async sendTypedTurn(text) {
      const normalizedText = text.trim();
      if (!normalizedText) {
        return {
          sessionState: await runtime.collectState(),
          liveState: await liveVoiceSession.getState()
        };
      }

      await liveVoiceSession.connect();
      const [liveState, sessionState] = await Promise.all([
        liveVoiceSession.sendText(normalizedText),
        runtime.submitCanonicalUserTurn({
          text: normalizedText,
          source: "typed",
          createdAt: new Date().toISOString()
        })
      ]);

      return {
        sessionState,
        liveState
      };
    }
  };
}
