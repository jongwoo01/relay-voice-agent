import { useMemo, useState, useEffect } from "react";
import {
  buildAdvancedTraceEntries,
  buildTaskRunnerDisplayTimeline,
  formatTaskRunnerStatus,
  formatTime,
  formatVerificationStatus,
  getTaskRunnerAccent
} from "../../ui-utils.js";
import { useStickToBottom } from "../../hooks/useStickToBottom.js";

function accentTheme(status) {
  switch (getTaskRunnerAccent(status)) {
    case "waiting":
      return {
        pill: "bg-amber-50 text-amber-700 border border-amber-200",
        glow: "from-amber-200/60 via-white/70 to-transparent",
        dot: "bg-amber-400",
        ring: "ring-amber-200/80"
      };
    case "failed":
      return {
        pill: "bg-rose-50 text-rose-700 border border-rose-200",
        glow: "from-rose-200/60 via-white/70 to-transparent",
        dot: "bg-rose-400",
        ring: "ring-rose-200/80"
      };
    case "completed":
      return {
        pill: "bg-emerald-50 text-emerald-700 border border-emerald-200",
        glow: "from-emerald-200/60 via-white/70 to-transparent",
        dot: "bg-emerald-400",
        ring: "ring-emerald-200/80"
      };
    default:
      return {
        pill: "bg-sky-50 text-sky-700 border border-sky-200",
        glow: "from-sky-200/60 via-white/70 to-transparent",
        dot: "bg-sky-400",
        ring: "ring-sky-200/80"
      };
  }
}

function TraceList({ entries, emptyText, className = "max-h-[220px] space-y-3 overflow-y-auto" }) {
  const listRef = useStickToBottom([entries.length, entries.at(-1)?.createdAt]);

  return (
    <div className={className} ref={listRef}>
      {entries.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-400">{emptyText}</p>
      ) : (
        entries.map((entry, index) => (
          <article className="rounded-2xl border border-gray-100 bg-white/85 px-4 py-3 shadow-[0_14px_32px_-24px_rgba(15,23,42,0.35)]" key={`${entry.createdAt}-${entry.kind}-${entry.title}-${index}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="m-0 text-sm font-medium text-gray-800">{entry.title}</p>
                <p className="m-0 mt-1 text-[11px] text-gray-400">{formatTime(entry.createdAt)}</p>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-1.5">
                <span className="rounded-full bg-gray-100 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-gray-500">
                  {entry.kind.replaceAll("_", " ")}
                </span>
                {entry.status ? <span className="rounded-full bg-gray-100 px-2 py-1 text-[10px] text-gray-500">{entry.status}</span> : null}
              </div>
            </div>
            {entry.body ? <p className="m-0 mt-2 text-sm leading-relaxed text-gray-600">{entry.body}</p> : null}
            {entry.toolName || entry.role || typeof entry.seq === "number" || entry.detail ? (
              <p className="m-0 mt-2 text-xs text-gray-400">
                {[
                  entry.toolName ? `tool=${entry.toolName}` : null,
                  entry.role ? `role=${entry.role}` : null,
                  typeof entry.seq === "number" ? `step=${entry.seq + 1}` : null,
                  entry.detail ?? null
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            ) : null}
            {entry.payloadJson && Object.keys(entry.payloadJson).length > 0 ? (
              <details className="mt-2 rounded-2xl bg-gray-50 p-3">
                <summary className="cursor-pointer text-xs font-medium text-gray-500">Raw payload</summary>
                <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-[11px] leading-relaxed text-gray-500">
                  {JSON.stringify(entry.payloadJson, null, 2)}
                </pre>
              </details>
            ) : null}
          </article>
        ))
      )}
    </div>
  );
}

function TimelineList({ entries }) {
  const listRef = useStickToBottom([entries.length, entries.at(-1)?.createdAt]);

  return (
    <div className="max-h-[260px] space-y-3 overflow-y-auto rounded-[24px] bg-gradient-to-b from-white/95 via-white/80 to-blue-50/40 p-4 ring-1 ring-inset ring-white/70" ref={listRef}>
      {entries.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-400">No progress log is available yet.</p>
      ) : (
        entries.map((entry, index) => (
          <article className="flex gap-3" key={`${entry.createdAt}-${entry.kind}-${entry.title}-${index}`}>
            <span
              aria-hidden="true"
              className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${
                entry.emphasis === "error"
                  ? "bg-rose-400"
                  : entry.emphasis === "success"
                    ? "bg-emerald-400"
                    : entry.emphasis === "warning"
                      ? "bg-amber-400"
                      : "bg-sky-400"
              }`}
            />
            <div className="min-w-0">
              <div className="flex items-start justify-between gap-3">
                <p className="m-0 text-sm font-medium text-gray-800">{entry.title}</p>
                <p className="m-0 shrink-0 text-[11px] text-gray-400">{formatTime(entry.createdAt)}</p>
              </div>
              <p className="m-0 mt-1 text-sm leading-relaxed text-gray-600">{entry.body}</p>
            </div>
          </article>
        ))
      )}
    </div>
  );
}

