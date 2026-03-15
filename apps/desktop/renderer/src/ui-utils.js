const timeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit"
});

export function formatTime(iso) {
  if (!iso) {
    return "";
  }

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return timeFormatter.format(date);
}

export function formatTaskRunnerStatus(status) {
  switch (status) {
    case "created":
    case "queued":
      return "Preparing";
    case "running":
      return "Running";
    case "waiting_input":
      return "Waiting for input";
    case "approval_required":
      return "Waiting for approval";
    case "completed":
      return "Completed";
    case "failed":
      return "Needs attention";
    case "cancelled":
      return "Cancelled";
    default:
      return status;
  }
}

export function formatVerificationStatus(verification) {
  if (verification === "verified") {
    return "Verified directly";
  }

  if (verification === "uncertain") {
    return "Needs more verification";
  }

  return "No verification details";
}

function parseExecutorDebugDetail(detail) {
  if (typeof detail !== "string" || !detail.trim()) {
    return null;
  }

  try {
    return JSON.parse(detail);
  } catch {
    return null;
  }
}

function getTaskRunnerDetailMap(summary) {
  return new Map(
    (summary.taskRunnerDetails ?? []).map((detail) => [detail.taskId, detail])
  );
}

function buildTaskTimelineMap(summary) {
  return new Map(
    (summary.taskTimelines ?? []).map((timeline) => [timeline.taskId, timeline.events])
  );
}

function getTaskRunnerPriority(status) {
  if (status === "waiting_input" || status === "approval_required") {
    return 0;
  }

  if (status === "running") {
    return 1;
  }

  if (status === "created" || status === "queued") {
    return 2;
  }

  if (status === "completed") {
    return 3;
  }

  return 4;
}

export function getTaskRunnerAccent(status) {
  if (status === "waiting_input" || status === "approval_required") {
    return "waiting";
  }

  if (status === "failed") {
    return "failed";
  }

  if (status === "completed") {
    return "completed";
  }

  return "running";
}

function hydrateTaskRunnerEntry(summary, baseEntry, index = 0) {
  const timelineByTaskId = buildTaskTimelineMap(summary);
  const detailByTaskId = getTaskRunnerDetailMap(summary);
  const activeTasksById = new Map(
    (summary.activeTasks ?? []).map((task) => [task.id, task])
  );
  const task = activeTasksById.get(baseEntry.taskId);
  const detail = detailByTaskId.get(baseEntry.taskId);
  const latestEvent = (timelineByTaskId.get(baseEntry.taskId) ?? []).at(-1);
  const executionTrace = detail?.executionTrace ?? [];
  const advancedTrace = detail?.advancedTrace ?? [];
  const latestExecutionTrace = executionTrace.at(-1) ?? null;

  return {
    ...baseEntry,
    label: baseEntry.label ?? `Task Runner ${index + 1}`,
    title: detail?.title ?? baseEntry.title ?? task?.title ?? "Untitled task",
    headline:
      detail?.headline ??
      baseEntry.headline ??
      baseEntry.title ??
      task?.title ??
      "Untitled task",
    statusLabel:
      detail?.statusLabel ??
      baseEntry.statusLabel ??
      formatTaskRunnerStatus(baseEntry.status),
    heroSummary:
      detail?.heroSummary ??
      baseEntry.latestHumanUpdate ??
      baseEntry.progressSummary ??
      latestEvent?.message ??
      "Summarizing the current progress for this task.",
    latestHumanUpdate:
      detail?.latestHumanUpdate ??
      baseEntry.latestHumanUpdate ??
      baseEntry.progressSummary ??
      latestEvent?.message ??
      "A progress update will appear here shortly.",
    needsUserAction:
      detail?.needsUserAction ??
      baseEntry.needsUserAction ??
      baseEntry.blockingReason ??
      null,
    requestSummary: detail?.requestSummary ?? null,
    timeline: detail?.timeline ?? [],
    resultSummary: detail?.resultSummary ?? task?.completionReport?.summary ?? null,
    detailedAnswer:
      detail?.detailedAnswer ?? task?.completionReport?.detailedAnswer ?? null,
    keyFindings: detail?.keyFindings ?? task?.completionReport?.keyFindings ?? [],
    verification:
      detail?.verification ?? task?.completionReport?.verification ?? null,
    changes: detail?.changes ?? task?.completionReport?.changes ?? [],
    question: detail?.question ?? task?.completionReport?.question ?? null,
    executionTrace,
    advancedTrace,
    traceCount: executionTrace.length + advancedTrace.length,
    timelinePreview:
      detail?.timeline?.at(-1)?.body ??
      detail?.timeline?.at(-1)?.title ??
      latestExecutionTrace?.body ??
      latestExecutionTrace?.title ??
      latestEvent?.message ??
      null,
    latestExecutionTraceTitle: latestExecutionTrace?.title ?? null,
    latestExecutionTraceBody: latestExecutionTrace?.body ?? null,
    lastUpdatedAt:
      detail?.lastUpdatedAt ??
      baseEntry.lastUpdatedAt ??
      latestExecutionTrace?.createdAt ??
      latestEvent?.createdAt ??
      task?.updatedAt ??
      null
  };
}

