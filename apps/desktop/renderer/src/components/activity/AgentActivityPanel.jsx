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
        pill: "bg-amber-50 text-amber-700 border border-amber-200/70",
        glow: "from-amber-300/30 via-amber-100/20 to-transparent",
        dot: "bg-amber-500",
        icon: "text-amber-500",
        ring: "ring-amber-200/80"
      };
    case "failed":
      return {
        pill: "bg-rose-50 text-rose-700 border border-rose-200/70",
        glow: "from-rose-300/30 via-rose-100/20 to-transparent",
        dot: "bg-rose-500",
        icon: "text-rose-500",
        ring: "ring-rose-200/80"
      };
    case "completed":
      return {
        pill: "bg-emerald-50 text-emerald-700 border border-emerald-200/70",
        glow: "from-emerald-300/30 via-emerald-100/20 to-transparent",
        dot: "bg-emerald-500",
        icon: "text-emerald-500",
        ring: "ring-emerald-200/80"
      };
    default:
      return {
        pill: "bg-blue-50 text-blue-700 border border-blue-200/70",
        glow: "from-blue-300/30 via-blue-100/20 to-transparent",
        dot: "bg-blue-500",
        icon: "text-blue-500",
        ring: "ring-blue-200/80"
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
          className={`w-full group relative overflow-hidden rounded-[24px] border px-4 py-4 text-left backdrop-blur-3xl transition-all duration-500 ${
            selected 
              ? "border-blue-300/60 bg-white/80 ring-4 ring-blue-500/10 shadow-[0_20px_40px_-10px_rgba(59,130,246,0.15)] scale-[1.02] z-10" 
              : "border-white/40 bg-white/40 hover:border-white/60 hover:bg-white/60 hover:shadow-[0_12px_32px_rgba(0,0,0,0.06)] hover:-translate-y-0.5"
          }`}
          aria-expanded={selected ? "true" : "false"}
          onClick={() => onSelect(selected ? null : runner.taskId)}
        >
          <span className="flex items-center gap-4">
            <span className={`relative flex h-[50px] w-[50px] shrink-0 items-center justify-center rounded-[18px] bg-gradient-to-br ${accent.glow} ring-1 ${accent.ring} shadow-[inset_0_2px_12px_rgba(255,255,255,0.8)] overflow-hidden transition-transform duration-500 ${selected ? "scale-105" : "group-hover:scale-105"}`} aria-hidden="true">
              {runner.status === 'running' && (
                <>
                  <span className="absolute inset-[-100%] bg-[conic-gradient(from_0deg,transparent_0_340deg,rgba(255,255,255,0.9)_360deg)] animate-[spin_2s_linear_infinite]" />
                  <span className="absolute inset-[2px] rounded-[16px] bg-white/80 backdrop-blur-xl" />
                </>
              )}
              {runner.status !== 'running' && (
                <span className="absolute inset-[2px] rounded-[16px] bg-white/80 backdrop-blur-xl transition-colors duration-300" />
              )}
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`relative z-10 ${accent.icon} drop-shadow-[0_2px_8px_rgba(0,0,0,0.1)] transition-transform duration-500 ${runner.status === 'running' ? 'animate-[pulse_2s_ease-in-out_infinite]' : ''}`}>
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
              </svg>
            </span>
            <span className="min-w-0 flex-1">
              <span className={`block text-[15px] font-bold leading-snug truncate transition-colors duration-300 ${selected ? "text-gray-900" : "text-gray-700 group-hover:text-gray-900"}`}>{runner.headline}</span>
              <span className="mt-1.5 flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide shadow-sm backdrop-blur-md border ${accent.pill}`}>
                  {runner.statusLabel ?? formatTaskRunnerStatus(runner.status)}
                </span>
                <span className="text-[11px] font-medium text-gray-400 truncate">{runner.latestHumanUpdate}</span>
              </span>
              {!selected && supportingParts.length > 0 ? (
                <span className="mt-2 block text-[11px] leading-relaxed text-gray-500/80 truncate tracking-wide font-medium">{supportingParts.join(" · ")}</span>
              ) : null}
            </span>
          </span>
        </button>
        {selected ? (
          <div className="animate-[fade-in_0.3s_ease-out]">
            <TaskRunnerDetail runner={runner} summary={summary} debugEvents={debugEvents} />
          </div>
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
    <aside className="relative z-10 flex h-full min-h-0 flex-col rounded-[40px] border border-white/60 bg-gradient-to-b from-white/60 to-white/40 p-6 shadow-[0_30px_120px_-50px_rgba(15,23,42,0.15)] backdrop-blur-3xl overflow-hidden">
      {/* Subtle animated background glow */}
      <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-blue-400/10 blur-[80px]" />
      <div className="pointer-events-none absolute -bottom-32 -left-20 h-80 w-80 rounded-full bg-indigo-400/10 blur-[100px]" />

      {/* ─── Header (fixed) ─── */}
      <div className="relative z-10 flex items-start justify-between gap-4 border-b border-white/40 pb-5 shrink-0">
        <div>
          <p className="m-0 text-[11px] font-bold uppercase tracking-[0.2em] text-gray-400/90">Agent Activity</p>
          <h2 className="m-0 mt-2 text-xl font-bold tracking-tight text-gray-800">Tasks &amp; Results</h2>
        </div>
        <span className="flex items-center gap-2 rounded-full border border-white/60 bg-white/50 px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-wider text-gray-500 shadow-sm backdrop-blur-md">
          <span className="relative flex h-2 w-2">
            {pendingBriefingCount > 0 && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75"></span>}
            <span className={`relative inline-flex h-2 w-2 rounded-full ${pendingBriefingCount > 0 ? "bg-blue-500" : "bg-gray-300"}`}></span>
          </span>
          pending {pendingBriefingCount}
        </span>
      </div>

      {/* ─── Single scrollable content area ─── */}
      <div className="relative z-10 mt-5 min-h-0 flex-1 space-y-6 overflow-y-auto pr-2 scrollbar-hide">
        {/* Running tasks */}
        <section>
          <p className="m-0 mb-3 text-[11px] font-bold uppercase tracking-[0.2em] text-gray-400/90 pl-1">
            {taskRunners.length > 0 ? `Running (${taskRunners.length})` : "Running Now"}
          </p>
          <div className="space-y-3">
            <TaskRunnerCards
              entries={taskRunners}
              emptyText=""
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
              <summary className="cursor-pointer list-none rounded-[16px] border border-white/40 bg-white/30 px-4 py-3 text-[11px] font-bold uppercase tracking-[0.18em] text-gray-500 hover:bg-white/50 hover:shadow-sm transition-all flex items-center justify-between backdrop-blur-md">
                <span>Completed ({archivedEntries.length})</span>
                <span className="text-[10px] text-gray-400 group-open:rotate-180 transition-transform duration-300">▼</span>
              </summary>
              <div className="mt-3 space-y-3">
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
        {(!anyTasksExist || (!anyTaskSelected && anyTasksExist)) && (
          <div className="flex h-full min-h-[300px] flex-col items-center justify-center text-center">
            <div className="relative mb-6 flex h-[88px] w-[88px] items-center justify-center">
              <div className="absolute inset-0 animate-[spin_4s_linear_infinite] rounded-full bg-gradient-to-tr from-blue-200/40 to-indigo-200/40 blur-xl" />
              <div className="relative flex h-16 w-16 items-center justify-center rounded-[20px] border border-white/60 bg-white/40 shadow-xl backdrop-blur-2xl">
                 <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="url(#gradient)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <defs>
                      <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="#818cf8" />
                        <stop offset="100%" stopColor="#3b82f6" />
                      </linearGradient>
                    </defs>
                    <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
                 </svg>
              </div>
            </div>
            <h3 className="m-0 text-[18px] font-bold tracking-tight text-gray-800">
              {anyTasksExist ? "Select a Task" : "Awaiting Activity"}
            </h3>
            <p className="m-0 mt-3 max-w-[240px] text-[13px] font-medium leading-relaxed text-gray-500 text-balance">
              {anyTasksExist
                ? "Click on any task above to view detailed execution traces and results."
                : voiceConnected
                  ? "Live tasks and grounded results will appear here organically as the conversation progresses."
                  : "Once the live session starts, the agent's work and thought process will be visible here."}
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}
