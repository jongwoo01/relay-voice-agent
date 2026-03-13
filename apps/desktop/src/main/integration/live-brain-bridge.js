import { logDesktop } from "../debug/desktop-log.js";

const TASK_FOLLOW_UP_HINTS =
  /(그거|그건|그 일|그 작업|아까|방금|진행|상태|어디까지|됐어|됐나|완료|끝났|결과|뭐가 있었|확인 중|확인해|briefing|done|finished|status|progress|result|update)/i;
const TASK_RESULT_DETAIL_HINTS =
  /(읽어|읽었|봤어|봤나|찾았|찾았어|보고|보고해|브리핑|요약|말해|설명|개수|갯수|몇 개|이름|목록|뭐였|무엇|어떤)/i;
const TASK_REPAIR_FOLLOW_UP_HINTS =
  /(진짜|정말|for real|really|seriously|왜|why|what do you mean|무슨 말|아니|아닌데|아냐|틀렸|잘못|다시|retry|recheck|redo|wrong|delete|삭제|지우|create|만들라고|생성하라|내가 .*말|i said|i told you|not what|don't delete|wait|hold on)/i;
const SHORT_CHALLENGE_FOLLOW_UP_HINTS =
  /^(for real\??|really\??|seriously\??|진짜\??|정말\??|왜\??|아니\??|아닌데\??|맞아\??|확실해\??|뭐라고\??)$/i;

const TOOL_CONTINUATION_STATUSES = new Set(["queued", "running"]);
const TOOL_ATTENTION_STATUSES = new Map([
  ["completed", "WHEN_IDLE"],
  ["failed", "INTERRUPT"],
  ["waiting_input", "INTERRUPT"],
  ["approval_required", "INTERRUPT"]
]);
const DUPLICATE_RUNNING_CONTINUATION_SCHEDULING = "SILENT";

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

function normalizeStatusLabel(status) {
  switch (status) {
    case "running":
      return "still running";
    case "waiting_input":
      return "waiting for user input";
    case "approval_required":
      return "waiting for user approval";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    default:
      return status;
  }
}

function getLatestTimelineEvent(state, taskId) {
  return state?.taskTimelines?.find((timeline) => timeline.taskId === taskId)?.events?.at(-1);
}

function hasRuntimeGuardState(state) {
  return Boolean(
    state?.intake?.active ||
      (state?.tasks?.length ?? 0) > 0 ||
      (state?.notifications?.pending?.length ?? 0) > 0
  );
}

function hasRecentTaskContext(state) {
  return Boolean(
    (state?.tasks?.length ?? 0) > 0 ||
      (state?.recentTasks?.length ?? 0) > 0 ||
      (state?.notifications?.pending?.length ?? 0) > 0 ||
      (state?.notifications?.delivered?.length ?? 0) > 0
  );
}

function shouldRouteThroughRuntimeState(state, text) {
  if (!state) {
    return false;
  }

  if (state.intake?.active) {
    return true;
  }

  if (
    state.tasks?.some(
      (task) =>
        task.status === "waiting_input" || task.status === "approval_required"
    )
  ) {
    return true;
  }

  if ((state.tasks?.length ?? 0) === 0 && (state.recentTasks?.length ?? 0) === 0) {
    return false;
  }

  return TASK_FOLLOW_UP_HINTS.test(text.trim());
}

function shouldUseDelegateBackend(state, text) {
  if (!state) {
    return false;
  }

  const normalized = text.trim();
  if (!normalized || !hasRecentTaskContext(state)) {
    return false;
  }

  if (TASK_FOLLOW_UP_HINTS.test(normalized)) {
    return true;
  }

  const latestRecentTask = state?.recentTasks?.[0];
  const latestDelivered = state?.notifications?.delivered?.at(-1);
  if (
    latestRecentTask?.status === "completed" ||
    latestDelivered?.reason === "task_completed"
  ) {
    return (
      TASK_RESULT_DETAIL_HINTS.test(normalized) ||
      looksLikeForceRuntimeFirst(normalized)
    );
  }

  return false;
}

function looksLikeTaskRepairFollowUp(text) {
  const normalized = text.trim();
  if (!normalized) {
    return false;
  }

  return (
    TASK_REPAIR_FOLLOW_UP_HINTS.test(normalized) ||
    SHORT_CHALLENGE_FOLLOW_UP_HINTS.test(normalized)
  );
}

function buildRuntimeContextSummary(state) {
  if (state?.intake?.active) {
    const missing = state.intake.missingSlots?.join(", ") || "more details";
    return `Runtime status: task intake is collecting details for "${state.intake.workingText || "current request"}". Missing: ${missing}. Do not state any results yet. If asked, say you are checking and need the missing details first.`;
  }

  const activeTask = state?.tasks?.[0] ?? state?.recentTasks?.[0];
  if (activeTask) {
    const latestEvent = getLatestTimelineEvent(state, activeTask.id);
    const latestDetail = latestEvent?.message
      ? ` Latest confirmed update: ${latestEvent.message}.`
      : "";
    return `Runtime status: task "${activeTask.title}" is ${normalizeStatusLabel(activeTask.status)}.${latestDetail} Do not state local facts or task results unless executor output confirmed them. If asked, say you are checking.`;
  }

  const latestBriefing =
    state?.notifications?.pending?.at(-1) ?? state?.notifications?.delivered?.at(-1);
  if (latestBriefing?.uiText) {
    return `Runtime status: latest task briefing is "${latestBriefing.uiText}". Prefer grounded updates from runtime state over inference.`;
  }

  return "Runtime status: no task is currently active. For local machine questions, check first instead of guessing.";
}

function isRecord(value) {
  return typeof value === "object" && value !== null;
}

function truncateForLog(value, max = 160) {
  if (typeof value !== "string" || value.length <= max) {
    return value ?? null;
  }

  return `${value.slice(0, max)}...`;
}

function summarizeRuntimeState(state) {
  return {
    intake: state?.intake?.active
      ? {
          active: true,
          missingSlots: state.intake.missingSlots ?? [],
          workingText: truncateForLog(state.intake.workingText)
        }
      : { active: false },
    activeTasks: (state?.tasks ?? []).map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status
    })),
    recentTasks: (state?.recentTasks ?? []).map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status
    })),
    latestNotification:
      state?.notifications?.pending?.at(-1)?.reason ??
      state?.notifications?.delivered?.at(-1)?.reason ??
      null
  };
}

