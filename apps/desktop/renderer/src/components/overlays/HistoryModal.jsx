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
            className="w-full max-w-[880px] max-h-[760px] flex flex-col overflow-hidden rounded-[34px] border border-white/60 bg-[#f8f9fb]/95 backdrop-blur-xl shadow-[0_40px_120px_-30px_rgba(15,23,42,0.2)] ring-1 ring-inset ring-white/70"
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-4 px-7 pt-6 pb-5 border-b border-gray-200/60 shrink-0">
              <div>
                <p className="m-0 text-[10px] font-bold uppercase tracking-[0.2em] text-gray-400">History</p>
                <h2 className="text-xl font-bold tracking-tight text-gray-800 m-0 mt-0.5">Recent Sessions</h2>
                <p className="mt-1 text-xs text-gray-500 m-0">
                  {error ? `History error · ${error}` : loading ? "Refreshing saved sessions…" : "Saved sessions for the current judge user."}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  className="px-4 py-2 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-full hover:bg-gray-50 transition-colors disabled:opacity-40 shadow-sm"
                  onClick={onRefresh} type="button" disabled={loading}
                >
                  {loading ? "Refreshing…" : "Refresh"}
                </button>
                <button
                  className="w-9 h-9 flex items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 hover:text-gray-800 hover:bg-gray-50 cursor-pointer transition-colors shadow-sm"
                  onClick={onClose} type="button" aria-label="Close history"
                >
                  <CrossIcon />
                </button>
              </div>
            </div>

            {/* Session list */}
            <div className="grid gap-3 px-7 py-5 overflow-y-auto scrollbar-hide">
              {entries.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="w-14 h-14 rounded-[18px] border border-gray-200/80 bg-white flex items-center justify-center mb-4 shadow-sm">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400">
                      <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                    </svg>
                  </div>
                  <p className="text-sm font-medium text-gray-500">No saved sessions</p>
                  <p className="text-xs text-gray-400 mt-1">Sessions will appear here once you have connected.</p>
                </div>
              ) : (
                entries.map((entry) => (
                  <article
                    className="group p-5 rounded-[24px] bg-white border border-gray-200/80 shadow-[0_14px_34px_-24px_rgba(15,23,42,0.18)] hover:shadow-[0_18px_40px_-24px_rgba(15,23,42,0.22)] hover:border-gray-300/80 transition-all duration-200"
                    key={entry.id}
                  >
                    <div className="flex items-start gap-4">
                      <div className="w-10 h-10 rounded-[14px] border border-gray-100 bg-gray-50 flex items-center justify-center shrink-0 shadow-inner">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400">
                          <path d="m3 21 1.9-5.7a8.5 8.5 0 1 1 3.8 3.8z"/>
                        </svg>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-gray-800 m-0 leading-snug">{entry.title}</p>
                        {entry.subtitle ? <p className="text-xs text-gray-600 mt-1 m-0 leading-relaxed">{entry.subtitle}</p> : null}
                        {entry.text ? <p className="text-xs text-gray-500 mt-1 m-0 leading-relaxed">{entry.text}</p> : null}
                        {entry.meta ? (
                          <p className="text-[10px] font-medium text-gray-400 mt-2 m-0 uppercase tracking-wide">{entry.meta}</p>
                        ) : null}
                      </div>
                    </div>
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
