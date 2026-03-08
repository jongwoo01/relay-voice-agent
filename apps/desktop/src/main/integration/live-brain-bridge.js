import { logDesktop } from "../debug/desktop-log.js";

function looksLikeForceRuntimeFirst(text) {
  const normalized = text.trim();
  if (!normalized) {
    return false;
  }

  return /바탕화면|화면|데스크톱|다운로드|폴더|파일|프로젝트|브라우저|탭|앱|개수|갯수|종류|이름|workspace|desktop|downloads|folder|file/i.test(
    normalized
  );
}

function scoreVoiceRoutingCandidate(text) {
  const normalized = text.trim();
  if (!normalized) {
    return -1;
  }

  let score = normalized.length;
  if (
    /바탕화면|데스크톱|다운로드|폴더|파일|프로젝트|브라우저|탭|앱|desktop|downloads|folder|file/i.test(
      normalized
    )
  ) {
    score += 50;
  }
  if (
    /알려줘|보여줘|찾아줘|정리해줘|실행|요약해줘|개수|갯수|몇 개|무슨|뭐가|보이니|있니/i.test(
      normalized
    )
  ) {
    score += 25;
  }

  return score;
}

export function createLiveBrainBridge({ runtime, liveVoiceSession }) {
  async function resolveVoiceRoutingTarget(finalText, context = {}) {
    const normalizedFinalText = finalText.trim();
    const candidates = [
      normalizedFinalText,
      ...(context.routingHints ?? [])
    ]
      .map((candidate) => candidate.trim())
      .filter(Boolean)
      .filter((candidate, index, all) => all.indexOf(candidate) === index);

    const forcedCandidates = candidates
      .filter(looksLikeForceRuntimeFirst)
      .sort(
        (left, right) =>
          scoreVoiceRoutingCandidate(right) - scoreVoiceRoutingCandidate(left)
      );

    if (forcedCandidates.length > 0) {
      const forcedText = forcedCandidates[0];
      return {
        text: forcedText,
        intent: "task_request",
        matchedFromHint: forcedText !== normalizedFinalText,
        forced: true
      };
    }

    const finalIntent = await runtime.resolveIntent(normalizedFinalText);
    if (finalIntent === "task_request") {
      return {
        text: normalizedFinalText,
        intent: finalIntent,
        matchedFromHint: false,
        forced: false
      };
    }

    const fallbackCandidates = candidates
      .filter((candidate) => candidate !== normalizedFinalText)
      .sort(
        (left, right) =>
          scoreVoiceRoutingCandidate(right) - scoreVoiceRoutingCandidate(left)
      );

    for (const candidate of fallbackCandidates) {
      const intent = await runtime.resolveIntent(candidate);
      if (intent === "task_request") {
        return {
          text: candidate,
          intent,
          matchedFromHint: true,
          forced: false
        };
      }
    }

    return {
      text: normalizedFinalText,
      intent: finalIntent,
      matchedFromHint: false,
      forced: false
    };
  }

  async function submitRuntimeFirstTurn({ text, source, createdAt, intent }) {
    const { handled, state: sessionState } =
      await runtime.submitCanonicalUserTurnForDecision({
        text,
        source,
        createdAt,
        intent
      });

    return {
      mode: "runtime-first",
      assistant: handled?.assistant ?? null,
      sessionState
    };
  }

  return {
    async handleFinalTranscript(text, context = {}) {
      const normalizedText = text.trim();
      if (!normalizedText) {
        return {
          mode: "noop",
          sessionState: await runtime.collectState()
        };
      }

      logDesktop(
        `[live-brain-bridge] handleFinalTranscript final="${normalizedText}" hints=${JSON.stringify(
          context.routingHints ?? []
        )}`
      );

      const createdAt = new Date().toISOString();
      const routingTarget = await resolveVoiceRoutingTarget(
        normalizedText,
        context
      );
      const intent = routingTarget.intent;
      await liveVoiceSession.noteBridgeDecision(
        `${intent === "task_request" ? "runtime-first" : "live-runtime"} voice: ${
          routingTarget.text
        }${routingTarget.forced ? " [forced]" : ""}${
          routingTarget.matchedFromHint ? " [hint]" : ""
        }`
      );
      logDesktop(
        `[live-brain-bridge] final transcript -> ${
          intent === "task_request" ? "runtime-first" : "live/runtime"
        }: ${routingTarget.text}${
          routingTarget.matchedFromHint
            ? ` (from hint, final="${normalizedText}")`
            : ""
        }${routingTarget.forced ? " [forced]" : ""}`
      );

      if (intent === "task_request") {
        await liveVoiceSession.noteRuntimeFirstDelegation(
          routingTarget.text,
          "voice"
        );
        return submitRuntimeFirstTurn({
          text: routingTarget.text,
          source: "voice",
          createdAt,
          intent
        });
      }

      const sessionState = await runtime.submitCanonicalUserTurn({
        text: normalizedText,
        source: "voice",
        createdAt,
        intent
      });

      return {
        mode: "live-runtime",
        sessionState
      };
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
        await liveVoiceSession.noteRuntimeFirstDelegation(
          normalizedText,
          "typed"
        );
        const { assistant, sessionState } = await submitRuntimeFirstTurn({
          text: normalizedText,
          source: "typed",
          createdAt,
          intent
        });
        if (assistant?.text) {
          await liveVoiceSession.injectAssistantMessage(
            assistant.text,
            assistant.tone
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
