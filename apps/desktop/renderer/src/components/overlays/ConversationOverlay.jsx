import { AnimatePresence, motion } from "motion/react";
import { buildConversationRoleLabel, formatTime } from "../../ui-utils.js";
import { useStickToBottom } from "../../hooks/useStickToBottom.js";
import { CrossIcon } from "../icons.jsx";

export function ConversationOverlay({
  open,
  onClose,
  timeline,
  turnsById,
  prompt,
  onPromptChange,
  onSubmit,
  onCompositionStart,
  onCompositionEnd,
  onPromptKeyDown
}) {
  const feedRef = useStickToBottom([timeline.length, timeline.at(-1)?.text, timeline.at(-1)?.updatedAt]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="absolute top-4 bottom-4 right-4 w-[400px] max-w-[calc(100%-32px)] z-20 flex flex-col rounded-2xl border border-gray-200 bg-white/90 backdrop-blur-2xl shadow-2xl"
          initial={{ x: 120, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 120, opacity: 0 }}
          transition={{ duration: 0.22, ease: "easeOut" }}
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
            <h2 className="text-base font-semibold text-gray-800 m-0">Live Transcript</h2>
            <button
              type="button"
              className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-gray-500 hover:text-gray-800 hover:bg-gray-200 cursor-pointer transition-colors"
              onClick={onClose}
              aria-label="Close chat"
            >
              <CrossIcon />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3" ref={feedRef}>
            {timeline.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">
                No assistant replies yet.
              </p>
            ) : (
              timeline.map((item) => {
                const turn = turnsById.get(item.turnId);

                return (
                  <article className="flex justify-start" key={item.id ?? `${item.turnId}-${item.createdAt}`}>
                    <div className={`max-w-[85%] rounded-2xl rounded-bl-md bg-gray-50 px-4 py-3 text-sm leading-relaxed text-gray-800 ${
                      item.partial ? "opacity-60" : ""
                    } ${item.interrupted ? "opacity-40 line-through" : ""}`}>
                      <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{buildConversationRoleLabel(item)}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">{item.inputMode}</span>
                        {turn?.stage ? <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">{turn.stage}</span> : null}
                        <span className="text-[10px] text-gray-400 ml-auto">{formatTime(item.updatedAt || item.createdAt)}</span>
                      </div>
                      <p className="m-0 whitespace-pre-wrap">{item.text}</p>
                    </div>
                  </article>
                );
              })
            )}
          </div>

          <form className="flex items-end gap-2 px-4 py-3 border-t border-gray-100 shrink-0" onSubmit={onSubmit}>
            <textarea
              name="prompt"
              rows="1"
              autoComplete="off"
              placeholder="Type a message…"
              value={prompt}
              onChange={(e) => onPromptChange(e.target.value)}
              onCompositionStart={onCompositionStart}
              onCompositionEnd={onCompositionEnd}
              onKeyDown={onPromptKeyDown}
              className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-800 placeholder:text-gray-400 outline-none resize-none font-[inherit] focus:border-gray-300 transition-colors"
            />
            <button
              type="submit"
              className="w-9 h-9 flex items-center justify-center rounded-full bg-blue-600 text-white shrink-0 cursor-pointer hover:bg-blue-500 transition-colors text-sm font-bold"
            >
              ↑
            </button>
          </form>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
