import { AnimatePresence, motion } from "motion/react";
import { buildConversationRoleLabel, formatTime } from "../../ui-utils.js";
import { useStickToBottom } from "../../hooks/useStickToBottom.js";
import { CrossIcon } from "../icons.jsx";

function getBubbleTone(item) {
  if (item.speaker === "user") {
    return {
      articleClassName: "flex justify-end",
      bubbleClassName:
        "rounded-[20px] rounded-br-md bg-blue-600 text-white shadow-[0_12px_28px_-16px_rgba(37,99,235,0.9)]",
      metaLabelClassName: "text-blue-100/90",
      badgeClassName: "bg-blue-500/40 text-blue-50",
      timestampClassName: "text-blue-100/80"
    };
  }

  if (item.kind === "task_event" || item.speaker === "system") {
    return {
      articleClassName: "flex justify-start",
      bubbleClassName:
        "rounded-[20px] rounded-bl-md border border-amber-200 bg-amber-50 text-amber-950 shadow-[0_12px_28px_-18px_rgba(217,119,6,0.35)]",
      metaLabelClassName: "text-amber-700/80",
      badgeClassName: "bg-amber-100 text-amber-700",
      timestampClassName: "text-amber-700/70"
    };
  }

  return {
    articleClassName: "flex justify-start",
    bubbleClassName:
      "rounded-[20px] rounded-bl-md border border-gray-200/70 bg-white/90 text-gray-800 shadow-[0_8px_20px_-10px_rgba(15,23,42,0.10)] backdrop-blur-sm ring-1 ring-inset ring-white/80",
    metaLabelClassName: "text-gray-400",
    badgeClassName: "bg-gray-100 text-gray-500",
    timestampClassName: "text-gray-400"
  };
}

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
          className="absolute top-3 bottom-3 right-3 w-[400px] max-w-[calc(100%-24px)] z-[30] flex flex-col rounded-[34px] border border-white/60 bg-white/85 backdrop-blur-2xl shadow-[0_30px_80px_-30px_rgba(15,23,42,0.2)] ring-1 ring-inset ring-white/70 overflow-hidden"
          initial={{ x: 120, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 120, opacity: 0 }}
          transition={{ duration: 0.22, ease: "easeOut" }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/50 shrink-0 bg-white/60 backdrop-blur-xl">
            <div>
              <p className="m-0 text-[10px] font-bold uppercase tracking-[0.18em] text-gray-400">Live Session</p>
              <h2 className="text-[15px] font-bold tracking-tight text-gray-800 m-0 mt-0.5">Transcript</h2>
            </div>
            <button
              type="button"
              className="w-9 h-9 flex items-center justify-center rounded-full border border-white/60 bg-white/60 text-gray-500 hover:text-gray-800 hover:bg-white/90 cursor-pointer transition-all duration-200 shadow-sm backdrop-blur-md"
              onClick={onClose}
              aria-label="Close chat"
            >
              <CrossIcon />
            </button>
          </div>

          {/* Message feed */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 scrollbar-hide" ref={feedRef}>
            {timeline.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full min-h-[200px] text-center">
                <div className="w-12 h-12 rounded-[16px] border border-white/60 bg-white/50 flex items-center justify-center mb-4 shadow-sm backdrop-blur-md">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400"><path d="m3 21 1.9-5.7a8.5 8.5 0 1 1 3.8 3.8z"/></svg>
                </div>
                <p className="text-sm text-gray-400 font-medium">No messages yet</p>
                <p className="text-[12px] text-gray-400/70 mt-1">The conversation will appear here as it unfolds.</p>
              </div>
            ) : (
              timeline.map((item) => {
                const turn = turnsById.get(item.turnId);
                const tone = getBubbleTone(item);

	                return (
	                  <article className={tone.articleClassName} key={item.id ?? `${item.turnId}-${item.createdAt}`}>
	                    <div className={`max-w-[85%] px-4 py-3 text-sm leading-relaxed ${
	                      tone.bubbleClassName
	                    } ${
	                      item.partial ? "opacity-60" : ""
	                    } ${item.interrupted ? "ring-1 ring-inset ring-amber-200/70" : ""}`}>
	                      <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
	                        <span className={`text-[10px] font-semibold uppercase tracking-wider ${tone.metaLabelClassName}`}>{buildConversationRoleLabel(item)}</span>
	                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${tone.badgeClassName}`}>{item.inputMode}</span>
	                        {turn?.stage ? <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${tone.badgeClassName}`}>{turn.stage}</span> : null}
	                        {item.interrupted ? (
	                          <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-amber-200 bg-amber-50 text-amber-700">
	                            Stopped early
	                          </span>
	                        ) : null}
	                        <span className={`text-[10px] ml-auto ${tone.timestampClassName}`}>{formatTime(item.updatedAt || item.createdAt)}</span>
	                      </div>
	                      <p className="m-0 whitespace-pre-wrap">{item.text}</p>
	                    </div>
                  </article>
                );
              })
            )}
          </div>

          {/* Input area */}
          <form
            className="flex items-end gap-2.5 px-4 py-4 border-t border-white/50 shrink-0 bg-white/50 backdrop-blur-xl"
            onSubmit={onSubmit}
          >
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
              className="flex-1 bg-white/80 border border-gray-200/80 rounded-2xl px-4 py-2.5 text-sm text-gray-800 placeholder:text-gray-400 outline-none resize-none font-[inherit] focus:border-gray-300/90 focus:bg-white focus:ring-2 focus:ring-blue-100/70 transition-all shadow-sm backdrop-blur-sm"
            />
            <button
              type="submit"
              className="w-10 h-10 flex items-center justify-center rounded-full bg-blue-600 text-white shrink-0 cursor-pointer hover:bg-blue-500 transition-all duration-200 shadow-sm hover:shadow-md"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 14-8-8 14V12H5z"/></svg>
            </button>
          </form>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
