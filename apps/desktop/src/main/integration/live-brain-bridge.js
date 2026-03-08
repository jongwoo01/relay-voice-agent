import { logDesktop } from "../debug/desktop-log.js";

export function createLiveBrainBridge({ runtime, liveVoiceSession }) {
  return {
    async handleFinalTranscript(text) {
      logDesktop(`[live-brain-bridge] final transcript -> runtime: ${text}`);
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

      const createdAt = new Date().toISOString();
      const intent = await runtime.resolveIntent(normalizedText);
      logDesktop(
        `[live-brain-bridge] typed turn -> ${
          intent === "task_request" ? "runtime-first" : "live/runtime"
        }: ${normalizedText}`
      );
      await liveVoiceSession.connect();
      if (intent === "task_request") {
        await liveVoiceSession.recordExternalUserTurn(normalizedText, createdAt);
        const { handled, state: sessionState } =
          await runtime.submitCanonicalUserTurnForDecision({
            text: normalizedText,
            source: "typed",
            createdAt,
            intent
          });
        if (handled?.assistant?.text) {
          await liveVoiceSession.injectAssistantMessage(
            handled.assistant.text,
            handled.assistant.tone
          );
        }

        return {
          sessionState,
          liveState: await liveVoiceSession.getState()
        };
      }

      const [liveState, sessionState] = await Promise.all([
        liveVoiceSession.sendText(normalizedText),
        runtime.submitCanonicalUserTurn({
          text: normalizedText,
          source: "typed",
          createdAt,
          intent
        })
      ]);

      return {
        sessionState,
        liveState
      };
    }
  };
}
