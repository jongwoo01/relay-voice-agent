import { AnimatePresence, motion } from "motion/react";

function buildHudBubbles({ sessionActive, voiceState, inputPartial, outputTranscript }) {
  if (!sessionActive) {
    return [];
  }

  const bubbles = [];
  const assistantText = String(outputTranscript ?? "").trim();

  if (assistantText) {
    bubbles.push({
      id: "assistant-live",
      speaker: "Gemini",
      tone: "assistant",
      state: voiceState.activity?.assistantSpeaking ? "Speaking" : "Responding",
      text: assistantText
    });
  } else if (voiceState.activity?.assistantSpeaking) {
    bubbles.push({
      id: "assistant-speaking",
      speaker: "Gemini",
      tone: "assistant",
      state: "Speaking",
      text: "Speaking..."
    });
  } else if (voiceState.status === "thinking") {
    bubbles.push({
      id: "assistant-thinking",
      speaker: "Gemini",
      tone: "assistant",
      state: "Thinking",
      text: "Thinking..."
    });
  }

  return bubbles.slice(-1);
}

export function LiveSpeechHud({
  sessionActive,
  voiceState,
  inputPartial,
  outputTranscript
}) {
  const bubbles = buildHudBubbles({
    sessionActive,
    voiceState,
    inputPartial,
    outputTranscript
  });

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-10 z-[18] flex justify-center px-6">
      <div className="flex max-h-[25vh] w-full max-w-[760px] flex-col-reverse items-center gap-3 overflow-y-auto scrollbar-hide [mask-image:linear-gradient(to_bottom,transparent,black_20%,black_100%)]">
        <AnimatePresence initial={false}>
          {bubbles.map((bubble) => {
            return (
              <motion.div
                key={bubble.id}
                initial={{ opacity: 0, y: 14, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.98 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
                className="w-fit max-w-[min(92vw,680px)] shrink-0 rounded-[32px] border border-indigo-300/30 bg-indigo-50/20 px-6 py-4 text-indigo-950 shadow-[0_8px_32px_-8px_rgba(79,70,229,0.15)] ring-1 ring-inset ring-white/40 backdrop-blur-3xl transition-all"
              >
                <div className="mb-2 flex items-center gap-2.5 text-[11px] font-semibold uppercase tracking-[0.18em]">
                  <span className="text-indigo-500/90">{bubble.speaker}</span>
                  <span className="rounded-full bg-white/50 px-2.5 py-1 text-[10px] tracking-[0.16em] text-indigo-500 shadow-sm ring-1 ring-inset ring-indigo-200/50 backdrop-blur-xl">
                    {bubble.state}
                  </span>
                </div>
                <p className="m-0 text-[15px] font-medium leading-relaxed tracking-wide">
                  {bubble.text}
                </p>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}
