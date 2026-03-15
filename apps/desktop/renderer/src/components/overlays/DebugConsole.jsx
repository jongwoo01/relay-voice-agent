import { AnimatePresence, motion } from "motion/react";
import { formatTime } from "../../ui-utils.js";

const DEBUG_FILTER_DEFAULTS = {
  transport: true,
  live: true,
  bridge: true,
  runtime: true,
  executor: true
};

export function DebugConsole({
  open,
  filters,
  onToggleFilter,
  turnFilter,
  onTurnFilterChange,
  taskFilter,
  onTaskFilterChange,
  events
}) {
  return (
    <AnimatePresence>
      {open ? (
        <motion.section
          className="fixed inset-x-6 bottom-6 z-50 flex max-h-[46vh] flex-col overflow-hidden rounded-[28px] border border-slate-700/80 bg-slate-950/92 shadow-2xl backdrop-blur-2xl"
          initial={{ y: 24, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 24, opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          <div className="flex items-start justify-between gap-4 border-b border-slate-800 px-6 py-4">
            <div>
              <h3 className="m-0 text-sm font-semibold tracking-wide text-slate-100">Developer Console</h3>
              <p className="m-0 mt-1 text-xs text-slate-400">Advanced event stream</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 px-6 py-3">
            {Object.keys(DEBUG_FILTER_DEFAULTS).map((source) => (
              <label
                className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900/80 px-3 py-1.5 text-[11px] font-medium text-slate-300"
                key={source}
              >
                <input
                  type="checkbox"
                  checked={filters[source]}
                  onChange={() => onToggleFilter(source)}
                />
                {source}
              </label>
            ))}
            <div className="min-w-[160px]">
              <input
                value={turnFilter}
                onChange={(event) => onTurnFilterChange(event.target.value)}
                type="text"
                autoComplete="off"
                placeholder="turnId filter…"
                className="w-full rounded-full border border-slate-700 bg-slate-900/80 px-3 py-2 text-xs text-slate-200 outline-none placeholder:text-slate-500"
              />
            </div>
            <div className="min-w-[160px]">
              <input
                value={taskFilter}
                onChange={(event) => onTaskFilterChange(event.target.value)}
                type="text"
                autoComplete="off"
                placeholder="taskId filter…"
                className="w-full rounded-full border border-slate-700 bg-slate-900/80 px-3 py-2 text-xs text-slate-200 outline-none placeholder:text-slate-500"
              />
            </div>
          </div>
          <div className="grid gap-3 overflow-y-auto px-6 py-4">
            {events.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-slate-700 px-4 py-6 text-center text-sm text-slate-500">
                No debug events match the current filters.
              </p>
            ) : (
              events.map((event) => (
                <article className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3" key={event.id}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-300">
                      {event.source}
                    </span>
                    <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-400">
                      {event.kind}
                    </span>
                    <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-400">
                      {formatTime(event.createdAt)}
                    </span>
                  </div>
                  <p className="m-0 mt-2 text-sm text-slate-100">{event.summary}</p>
                  <p className="m-0 mt-1 whitespace-pre-wrap text-xs text-slate-400">
                    {[event.turnId ? `turn=${event.turnId}` : null, event.taskId ? `task=${event.taskId}` : null, event.detail ?? null]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </article>
              ))
            )}
          </div>
        </motion.section>
      ) : null}
    </AnimatePresence>
  );
}
