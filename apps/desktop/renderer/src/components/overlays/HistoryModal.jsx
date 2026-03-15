import { AnimatePresence, motion } from "motion/react";
import { CrossIcon } from "../icons.jsx";

export function HistoryModal({ open, entries, loading, error, onClose, onRefresh }) {
  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-40 flex items-center justify-center p-8 bg-black/30 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.section
            className="w-full max-w-[880px] max-h-[760px] flex flex-col overflow-hidden rounded-3xl border border-gray-200 bg-white/95 backdrop-blur-xl shadow-2xl"
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 px-7 pt-6 pb-5 border-b border-gray-100">
              <div>
                <h2 className="text-xl font-semibold text-gray-800 m-0">Recent Sessions</h2>
                <p className="mt-1.5 text-xs text-gray-500 m-0">
                  {error ? `History error · ${error}` : loading ? "Refreshing saved sessions…" : "Saved sessions for the current judge user."}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="px-4 py-2 text-xs font-medium text-gray-600 bg-gray-50 border border-gray-200 rounded-full hover:bg-gray-100 transition-colors disabled:opacity-40"
                  onClick={onRefresh} type="button" disabled={loading}
                >
                  {loading ? "Refreshing…" : "Refresh"}
                </button>
                <button
                  className="w-9 h-9 flex items-center justify-center rounded-full bg-gray-50 border border-gray-200 text-gray-500 hover:text-gray-800 hover:bg-gray-100 cursor-pointer transition-colors"
                  onClick={onClose} type="button" aria-label="Close history"
                >
                  <CrossIcon />
                </button>
              </div>
            </div>
            <div className="grid gap-3 px-7 py-5 overflow-y-auto">
              {entries.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8">No saved sessions.</p>
              ) : (
                entries.map((entry) => (
                  <article className="p-4 rounded-2xl bg-gray-50 border border-gray-100" key={entry.id}>
                    <p className="text-sm font-medium text-gray-800 m-0">{entry.title}</p>
                    <p className="text-xs text-gray-600 mt-1 m-0">{entry.subtitle}</p>
                    <p className="text-xs text-gray-500 mt-1 m-0">{entry.text}</p>
                    <p className="text-[10px] text-gray-400 mt-2 m-0">{entry.meta}</p>
                  </article>
                ))
              )}
            </div>
          </motion.section>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
