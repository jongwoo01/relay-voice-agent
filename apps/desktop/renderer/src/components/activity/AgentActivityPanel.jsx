import { useMemo, useState } from "react";
import {
  buildTaskRunnerPresentation,
  buildAdvancedTraceEntries,
  buildTaskRunnerDisplayTimeline,
  formatTaskRunnerStatus,
  formatTime,
  formatVerificationStatus,
  getTaskRunnerAccent,
  pickDefaultTaskSelection
} from "../../ui-utils.js";
import { useStickToBottom } from "../../hooks/useStickToBottom.js";

function accentTheme(status) {
  switch (getTaskRunnerAccent(status)) {
    case "waiting":
      return {
        pill: "bg-amber-50 text-amber-700 border border-amber-200/70",
        surface: "from-amber-50/90 via-white/88 to-amber-100/75",
        glow: "from-amber-300/30 via-amber-100/20 to-transparent",
        dot: "bg-amber-500",
        icon: "text-amber-500",
        ring: "ring-amber-200/80",
        liveLine: "from-amber-400 via-amber-300 to-orange-300"
      };
    case "failed":
      return {
        pill: "bg-rose-50 text-rose-700 border border-rose-200/70",
        surface: "from-rose-50/90 via-white/88 to-rose-100/75",
        glow: "from-rose-300/30 via-rose-100/20 to-transparent",
        dot: "bg-rose-500",
        icon: "text-rose-500",
        ring: "ring-rose-200/80",
        liveLine: "from-rose-400 via-rose-300 to-orange-300"
      };
    case "completed":
      return {
        pill: "bg-emerald-50 text-emerald-700 border border-emerald-200/70",
        surface: "from-emerald-50/90 via-white/90 to-emerald-100/70",
        glow: "from-emerald-300/30 via-emerald-100/20 to-transparent",
        dot: "bg-emerald-500",
        icon: "text-emerald-500",
        ring: "ring-emerald-200/80",
        liveLine: "from-emerald-400 via-emerald-300 to-teal-300"
      };
    default:
      return {
        pill: "bg-blue-50 text-blue-700 border border-blue-200/70",
        surface: "from-sky-50/95 via-white/92 to-cyan-100/80",
        glow: "from-blue-300/30 via-blue-100/20 to-transparent",
        dot: "bg-blue-500",
        icon: "text-blue-500",
        ring: "ring-blue-200/80",
        liveLine: "from-cyan-400 via-sky-400 to-blue-400"
      };
  }
}

function isAttentionStatus(status) {
  return (
    status === "waiting_input" ||
    status === "approval_required" ||
    status === "failed"
  );
}

function isCancellableStatus(status) {
  return (
    status === "created" ||
    status === "queued" ||
    status === "running" ||
    status === "waiting_input" ||
    status === "approval_required"
  );
}

