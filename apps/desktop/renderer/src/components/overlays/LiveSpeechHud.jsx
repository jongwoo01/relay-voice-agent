import { AnimatePresence, motion } from "motion/react";

function buildHudBubbles({ sessionActive, voiceState, inputPartial, outputTranscript }) {
  if (!sessionActive) {
    return [];
  }

  const bubbles = [];
  const userText = String(inputPartial ?? "").trim();
  const assistantText = String(outputTranscript ?? "").trim();

  if (userText) {
    bubbles.push({
      id: "user-live",
      speaker: "You",
      tone: "user",
      state:
        voiceState.activity?.userSpeaking || voiceState.status === "listening"
          ? "Listening"
          : "Voice input",
      text: userText
    });
  } else if (voiceState.activity?.userSpeaking || voiceState.status === "listening") {
    bubbles.push({
      id: "user-listening",
      speaker: "You",
      tone: "user",
      state: "Listening",
      text: "Listening..."
    });
  }

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

  return bubbles.slice(-2);
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
    <div className="pointer-events-none absolute inset-x-0 bottom-32 z-[18] flex justify-center px-6">
      <div className="flex w-full max-w-[760px] flex-col items-center gap-3">
        <AnimatePresence initial={false}>
          {bubbles.map((bubble) => {
            const isUser = bubble.tone === "user";
            return (
              <motion.div
                key={bubble.id}
                initial={{ opacity: 0, y: 14, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.98 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
                className={`w-fit max-w-[min(92vw,680px)] rounded-[28px] border px-5 py-4 shadow-[0_18px_60px_-30px_rgba(15,23,42,0.35)] backdrop-blur-2xl ${
                  isUser
                    ? "border-cyan-200/70 bg-[linear-gradient(135deg,rgba(243,253,255,0.88),rgba(208,244,255,0.74))] text-cyan-950"
                    : "border-violet-200/70 bg-[linear-gradient(135deg,rgba(252,250,255,0.9),rgba(233,226,255,0.76))] text-slate-900"
                }`}
              >
                <div className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  <span>{bubble.speaker}</span>
                  <span className="rounded-full bg-white/60 px-2 py-1 text-[10px] tracking-[0.12em] text-slate-500">
                    {bubble.state}
                  </span>
                </div>
                <p className="m-0 text-[15px] font-medium leading-relaxed">
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