export function buildTaskRunnerEntries(summary) {
  return [...(summary.avatar?.taskRunners ?? [])]
    .map((runner, index) => hydrateTaskRunnerEntry(summary, runner, index))
    .sort((left, right) => {
      const priorityDiff =
        getTaskRunnerPriority(left.status) - getTaskRunnerPriority(right.status);
      if (priorityDiff !== 0) {
        return priorityDiff;
      }

      const leftTime = left.lastUpdatedAt ? new Date(left.lastUpdatedAt).getTime() : 0;
      const rightTime = right.lastUpdatedAt ? new Date(right.lastUpdatedAt).getTime() : 0;
      return rightTime - leftTime;
    });
}

export function buildArchivedTaskEntries(summary) {
  const activeTaskIds = new Set((summary.activeTasks ?? []).map((task) => task.id));

  return [...(summary.recentTasks ?? [])]
    .filter((task) => !activeTaskIds.has(task.id))
    .map((task, index) =>
      hydrateTaskRunnerEntry(
        summary,
        {
          taskId: task.id,
          label: `Task ${task.id.slice(-4)}`,
          title: task.title,
          status: task.status,
          headline: task.title,
          statusLabel: formatTaskRunnerStatus(task.status),
          latestHumanUpdate:
            task.completionReport?.summary ?? "Open this task to review its logs.",
          lastUpdatedAt: task.updatedAt
        },
        index
      )
    )
    .sort((left, right) => {
      const leftTime = left.lastUpdatedAt ? new Date(left.lastUpdatedAt).getTime() : 0;
      const rightTime = right.lastUpdatedAt ? new Date(right.lastUpdatedAt).getTime() : 0;
      return rightTime - leftTime;
    });
}

export function buildTaskRunnerDisplayTimeline(summary, debugEvents, selectedRunner) {
  const baseEntries = [...(selectedRunner.timeline ?? [])];
  const executionTraceEntries = (selectedRunner.executionTrace ?? []).map((entry) => ({
    kind:
      entry.kind === "error"
        ? "failure"
        : entry.kind === "tool_use" || entry.kind === "tool_result" || entry.kind === "message"
          ? "progress_update"
          : entry.kind === "result"
            ? "completion_received"
            : "progress_update",
    title:
      entry.kind === "tool_use" || entry.kind === "tool_result"
        ? entry.title
        : entry.kind === "message"
          ? "Executor note"
          : entry.title,
    body: entry.body ?? entry.detail ?? entry.title,
    createdAt: entry.createdAt,
    emphasis:
      entry.kind === "error"
        ? "error"
        : entry.kind === "result"
          ? "success"
          : "info",
    source: "executor"
  }));

  const notifications = [
    ...(summary.notifications?.delivered ?? []),
    ...(summary.notifications?.pending ?? [])
  ]
    .filter((plan) => plan?.taskId === selectedRunner.taskId && plan.uiText)
    .map((plan) => ({
      kind:
        plan.reason === "approval_required"
          ? "needs_approval"
          : plan.reason === "task_waiting_input"
            ? "needs_input"
            : plan.reason === "task_failed"
              ? "failure"
              : plan.reason === "task_completed"
                ? "completion_received"
                : "progress_update",
      title:
        plan.reason === "approval_required"
          ? "Runtime asked for approval"
          : plan.reason === "task_waiting_input"
            ? "Runtime asked for more input"
            : plan.reason === "task_failed"
              ? "Runtime reported a blocker"
              : plan.reason === "task_completed"
                ? "Runtime completion briefing"
                : "Runtime note",
      body: plan.uiText,
      createdAt: plan.createdAt ?? selectedRunner.lastUpdatedAt ?? new Date().toISOString(),
      emphasis:
        plan.reason === "task_failed"
          ? "error"
          : plan.reason === "approval_required" || plan.reason === "task_waiting_input"
            ? "warning"
            : plan.reason === "task_completed"
              ? "success"
              : "info",
      source: "system"
    }));

  const runtimeEvents = (debugEvents ?? [])
    .filter((event) => event.source === "runtime" && event.taskId === selectedRunner.taskId)
    .map((event) => ({
      kind:
        event.kind === "task_intake"
          ? "needs_input"
          : selectedRunner.status === "failed"
            ? "failure"
            : "progress_update",
      title: event.kind === "task_intake" ? "Runtime clarification" : "Runtime note",
      body: event.summary,
      createdAt: event.createdAt,
      emphasis: event.kind === "task_intake" ? "warning" : "info",
      source: "system"
    }));

  return [...baseEntries, ...executionTraceEntries, ...notifications, ...runtimeEvents]
    .sort(
      (left, right) =>
        new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
    )
    .filter((entry, index, list) => {
      const previous = list[index - 1];
      return !(
        previous &&
        previous.kind === entry.kind &&
        previous.title === entry.title &&
        previous.body === entry.body &&
        previous.createdAt === entry.createdAt
      );
    });
}