function runnerMentionsTrustIssue(runner, timelineEntries) {
  const combined = [
    runner.needsUserAction,
    runner.heroSummary,
    runner.latestHumanUpdate,
    ...timelineEntries.map((entry) => entry.body)
  ]
    .filter((value) => typeof value === "string" && value.trim().length > 0)
    .join("\n")
    .toLowerCase();

  return (
    combined.includes("trusted folders") ||
    combined.includes("trust this workspace") ||
    combined.includes("safe mode") ||
    combined.includes("workspace is not trusted") ||
    combined.includes("untrusted workspace")
  );
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

function TaskRunnerDetail({
  runner,
  summary,
  debugEvents,
  onCancelTask,
  setupStatus,
  onDisableGeminiFolderTrust,
  onTrustGeminiWorkspace,
  onOpenSupportTarget
}) {
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
  const canCancel = isCancellableStatus(runner.status);
  const trustActionVisible =
    globalThis.window?.desktopSystem?.platform === "win32" &&
    runnerMentionsTrustIssue(runner, timelineEntries);
  const cancelFeedbackCopy =
    runner.cancelUiPhase === "cancelling"
      ? {
          tone: "border-sky-200/80 bg-sky-50/80 text-sky-900",
          label: "Cancelling",
          body: "Stopping the local runner and waiting for cancellation confirmation."
        }
      : runner.cancelUiPhase === "cancelled_confirmed"
        ? {
            tone: "border-emerald-200/80 bg-emerald-50/80 text-emerald-900",
            label: "Cancelled",
            body: "The task was cancelled and will move to Completed in a moment."
          }
        : runner.cancelUiPhase === "cancel_failed"
          ? {
              tone: "border-rose-200/80 bg-rose-50/80 text-rose-900",
              label: "Cancel failed",
              body: "Couldn't stop the task. Try again."
            }
          : null;

  return (
    <div className="flex min-h-0 flex-col gap-4">
      {cancelFeedbackCopy ? (
        <section className={`rounded-[24px] border px-4 py-4 ${cancelFeedbackCopy.tone}`}>
          <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.16em]">
            {cancelFeedbackCopy.label}
          </p>
          <p className="m-0 mt-2 text-sm leading-relaxed">{cancelFeedbackCopy.body}</p>
        </section>
      ) : null}

      {runner.needsUserAction ? (
        <div className="rounded-[24px] border border-amber-200 bg-amber-50/80 px-4 py-4">
          <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-700">Needs Attention</p>
          <p className="m-0 mt-2 text-sm leading-relaxed text-amber-900">{runner.needsUserAction}</p>
        </div>
      ) : null}

      {trustActionVisible ? (
        <section className="rounded-[24px] border border-sky-200/80 bg-sky-50/80 px-4 py-4 text-sky-950">
          <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.16em] text-sky-700">Workspace Trust Fix</p>
          <p className="m-0 mt-2 text-sm leading-relaxed">
            This Windows task looks blocked by Gemini workspace trust or approval. Repair it here, then retry the task.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void onDisableGeminiFolderTrust?.()}
              disabled={setupStatus?.geminiWorkspaceTrust?.folderTrustEnabled !== true}
              className="rounded-full border border-sky-200/90 bg-white/90 px-3 py-1.5 text-[11px] font-semibold text-sky-700 transition-colors hover:border-sky-300 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Disable Trusted Folders
            </button>
            <button
              type="button"
              onClick={() => void onTrustGeminiWorkspace?.()}
              disabled={
                setupStatus?.geminiWorkspaceTrust?.folderTrustEnabled !== true ||
                setupStatus?.geminiWorkspaceTrust?.trusted === true
              }
              className="rounded-full border border-sky-200/90 bg-white/90 px-3 py-1.5 text-[11px] font-semibold text-sky-700 transition-colors hover:border-sky-300 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Trust this workspace
            </button>
            <button
              type="button"
              onClick={() => void onOpenSupportTarget?.("gemini_trusted_folders")}
              className="rounded-full border border-sky-200/90 bg-white/90 px-3 py-1.5 text-[11px] font-semibold text-sky-700 transition-colors hover:border-sky-300 hover:bg-sky-100"
            >
              Open trustedFolders.json
            </button>
            <button
              type="button"
              onClick={() => void onOpenSupportTarget?.("gemini_trusted_docs")}
              className="rounded-full border border-sky-200/90 bg-white/90 px-3 py-1.5 text-[11px] font-semibold text-sky-700 transition-colors hover:border-sky-300 hover:bg-sky-100"
            >
              Open Gemini trust docs
            </button>
          </div>
        </section>
      ) : null}

      <section className="rounded-[28px] border border-white/70 bg-white/80 px-4 py-4 shadow-[0_18px_45px_-30px_rgba(15,23,42,0.28)] backdrop-blur-xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">
              {runner.status === "completed" ? "Completed Task" : "Live Task"}
            </p>
            <p className="m-0 mt-1 text-sm text-gray-500">
              {updatedAtText ||
                (runner.status === "completed"
                  ? "Completion details remain available here."
                  : "Live progress updates appear here.")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {canCancel &&
            runner.cancelUiPhase !== "cancelling" &&
            runner.cancelUiPhase !== "cancelled_confirmed" ? (
              <button
                type="button"
                onClick={() => void onCancelTask?.(runner.taskId)}
                className="rounded-full border border-gray-200/90 bg-white/85 px-3 py-1.5 text-[11px] font-semibold text-gray-500 transition-colors hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700"
              >
                Stop task
              </button>
            ) : null}
            <div className={`flex h-11 w-11 items-center justify-center rounded-2xl bg-white/80 shadow-inner ring-1 ${accent.ring}`}>
              <span className={`h-2.5 w-2.5 rounded-full ${accent.dot}`} />
            </div>
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

      {runner.status !== "cancelled" &&
      (Boolean(runner.resultSummary) || Boolean(runner.verification) || (runner.changes?.length ?? 0) > 0) ? (
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

function TaskRunnerCards({
  entries,
  emptyText,
  selectedTaskId,
  onSelect,
  summary,
  debugEvents,
  onCancelTask,
  setupStatus,
  onDisableGeminiFolderTrust,
  onTrustGeminiWorkspace,
  onOpenSupportTarget
}) {
  if (!entries.length) {
    return <p className="rounded-[24px] border border-dashed border-gray-200 px-4 py-8 text-center text-sm text-gray-400">{emptyText}</p>;
  }

  return entries.map((runner) => {
    const selected = runner.taskId === selectedTaskId;
    const accent = accentTheme(runner.status);
    const isRunning = runner.status === "running";
    const isCompleted = runner.status === "completed";
    const needsAttention =
      isAttentionStatus(runner.status) || runner.cancelUiPhase === "cancel_failed";
    const heroUpdate =
      runner.cancelUiPhase === "cancelling"
        ? "Stopping the local runner and waiting for cancellation confirmation."
        : runner.cancelUiPhase === "cancel_failed"
          ? "Couldn't stop the task. Try again."
          : runner.cancelUiPhase === "cancelled_confirmed"
            ? "The task was cancelled and will move to Completed in a moment."
            : runner.latestHumanUpdate ?? runner.heroSummary;
    const statusLabel =
      runner.cancelUiPhase === "cancelling"
        ? "Cancelling…"
        : runner.statusLabel ?? formatTaskRunnerStatus(runner.status);
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
        <div
          role="button"
          tabIndex={0}
          className={`w-full group relative overflow-hidden rounded-[24px] border px-4 py-4 text-left backdrop-blur-3xl transition-all duration-400 cursor-pointer ${
            selected
              ? "border-blue-300/60 bg-white/95 ring-4 ring-blue-500/15 shadow-[0_22px_45px_-12px_rgba(59,130,246,0.25)] scale-[1.01] z-10"
              : isRunning
                ? "border-sky-200/80 bg-white/85 shadow-[0_18px_36px_-16px_rgba(14,165,233,0.2)] hover:-translate-y-0.5 hover:border-sky-300/90 hover:bg-white/95"
                : needsAttention
                  ? "border-amber-200/80 bg-white/80 shadow-[0_18px_36px_-18px_rgba(245,158,11,0.18)] hover:-translate-y-0.5 hover:bg-white/95"
                  : isCompleted
                    ? "border-white/40 bg-white/50 hover:border-emerald-200/80 hover:bg-white/70 hover:shadow-[0_12px_32px_rgba(16,185,129,0.08)]"
                    : "border-white/50 bg-white/50 hover:border-white/80 hover:bg-white/70 hover:shadow-[0_12px_32px_rgba(0,0,0,0.06)] hover:-translate-y-0.5"
          }`}
          aria-expanded={selected ? "true" : "false"}
          onClick={() => onSelect(runner.taskId)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSelect(runner.taskId);
            }
          }}
        >
          <div className="flex items-center gap-4">
            <div
              className={`relative flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-[18px] bg-gradient-to-br ${accent.glow} ring-1 ${accent.ring} shadow-[inset_0_2px_12px_rgba(255,255,255,0.8)] overflow-hidden transition-transform duration-500 ${
                selected ? "scale-105" : "group-hover:scale-105"
              }`}
              aria-hidden="true"
            >
              {isRunning && (
                <>
                  <span className="absolute inset-[-100%] bg-[conic-gradient(from_0deg,transparent_0_300deg,rgba(56,189,248,0.95)_330deg,rgba(255,255,255,0.96)_360deg)] animate-[spin_1.5s_linear_infinite]" />
                  <span className="absolute inset-[5px] rounded-full border border-sky-300/60 animate-ping opacity-70" />
                  <span className="absolute inset-[2px] rounded-[16px] bg-white/80 backdrop-blur-xl" />
                  <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-sky-400 shadow-[0_0_0_4px_rgba(125,211,252,0.28)]" />
                </>
              )}
              {!isRunning && (
                <span className="absolute inset-[2px] rounded-[16px] bg-white/80 backdrop-blur-xl transition-colors duration-300" />
              )}
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`relative z-10 ${accent.icon} drop-shadow-[0_2px_8px_rgba(0,0,0,0.1)] transition-transform duration-500 ${
                  isRunning ? "animate-[pulse_1.4s_ease-in-out_infinite]" : ""
                }`}
              >
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                {isRunning ? (
                  <span className="rounded-full border border-sky-200/80 bg-sky-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-sky-700">
                    Live Runner
                  </span>
                ) : null}
                {needsAttention ? (
                  <span className="rounded-full border border-amber-200/80 bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-amber-700">
                    Needs Review
                  </span>
                ) : null}
              </div>
              <div className={`mt-1.5 block text-[15px] font-bold leading-snug transition-colors duration-300 ${selected ? "text-gray-900" : "text-gray-700 group-hover:text-gray-900"}`}>{runner.headline}</div>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide shadow-sm backdrop-blur-md border shrink-0 ${accent.pill}`}>
                  {statusLabel}
                </span>
                {runner.lastUpdatedAt ? (
                  <span className="text-[11px] font-medium text-gray-400">
                    Updated {formatTime(runner.lastUpdatedAt)}
                  </span>
                ) : null}
              </div>
              <div
                className={`mt-2 block rounded-[18px] bg-gradient-to-r px-3 py-2 text-[12px] leading-relaxed ${
                  isRunning
                    ? "from-sky-50 to-cyan-50 text-sky-800 ring-1 ring-inset ring-sky-100"
                    : needsAttention
                      ? "from-amber-50 to-orange-50 text-amber-900 ring-1 ring-inset ring-amber-100"
                      : isCompleted
                        ? "from-emerald-50/85 to-white text-emerald-900 ring-1 ring-inset ring-emerald-100/80"
                        : "from-gray-50 to-white text-gray-700 ring-1 ring-inset ring-gray-100"
                }`}
              >
                {heroUpdate}
              </div>
              {!selected && supportingParts.length > 0 ? (
                <div className="mt-2 block text-[11px] leading-relaxed text-gray-500/80 tracking-wide font-medium break-words">{supportingParts.join(" · ")}</div>
              ) : null}
            </div>
          </div>
        </div>
        {selected ? (
          <div className="animate-[fade-in_0.3s_ease-out]">
            <TaskRunnerDetail
              runner={runner}
              summary={summary}
              debugEvents={debugEvents}
              onCancelTask={onCancelTask}
              setupStatus={setupStatus}
              onDisableGeminiFolderTrust={onDisableGeminiFolderTrust}
              onTrustGeminiWorkspace={onTrustGeminiWorkspace}
              onOpenSupportTarget={onOpenSupportTarget}
            />
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
  selectionDismissed = false,
  onSelectTask,
  onCancelTask,
  setupStatus,
  onDisableGeminiFolderTrust,
  onTrustGeminiWorkspace,
  onOpenSupportTarget,
  taskCancelUiState = {},
  summary,
  debugEvents,
  voiceConnected,
  pendingBriefingCount
}) {
  const [completedOpen, setCompletedOpen] = useState(false);
  const { activeEntries, archivedEntries: visibleArchivedEntries } = useMemo(
    () =>
      buildTaskRunnerPresentation({
        taskRunners,
        archivedEntries,
        taskCancelUiState
      }),
    [archivedEntries, taskCancelUiState, taskRunners]
  );
  const effectiveSelectedTaskId =
    selectionDismissed
      ? null
      : selectedTaskId ?? pickDefaultTaskSelection(activeEntries, visibleArchivedEntries);
  const anyTasksExist = activeEntries.length > 0 || visibleArchivedEntries.length > 0;
  const showRunningSection = activeEntries.length > 0;
  const completedIsPrimary = activeEntries.length === 0 && visibleArchivedEntries.length > 0;

  return (
    <aside className="relative z-10 flex h-full min-h-0 flex-col rounded-[40px] border border-white/60 bg-gradient-to-b from-white/60 to-white/40 p-6 shadow-[0_30px_120px_-50px_rgba(15,23,42,0.15)] backdrop-blur-3xl overflow-hidden">
      {/* Subtle animated background glow */}
      <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-blue-400/10 blur-[80px]" />
      <div className="pointer-events-none absolute -bottom-32 -left-20 h-80 w-80 rounded-full bg-indigo-400/10 blur-[100px]" />

      {/* ─── Header (fixed) ─── */}
      <div className="relative z-10 flex items-center justify-between gap-4 border-b border-white/40 pb-5 shrink-0">
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
      <div className="relative z-10 min-h-0 flex-1 space-y-6 overflow-y-auto -mx-4 px-4 pt-5 pb-6 scrollbar-hide">
        {showRunningSection ? (
          <section className="space-y-3">
            <div className="flex items-end justify-between gap-3 px-1">
              <div>
                <p className="m-0 text-[11px] font-bold uppercase tracking-[0.2em] text-gray-400/90">
                  Running ({activeEntries.length})
                </p>
                <p className="m-0 mt-1 text-sm text-gray-500">
                  Active runners stay pinned here while their progress keeps updating.
                </p>
              </div>
              <div className="rounded-full border border-sky-200/70 bg-sky-50/80 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-sky-700 shadow-sm">
                Live now
              </div>
            </div>
            <div className="space-y-3">
              <TaskRunnerCards
                entries={activeEntries}
                emptyText=""
                selectedTaskId={effectiveSelectedTaskId}
                onSelect={(taskId) =>
                  onSelectTask(taskId === effectiveSelectedTaskId ? null : taskId)
                }
                summary={summary}
                debugEvents={debugEvents}
                onCancelTask={onCancelTask}
                setupStatus={setupStatus}
                onDisableGeminiFolderTrust={onDisableGeminiFolderTrust}
                onTrustGeminiWorkspace={onTrustGeminiWorkspace}
                onOpenSupportTarget={onOpenSupportTarget}
              />
            </div>
          </section>
        ) : null}

        {visibleArchivedEntries.length > 0 && (
          <section className="space-y-3">
            {completedIsPrimary ? (
              <div className="px-1">
                <p className="m-0 text-[11px] font-bold uppercase tracking-[0.2em] text-gray-400/90">
                  Completed ({visibleArchivedEntries.length})
                </p>
                <p className="m-0 mt-1 text-sm text-gray-500">
                  Finished tasks stay openable here with their full result and execution history.
                </p>
              </div>
            ) : null}
            <details
              open={completedOpen}
              onToggle={(e) => setCompletedOpen(e.currentTarget.open)}
              className="group"
            >
              <summary className={`cursor-pointer list-none rounded-[16px] border px-4 py-3 text-[11px] font-bold uppercase tracking-[0.18em] text-gray-500 transition-all flex items-center justify-between backdrop-blur-md ${
                completedIsPrimary
                  ? "border-emerald-200/60 bg-white/62 shadow-[0_14px_35px_-24px_rgba(16,185,129,0.28)]"
                  : "border-white/40 bg-white/30 hover:bg-white/50 hover:shadow-sm"
              }`}>
                <span>Completed ({visibleArchivedEntries.length})</span>
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400 group-open:rotate-180 transition-transform duration-300"><polyline points="6 9 12 15 18 9"/></svg>
              </summary>
              <div className="mt-3 space-y-3">
                <TaskRunnerCards
                  entries={visibleArchivedEntries}
                  emptyText="Completed work will be archived here."
                  selectedTaskId={effectiveSelectedTaskId}
                  onSelect={(taskId) =>
                    onSelectTask(taskId === effectiveSelectedTaskId ? null : taskId)
                  }
                  summary={summary}
                  debugEvents={debugEvents}
                  onCancelTask={onCancelTask}
                  setupStatus={setupStatus}
                  onDisableGeminiFolderTrust={onDisableGeminiFolderTrust}
                  onTrustGeminiWorkspace={onTrustGeminiWorkspace}
                  onOpenSupportTarget={onOpenSupportTarget}
                />
              </div>
            </details>
          </section>
        )}

        {!anyTasksExist ? (
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
            <h3 className="m-0 text-[18px] font-bold tracking-tight text-gray-800">Awaiting Activity</h3>
            <p className="m-0 mt-3 max-w-[240px] text-[13px] font-medium leading-relaxed text-gray-500 text-balance">
              {voiceConnected
                ? "Live tasks and grounded results will appear here organically as the conversation progresses."
                : "Once the live session starts, the agent's work and thought process will be visible here."}
            </p>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