function TaskRunnerDetail({ runner, summary, debugEvents }) {
  const timelineEntries = useMemo(
    () => buildTaskRunnerDisplayTimeline(summary, debugEvents, runner),
    [summary, debugEvents, runner]
  );
  const advancedTraceEntries = useMemo(
    () => buildAdvancedTraceEntries(debugEvents, runner.taskId, runner),
    [debugEvents, runner]
  );
  const updatedAtText = runner.lastUpdatedAt ? `Last updated · ${formatTime(runner.lastUpdatedAt)}` : "";
  const accent = accentTheme(runner.status);

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <div className={`rounded-[28px] bg-gradient-to-br ${accent.glow} px-5 py-5 shadow-[0_20px_60px_-40px_rgba(59,130,246,0.45)] ring-1 ring-inset ring-white/70`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400">{runner.label}</p>
            <h4 className="m-0 mt-2 text-lg font-semibold text-gray-800">{runner.headline}</h4>
            <p className="m-0 mt-2 text-sm leading-relaxed text-gray-600">{runner.heroSummary}</p>
          </div>
          <span className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-semibold ${accent.pill}`}>
            {runner.statusLabel ?? formatTaskRunnerStatus(runner.status)}
          </span>
        </div>
      </div>

      {runner.needsUserAction ? (
        <div className="rounded-[24px] border border-amber-200 bg-amber-50/80 px-4 py-4">
          <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-700">Needs Attention</p>
          <p className="m-0 mt-2 text-sm leading-relaxed text-amber-900">{runner.needsUserAction}</p>
        </div>
      ) : null}

      <section className="rounded-[28px] border border-white/70 bg-white/80 px-4 py-4 shadow-[0_18px_45px_-30px_rgba(15,23,42,0.28)] backdrop-blur-xl">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">Selected Task</p>
            <p className="m-0 mt-1 text-sm text-gray-500">{updatedAtText || "Live progress updates appear here."}</p>
          </div>
          <div className={`flex h-11 w-11 items-center justify-center rounded-2xl bg-white/80 shadow-inner ring-1 ${accent.ring}`}>
            <span className={`h-2.5 w-2.5 rounded-full ${accent.dot}`} />
          </div>
        </div>
        <TimelineList entries={timelineEntries} />
      </section>

      {runner.status !== "completed" && (runner.executionTrace?.length ?? 0) > 0 ? (
        <section className="rounded-[28px] border border-white/70 bg-white/80 px-4 py-4 shadow-[0_18px_45px_-30px_rgba(15,23,42,0.28)] backdrop-blur-xl">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">Live Execution Feed</p>
            <p className="m-0 text-[11px] text-gray-400">{runner.executionTrace?.length ?? 0} saved events</p>
          </div>
          <TraceList entries={runner.executionTrace ?? []} emptyText="No saved execution trace is available yet." />
        </section>
      ) : null}

      {runner.detailedAnswer ? (
        <section className="rounded-[28px] border border-white/70 bg-white/80 px-4 py-4 shadow-[0_18px_45px_-30px_rgba(15,23,42,0.28)] backdrop-blur-xl">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">Full Answer</p>
          </div>
          <article className="rounded-[24px] bg-gray-50/80 px-4 py-4 ring-1 ring-inset ring-white/80">
            <p className="m-0 text-sm leading-relaxed text-gray-600">{runner.detailedAnswer}</p>
          </article>
        </section>
      ) : null}

      {(runner.keyFindings?.length ?? 0) > 0 ? (
        <section className="rounded-[28px] border border-white/70 bg-white/80 px-4 py-4 shadow-[0_18px_45px_-30px_rgba(15,23,42,0.28)] backdrop-blur-xl">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">Key Findings</p>
          </div>
          <div className="grid gap-2">
            {runner.keyFindings.map((finding, index) => (
              <article className="rounded-2xl bg-gray-50/80 px-4 py-3 text-sm leading-relaxed text-gray-600 ring-1 ring-inset ring-white/80" key={`${runner.taskId}-finding-${index}`}>
                {finding}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {Boolean(runner.resultSummary) || Boolean(runner.verification) || (runner.changes?.length ?? 0) > 0 ? (
        <section className="rounded-[28px] border border-white/70 bg-white/80 px-4 py-4 shadow-[0_18px_45px_-30px_rgba(15,23,42,0.28)] backdrop-blur-xl">
          <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">Result</p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <article className="rounded-[24px] bg-gray-50/80 px-4 py-4 ring-1 ring-inset ring-white/80">
              <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400">What Changed</p>
              <p className="m-0 mt-2 text-sm leading-relaxed text-gray-600">
                {runner.resultSummary ?? "No result summary yet."}
              </p>
            </article>
            <article className="rounded-[24px] bg-gray-50/80 px-4 py-4 ring-1 ring-inset ring-white/80">
              <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400">Confidence</p>
              <p className="m-0 mt-2 text-sm leading-relaxed text-gray-600">
                {formatVerificationStatus(runner.verification)}
              </p>
            </article>
          </div>

          {(runner.changes?.length ?? 0) > 0 ? (
            <div className="mt-3 rounded-[24px] bg-gray-50/80 px-4 py-4 ring-1 ring-inset ring-white/80">
              <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400">Changes</p>
              <ul className="mb-0 mt-2 space-y-1.5 pl-5 text-sm text-gray-600">
                {runner.changes.map((change, index) => (
                  <li key={`${runner.taskId}-change-${index}`}>{change}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      <details className="rounded-[28px] border border-white/70 bg-white/75 px-4 py-4 shadow-[0_18px_45px_-30px_rgba(15,23,42,0.28)] backdrop-blur-xl">
        <summary className="cursor-pointer list-none text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">Advanced Details</summary>
        <div className="mt-3">
          <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-400">taskId · {runner.taskId}</p>
          {runner.requestSummary ? (
            <p className="m-0 mt-2 text-sm leading-relaxed text-gray-600">Request summary · {runner.requestSummary}</p>
          ) : null}
        </div>
        <div className="mt-4">
          <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-400">Execution trace</p>
          <div className="mt-3 max-h-[240px] space-y-3 overflow-y-auto">
            {advancedTraceEntries.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-400">No advanced execution trace is available yet.</p>
            ) : (
              advancedTraceEntries.map((entry) => (
                <article className="rounded-2xl bg-gray-50/80 px-4 py-3 ring-1 ring-inset ring-white/80" key={entry.id}>
                  <div className="flex items-start justify-between gap-3">
                    <p className="m-0 text-sm font-medium text-gray-800">{entry.kind.replaceAll("_", " ")}</p>
                    <p className="m-0 shrink-0 text-[11px] text-gray-400">{formatTime(entry.createdAt)}</p>
                  </div>
                  <p className="m-0 mt-2 text-sm leading-relaxed text-gray-600">{entry.body ?? "No execution detail"}</p>
                  {entry.meta ? (
                    <pre className="mt-2 overflow-auto whitespace-pre-wrap text-[11px] leading-relaxed text-gray-400">{entry.meta}</pre>
                  ) : null}
                </article>
              ))
            )}
          </div>
        </div>
      </details>
    </div>
  );
}

function TaskRunnerCards({ entries, emptyText, selectedTaskId, onSelect, summary, debugEvents }) {
  if (!entries.length) {
    return <p className="rounded-[24px] border border-dashed border-gray-200 px-4 py-8 text-center text-sm text-gray-400">{emptyText}</p>;
  }

  return entries.map((runner) => {
    const selected = runner.taskId === selectedTaskId;
    const accent = accentTheme(runner.status);
    const supportingParts = [
      runner.latestExecutionTraceTitle
        ? `${runner.latestExecutionTraceTitle}${runner.latestExecutionTraceBody ? ` · ${runner.latestExecutionTraceBody}` : ""}`
        : runner.timelinePreview,
      typeof runner.traceCount === "number" && runner.traceCount > 0
        ? `${runner.traceCount} saved trace item${runner.traceCount === 1 ? "" : "s"}`
        : null,
      runner.lastUpdatedAt ? `Updated ${formatTime(runner.lastUpdatedAt)}` : null
    ].filter(Boolean);

    return (
      <article className="space-y-3" key={runner.taskId}>
        <button
          type="button"
          className={`w-full rounded-[20px] border border-white/70 bg-white/80 px-4 py-3.5 text-left shadow-[0_8px_24px_-10px_rgba(15,23,42,0.15)] backdrop-blur-xl transition-all duration-200 ${
            selected ? "ring-2 ring-sky-200 shadow-[0_12px_32px_-10px_rgba(59,130,246,0.25)]" : "hover:-translate-y-0.5 hover:bg-white/90"
          }`}
          aria-expanded={selected ? "true" : "false"}
          onClick={() => onSelect(selected ? null : runner.taskId)}
        >
          <span className="flex items-start gap-3">
            <span className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] bg-gradient-to-br ${accent.glow} ring-1 ${accent.ring}`} aria-hidden="true">
              <span className={`h-2 w-2 rounded-full ${accent.dot}`} />
              <span className={`absolute inset-1.5 rounded-[10px] bg-white/60 ${runner.status === "running" ? "animate-pulse" : ""}`} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-semibold text-gray-800 leading-snug">{runner.headline}</span>
              <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${accent.pill}`}>
                  {runner.statusLabel ?? formatTaskRunnerStatus(runner.status)}
                </span>
                <span className="text-[11px] text-gray-500 truncate">{runner.latestHumanUpdate}</span>
              </span>
              {!selected && supportingParts.length > 0 ? (
                <span className="mt-1.5 block text-[11px] leading-relaxed text-gray-400 truncate">{supportingParts.join(" · ")}</span>
              ) : null}
            </span>
          </span>
        </button>
        {selected ? (
          <TaskRunnerDetail runner={runner} summary={summary} debugEvents={debugEvents} />
        ) : null}
      </article>
    );
  });
}

export function AgentActivityPanel({
  taskRunners,
  archivedEntries,
  selectedTaskId,
  onSelectTask,
  summary,
  debugEvents,
  voiceConnected,
  pendingBriefingCount
}) {
  const [completedOpen, setCompletedOpen] = useState(false);

  // Auto-open completed drawer if a task inside it is selected
  useEffect(() => {
    const isSelectedArchived = archivedEntries.some((e) => e.taskId === selectedTaskId);
    if (isSelectedArchived) {
      setCompletedOpen(true);
    }
  }, [selectedTaskId, archivedEntries]);

  const anyTaskSelected = selectedTaskId !== null;
  const anyTasksExist = taskRunners.length > 0 || archivedEntries.length > 0;
  return (
    <aside className="relative z-10 flex h-full min-h-0 flex-col rounded-[36px] border border-white/70 bg-white/72 p-5 shadow-[0_30px_120px_-50px_rgba(15,23,42,0.28)] backdrop-blur-2xl">
      {/* ─── Header (fixed) ─── */}
      <div className="flex items-start justify-between gap-4 border-b border-gray-100/90 pb-4 shrink-0">
        <div>
          <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400">Agent Activity</p>
          <h2 className="m-0 mt-1.5 text-lg font-semibold text-gray-800">Tasks &amp; Results</h2>
        </div>
        <span className="rounded-full bg-gray-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          pending {pendingBriefingCount}
        </span>
      </div>

      {/* ─── Single scrollable content area ─── */}
      <div className="mt-4 min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
        {/* Running tasks */}
        <section>
          <p className="m-0 mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">
            {taskRunners.length > 0 ? `Running (${taskRunners.length})` : "Running Now"}
          </p>
          <div className="space-y-2">
            <TaskRunnerCards
              entries={taskRunners}
              emptyText={voiceConnected
                ? "No tasks are running yet."
                : "Task runners will appear here once the session starts."}
              selectedTaskId={selectedTaskId}
              onSelect={onSelectTask}
              summary={summary}
              debugEvents={debugEvents}
            />
          </div>
        </section>

        {/* Completed drawer */}
        {archivedEntries.length > 0 && (
          <section>
            <details
              open={completedOpen}
              onToggle={(e) => setCompletedOpen(e.currentTarget.open)}
              className="group"
            >
              <summary className="cursor-pointer list-none rounded-xl bg-gray-50/80 px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-400 hover:bg-gray-100/80 transition-colors flex items-center justify-between">
                <span>Completed ({archivedEntries.length})</span>
                <span className="text-[10px] opacity-60 group-open:rotate-180 transition-transform">▼</span>
              </summary>
              <div className="mt-2 space-y-2">
                <TaskRunnerCards
                  entries={archivedEntries}
                  emptyText="Completed work will be archived here."
                  selectedTaskId={selectedTaskId}
                  onSelect={onSelectTask}
                  summary={summary}
                  debugEvents={debugEvents}
                />
              </div>
            </details>
          </section>
        )}

        {/* Empty state / Session Summary */}
        {!anyTaskSelected && (
          <div className="flex flex-col items-center justify-center rounded-[24px] border border-dashed border-gray-200 bg-white/40 px-6 py-10 text-center shadow-inner">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-blue-500">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h.01M7 20h.01M17 20h.01M12 16h.01M7 16h.01M17 16h.01M12 12h.01M7 12h.01M17 12h.01M12 8h.01M7 8h.01M17 8h.01M12 4h.01M7 4h.01M17 4h.01"/></svg>
            </div>
            <p className="m-0 text-sm font-medium text-gray-600">
              {anyTasksExist ? "Select a task to review details" : "Awaiting agent activity"}
            </p>
            <p className="m-0 mt-2 text-xs text-gray-400 leading-relaxed max-w-[200px]">
              {voiceConnected
                ? "Live tasks and grounded results will appear here as the conversation progresses."
                : "Once the live session starts, the agent's work and thought process will be visible here."}
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}