export function buildAdvancedTraceEntries(debugEvents, taskId, selectedRunner) {
  const executionPayloadEntries = (selectedRunner?.executionTrace ?? [])
    .filter((entry) => entry.payloadJson && Object.keys(entry.payloadJson).length > 0)
    .map((entry) => ({
      id: `${taskId}:payload:${entry.seq}`,
      kind: `${entry.kind}_payload`,
      createdAt: entry.createdAt,
      body: entry.title,
      meta: JSON.stringify(entry.payloadJson, null, 2)
    }));

  const detailEntries = (selectedRunner?.advancedTrace ?? []).map((entry, index) => ({
    id: `${taskId}:detail:${entry.createdAt}:${index}`,
    kind: entry.kind,
    createdAt: entry.createdAt,
    body: entry.summary,
    meta: entry.detail ?? ""
  }));

  const debugEntries = (debugEvents ?? [])
    .filter((event) => event.source === "executor" && event.taskId === taskId)
    .map((event) => {
      const parsed = parseExecutorDebugDetail(event.detail);
      const body =
        parsed?.responseSnippet ??
        parsed?.messageSnippet ??
        parsed?.payloadPreview ??
        event.detail ??
        event.summary;
      const meta = [
        parsed?.name ? `name=${parsed.name}` : null,
        parsed?.status ? `status=${parsed.status}` : null
      ]
        .filter(Boolean)
        .join(" · ");

      return {
        id: event.id,
        kind: event.kind,
        createdAt: event.createdAt,
        body,
        meta
      };
    });

  return [...executionPayloadEntries, ...detailEntries, ...debugEntries].sort(
    (left, right) =>
      new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
  );
}

export function buildHistoryEntries(historySummary) {
  return (historySummary.sessions ?? []).map((session) => {
    const latestTask = (session.recentTasks ?? [])[0];
    const primaryText =
      session.lastAssistantMessage ??
      latestTask?.summary ??
      "No assistant reply saved yet.";
    const taskSummary =
      (session.recentTasks ?? []).length > 0
        ? (session.recentTasks ?? [])
            .map((task) =>
              [task.title, task.status, task.summary ?? null].filter(Boolean).join(" · ")
            )
            .join(" | ")
        : "No saved tasks.";

    return {
      id: session.brainSessionId,
      title: session.brainSessionId,
      subtitle: [
        session.source ?? "live",
        session.status ?? "unknown",
        session.updatedAt ? formatTime(session.updatedAt) : null
      ]
        .filter(Boolean)
        .join(" · "),
      text: primaryText,
      meta: taskSummary
    };
  });
}

export function buildConversationRoleLabel(item) {
  return item.kind === "task_event"
    ? "task event"
    : item.responseSource
        ? `assistant · ${item.responseSource}`
        : "assistant";
}

export function buildDisplayConversationTimeline(uiState) {
  const timeline = (Array.isArray(uiState?.conversationTimeline)
    ? [...uiState.conversationTimeline]
    : []
  ).filter((item) => item?.speaker !== "user");

  const turnsById = new Map((uiState?.conversationTurns ?? []).map((turn) => [turn.turnId, turn]));

  return timeline.sort((left, right) => {
    const leftTurn = turnsById.get(left.turnId);
    const rightTurn = turnsById.get(right.turnId);
    const leftStart = new Date(leftTurn?.startedAt ?? left.createdAt ?? "").getTime();
    const rightStart = new Date(rightTurn?.startedAt ?? right.createdAt ?? "").getTime();
    if (leftStart !== rightStart) {
      return leftStart - rightStart;
    }

    const leftCreated = new Date(left.createdAt ?? "").getTime();
    const rightCreated = new Date(right.createdAt ?? "").getTime();
    if (leftCreated !== rightCreated) {
      return leftCreated - rightCreated;
    }

    if (left.turnId !== right.turnId) {
      return String(left.turnId).localeCompare(String(right.turnId));
    }

    const leftPriority = left.kind === "user_message" ? 0 : left.kind === "assistant_message" ? 1 : 2;
    const rightPriority = right.kind === "user_message" ? 0 : right.kind === "assistant_message" ? 1 : 2;
    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }

    return String(left.id).localeCompare(String(right.id));
  });
}

export function filterDebugEvents(debugInspector, filters, turnFilter, taskFilter) {
  const activeSources = new Set(
    Object.entries(filters)
      .filter(([, enabled]) => enabled)
      .map(([source]) => source)
  );

  return (debugInspector?.events ?? []).filter((event) => {
    if (!activeSources.has(event.source)) {
      return false;
    }

    if (turnFilter && !(event.turnId ?? "").includes(turnFilter)) {
      return false;
    }

    if (taskFilter && !(event.taskId ?? "").includes(taskFilter)) {
      return false;
    }

    return true;
  });
}