function summarizeToolOutput(result) {
  return {
    action: result?.action ?? null,
    accepted: result?.accepted ?? null,
    taskId: result?.taskId ?? null,
    status: result?.status ?? null,
    failureReason: result?.failureReason ?? null,
    message: truncateForLog(result?.message),
    summary: truncateForLog(result?.summary)
  };
}

function mapDelegateResultToAssistantTone(result) {
  if (result?.action === "clarify") {
    return "clarify";
  }

  if (
    result?.action === "created" ||
    result?.action === "resumed" ||
    (result?.accepted && result?.status === "running")
  ) {
    return "task_ack";
  }

  return "reply";
}

function normalizeDelegateMode(value) {
  return value === "new_task" ||
    value === "resume" ||
    value === "status" ||
    value === "auto"
    ? value
    : undefined;
}

function shouldPreferLiveToolRouting({
  liveVoiceSession,
  runtimeState,
  text,
  intent
}) {
  if (typeof liveVoiceSession.prefersToolRouting !== "function") {
    return false;
  }

  if (!liveVoiceSession.prefersToolRouting()) {
    return false;
  }

  const normalized = text.trim();
  if (!normalized) {
    return false;
  }

  return (
    intent === "task_request" ||
    looksLikeForceRuntimeFirst(normalized) ||
    shouldUseDelegateBackend(runtimeState, normalized) ||
    shouldRouteThroughRuntimeState(runtimeState, normalized)
  );
}

