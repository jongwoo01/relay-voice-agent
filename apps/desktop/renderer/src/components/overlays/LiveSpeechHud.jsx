import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

export function buildHudBubbles({
  sessionActive,
  voiceState,
  routing,
  inputPartial,
  outputTranscript
}) {
  if (!sessionActive) {
    return [];
  }

  const bubbles = [];
  const assistantText = String(outputTranscript ?? "").trim();
  const hudState =
    voiceState.status === "finishing"
      ? "Finishing"
      : voiceState.status === "responding"
        ? "Responding"
        : voiceState.status === "thinking"
          ? "Thinking"
          : voiceState.status === "connecting"
            ? "Connecting"
            : routing?.mode === "waiting_user"
              ? "Waiting"
              : voiceState.activity?.assistantSpeaking || voiceState.status === "speaking"
                ? "Speaking"
                : null;
  if (assistantText) {
    bubbles.push({
      id: "assistant-live",
      speaker: "Relay",
      tone: "assistant",
      state: hudState ?? "Responding",
      text: assistantText
    });
  }

  return bubbles.slice(-1);
}

export function LiveSpeechHud({
  sessionActive,
  voiceState,
  routing,
  inputPartial,
  outputTranscript
}) {
  const [visibleTranscript, setVisibleTranscript] = useState("");
  const clearTranscriptTimerRef = useRef(null);
  const assistantPlaybackActive =
    voiceState.activity?.assistantSpeaking === true ||
    voiceState.status === "speaking" ||
    voiceState.status === "finishing";

  useEffect(() => {
    clearTimeout(clearTranscriptTimerRef.current);

    if (!sessionActive) {
      setVisibleTranscript("");
      return undefined;
    }

    const nextTranscript = String(outputTranscript ?? "").trim();
    if (nextTranscript) {
      setVisibleTranscript(nextTranscript);
      return undefined;
    }

    if (assistantPlaybackActive || voiceState.status === "responding") {
      return undefined;
    }

    clearTranscriptTimerRef.current = setTimeout(() => {
      setVisibleTranscript("");
    }, 220);

    return () => {
      clearTimeout(clearTranscriptTimerRef.current);
    };
  }, [
    assistantPlaybackActive,
    outputTranscript,
    sessionActive,
    voiceState.status
  ]);

  const bubbles = buildHudBubbles({
    sessionActive,
    voiceState,
    routing,
    inputPartial,
    outputTranscript: visibleTranscript
  });

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-10 z-[25] flex justify-center px-6">
      <div className="flex max-h-[28vh] w-full max-w-[680px] flex-col-reverse items-stretch gap-3 overflow-y-auto scrollbar-hide [mask-image:linear-gradient(to_bottom,transparent,black_4%,black_100%)]">
        <AnimatePresence initial={false}>
          {bubbles.map((bubble) => {
            const isThinking = bubble.state === "Thinking";
            const isSpeaking = bubble.state === "Speaking";

            return (
              <motion.div
                key={bubble.id}
                initial={{ opacity: 0, y: 16, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.97 }}
                transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
                className="mx-auto w-fit max-w-[min(92vw,620px)] shrink-0"
              >
                {/* Outer glass container */}
                <div className="relative rounded-[28px] border border-white/70 bg-white/60 px-6 py-4 shadow-[0_16px_48px_-16px_rgba(79,70,229,0.18),0_4px_16px_-4px_rgba(0,0,0,0.06)] ring-1 ring-inset ring-white/80 backdrop-blur-3xl">
                  {/* Subtle top gradient highlight */}
                  <div className="pointer-events-none absolute inset-x-0 top-0 h-px rounded-t-[28px] bg-gradient-to-r from-transparent via-white/90 to-transparent" />

                  {/* Header row */}
                  <div className="mb-2.5 flex items-center gap-2.5">
                    {/* Status dot */}
                    <span className={`relative flex h-2 w-2 shrink-0 ${isThinking ? "" : ""}`}>
                      {(isSpeaking || isThinking) && (
                        <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${isThinking ? "bg-violet-400" : "bg-indigo-400"}`} />
                      )}
                      <span className={`relative inline-flex h-2 w-2 rounded-full ${isThinking ? "bg-violet-500" : isSpeaking ? "bg-indigo-500" : "bg-indigo-400"}`} />
                    </span>

                    {/* Speaker label */}
                    <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-indigo-600/80">
                      {bubble.speaker}
                    </span>

                    {/* Divider */}
                    <span className="h-3 w-px bg-gray-300/60" />

                    {/* State badge */}
                    <span className={`rounded-full px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] border ${
                      isThinking
                        ? "border-violet-200/80 bg-violet-50/80 text-violet-600"
                        : "border-indigo-200/80 bg-indigo-50/80 text-indigo-600"
                    }`}>
                      {bubble.state}
                    </span>
                  </div>

                  {/* Message text */}
                  <p className={`m-0 text-[15px] font-medium leading-[1.65] tracking-[0.005em] ${isThinking ? "text-violet-950/70 italic" : "text-gray-800"}`}>
                    {bubble.text}
                  </p>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}