export function createLiveBrainBridge({ runtime, liveVoiceSession }) {
  const pendingToolContinuations = new Map();
  let lastDelegateActivityAt = 0;

  function noteDelegateActivity() {
    lastDelegateActivityAt = Date.now();
  }

  function hasFreshDelegateActivity(maxAgeMs = 90_000) {
    return lastDelegateActivityAt > 0 && Date.now() - lastDelegateActivityAt <= maxAgeMs;
  }

  function shouldForceDelegateBackend(state, text) {
    if (!state || !hasRecentTaskContext(state)) {
      return false;
    }

    const normalized = text.trim();
    if (!normalized || !hasFreshDelegateActivity()) {
      return false;
    }

    return looksLikeTaskRepairFollowUp(normalized);
  }

  async function applyRuntimeContextFromState(state) {
    await liveVoiceSession.syncRuntimeContext(buildRuntimeContextSummary(state), {
      guardActive: hasRuntimeGuardState(state)
    });
  }

  async function flushToolContinuations(state) {
    const updates = [];

    for (const [taskId, continuation] of pendingToolContinuations.entries()) {
      const task =
        state?.tasks?.find((candidate) => candidate.id === taskId) ??
        state?.recentTasks?.find((candidate) => candidate.id === taskId);

      if (!task) {
        continue;
      }

      const scheduling = TOOL_ATTENTION_STATUSES.get(task.status);
      if (!scheduling) {
        continue;
      }

      logDesktop(
        `[live-brain-bridge] flushing tool continuation: ${JSON.stringify({
          taskId,
          callId: continuation.callId,
          lastStatus: continuation.lastStatus,
          nextStatus: task.status,
          scheduling
        })}`
      );

      const { result } = await runtime.handleDelegateToGeminiCli({
        request: "상태 알려줘",
        taskId,
        mode: "status",
        now: new Date().toISOString()
      });

      updates.push({
        id: continuation.callId,
        name: "delegate_to_gemini_cli",
        response: {
          output: result
        },
        scheduling,
        willContinue: false
      });
      logDesktop(
        `[live-brain-bridge] tool response queued: ${JSON.stringify({
          callId: continuation.callId,
          taskId,
          scheduling,
          output: summarizeToolOutput(result)
        })}`
      );
      pendingToolContinuations.delete(taskId);
      noteDelegateActivity();
    }

    if (updates.length === 0) {
      return;
    }

    await liveVoiceSession.noteBridgeDecision(
      `tool continuation update: ${updates
        .map((update) => `${update.name} ${update.scheduling}`)
        .join(", ")}`
    );
    await liveVoiceSession.sendToolResponses(updates);
  }

  async function resolveVoiceRoutingTarget(finalText, context = {}) {
    const runtimeState = await runtime.collectState();
    await applyRuntimeContextFromState(runtimeState);
    const normalizedFinalText = finalText.trim();

    if (
      shouldRouteThroughRuntimeState(runtimeState, normalizedFinalText) ||
      shouldForceDelegateBackend(runtimeState, normalizedFinalText)
    ) {
      return {
        text: normalizedFinalText,
        intent: "task_request",
        matchedFromHint: false,
        forced: true,
        runtimeState
      };
    }

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
        forced: true,
        runtimeState
      };
    }

    const finalIntent = await runtime.resolveIntent(normalizedFinalText);
    if (finalIntent === "task_request") {
      return {
        text: normalizedFinalText,
        intent: finalIntent,
        matchedFromHint: false,
        forced: false,
        runtimeState
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
          forced: false,
          runtimeState
        };
      }
    }

    return {
      text: normalizedFinalText,
      intent: finalIntent,
      matchedFromHint: false,
      forced: false,
      runtimeState
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

      logDesktop(
        `[live-brain-bridge] voice routing context: ${JSON.stringify({
          intent,
          forced: routingTarget.forced,
          matchedFromHint: routingTarget.matchedFromHint,
          prefersToolRouting:
            typeof liveVoiceSession.prefersToolRouting === "function"
              ? liveVoiceSession.prefersToolRouting()
              : false,
          runtimeGuardState: hasRuntimeGuardState(routingTarget.runtimeState),
          hasRecentTaskContext: hasRecentTaskContext(routingTarget.runtimeState),
          shouldRouteThroughRuntimeState: shouldRouteThroughRuntimeState(
            routingTarget.runtimeState,
            routingTarget.text
          ),
          shouldUseDelegateBackend: shouldUseDelegateBackend(
            routingTarget.runtimeState,
            routingTarget.text
          ),
          shouldForceDelegateBackend: shouldForceDelegateBackend(
            routingTarget.runtimeState,
            routingTarget.text
          ),
          shouldPreferLiveToolRouting: shouldPreferLiveToolRouting({
            liveVoiceSession,
            runtimeState: routingTarget.runtimeState,
            text: routingTarget.text,
            intent
          })
        })}`
      );

      if (
        !shouldForceDelegateBackend(routingTarget.runtimeState, routingTarget.text) &&
        shouldPreferLiveToolRouting({
          liveVoiceSession,
          runtimeState: routingTarget.runtimeState,
          text: routingTarget.text,
          intent
        })
      ) {
        await liveVoiceSession.noteBridgeDecision(
          `voice live-tool: ${routingTarget.text}`
        );
        return {
          mode: "live-runtime",
          sessionState: routingTarget.runtimeState
        };
      }

      if (intent === "task_request") {
        await liveVoiceSession.noteRuntimeFirstDelegation(
          routingTarget.text,
          "voice"
        );
        if (
          shouldUseDelegateBackend(routingTarget.runtimeState, routingTarget.text) ||
          shouldForceDelegateBackend(routingTarget.runtimeState, routingTarget.text)
        ) {
          logDesktop(
            `[live-brain-bridge] delegate backend request: ${JSON.stringify({
              source: "voice",
              request: routingTarget.text,
              mode: "auto",
              runtimeState: summarizeRuntimeState(routingTarget.runtimeState)
            })}`
          );
          const delegated = await runtime.handleDelegateToGeminiCli({
            request: routingTarget.text,
            mode: "auto",
            now: createdAt
          });
          noteDelegateActivity();
          logDesktop(
            `[live-brain-bridge] delegate backend result: ${JSON.stringify({
              source: "voice",
              request: routingTarget.text,
              output: summarizeToolOutput(delegated.result),
              runtimeState: summarizeRuntimeState(delegated.state)
            })}`
          );
          await liveVoiceSession.noteBridgeDecision(
            `voice delegate backend: ${delegated.result.action} ${delegated.result.status}`
          );
          await applyRuntimeContextFromState(delegated.state);
          return {
            mode: "runtime-first",
            assistant: {
              text: delegated.result.message,
              tone: mapDelegateResultToAssistantTone(delegated.result)
            },
            sessionState: delegated.state
          };
        }
        const result = await submitRuntimeFirstTurn({
          text: routingTarget.text,
          source: "voice",
          createdAt,
          intent
        });
        await applyRuntimeContextFromState(result.sessionState);
        return result;
      }

      const sessionState = await runtime.submitCanonicalUserTurn({
        text: normalizedText,
        source: "voice",
        createdAt,
        intent
      });
      await applyRuntimeContextFromState(sessionState);

      return {
        mode: "live-runtime",
        sessionState
      };
    },

    async sendTypedTurn(text) {
      const normalizedText = text.trim();
      if (!normalizedText) {
        const sessionState = await runtime.collectState();
        await applyRuntimeContextFromState(sessionState);
        return {
          sessionState,
          liveState: await liveVoiceSession.getState()
        };
      }

      await liveVoiceSession.connect();
      const initialRuntimeState = await runtime.collectState();
      await applyRuntimeContextFromState(initialRuntimeState);
      // Product invariant: every chat-box typed turn goes to Live.
      // Typed input must never be diverted to runtime-first handling,
      // even when there is an active task or intake state.
      logDesktop(`[live-brain-bridge] typed turn -> live: ${normalizedText}`);
      await liveVoiceSession.noteBridgeDecision(`typed live: ${normalizedText}`);
      const liveState = await liveVoiceSession.sendText(normalizedText);
      return {
        sessionState: initialRuntimeState,
        liveState
      };
    },

    async handleToolCalls(functionCalls) {
      const responses = [];

      for (const functionCall of functionCalls) {
        if (functionCall.name !== "delegate_to_gemini_cli") {
          responses.push({
            id: functionCall.id,
            name: functionCall.name ?? "unknown_tool",
            response: {
              error: `Unsupported live tool: ${functionCall.name ?? "unknown"}`
            }
          });
          continue;
        }

        const args = isRecord(functionCall.args) ? functionCall.args : {};
        const request =
          typeof args.request === "string" ? args.request.trim() : "";
        const taskId = typeof args.taskId === "string" ? args.taskId : undefined;
        const mode = normalizeDelegateMode(args.mode);

        const { result, state } = await runtime.handleDelegateToGeminiCli({
          request,
          taskId,
          mode,
          now: new Date().toISOString()
        });
        noteDelegateActivity();
        logDesktop(
          `[live-brain-bridge] live tool delegate request/result: ${JSON.stringify({
            callId: functionCall.id,
            request,
            taskId: taskId ?? null,
            mode: mode ?? "auto",
            output: summarizeToolOutput(result),
            runtimeState: summarizeRuntimeState(state)
          })}`
        );
        await liveVoiceSession.noteBridgeDecision(
          `tool delegate_to_gemini_cli: ${result.action} ${result.status}`
        );
        await applyRuntimeContextFromState(state);
        responses.push({
          id: functionCall.id,
          name: "delegate_to_gemini_cli",
          response: {
            output: result
          },
          ...(result.taskId &&
          pendingToolContinuations.has(result.taskId) &&
          TOOL_CONTINUATION_STATUSES.has(result.status)
            ? { scheduling: DUPLICATE_RUNNING_CONTINUATION_SCHEDULING }
            : {}),
          ...(TOOL_CONTINUATION_STATUSES.has(result.status)
            ? { willContinue: true }
            : {})
        });
        logDesktop(
          `[live-brain-bridge] tool response queued: ${JSON.stringify({
            callId: functionCall.id,
            output: summarizeToolOutput(result),
            willContinue: TOOL_CONTINUATION_STATUSES.has(result.status),
            scheduling:
              result.taskId &&
              pendingToolContinuations.has(result.taskId) &&
              TOOL_CONTINUATION_STATUSES.has(result.status)
                ? DUPLICATE_RUNNING_CONTINUATION_SCHEDULING
                : null
          })}`
        );

        if (
          TOOL_CONTINUATION_STATUSES.has(result.status) &&
          result.accepted &&
          result.taskId
        ) {
          const existingContinuation = pendingToolContinuations.get(result.taskId);
          logDesktop(
            `[live-brain-bridge] tracking tool continuation: ${JSON.stringify({
              taskId: result.taskId,
              callId: functionCall.id,
              status: result.status,
              duplicate: Boolean(existingContinuation)
            })}`
          );
          pendingToolContinuations.set(result.taskId, {
            callId: functionCall.id,
            lastStatus: result.status
          });
        } else if (
          result.taskId &&
          !TOOL_CONTINUATION_STATUSES.has(result.status)
        ) {
          pendingToolContinuations.delete(result.taskId);
        }
      }

      return responses;
    },

    async syncRuntimeContextFromState(state) {
      await applyRuntimeContextFromState(state);
      await flushToolContinuations(state);
      return liveVoiceSession.getState();
    }
  };
}
