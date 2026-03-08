import type { MemorySignal } from "@agent/shared-types";

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function createSignal(
  type: MemorySignal["type"],
  summary: string,
  policy: MemorySignal["policy"],
  confidence: number
): MemorySignal {
  return {
    type,
    summary,
    policy,
    confidence
  };
}

export function extractMemorySignals(text: string): MemorySignal[] {
  const normalized = normalize(text);
  if (!normalized) {
    return [];
  }

  const signals: MemorySignal[] = [];

  if (/((내 이름은|저는|난) .+)|(i am .+)/.test(normalized)) {
    signals.push(
      createSignal("profile", `identity cue: ${text.trim()}`, "immediate", 0.92)
    );
  }

  if (/(좋아해|싫어해|선호|prefer|favorite|자주 써)/.test(normalized)) {
    signals.push(
      createSignal("preferences", `preference cue: ${text.trim()}`, "immediate", 0.88)
    );
  }

  if (/(매일|매주|항상|보통|평소|habit|routine)/.test(normalized)) {
    signals.push(
      createSignal("routines", `routine cue: ${text.trim()}`, "background", 0.78)
    );
  }

  if (/(오늘|어제|이번 주|주말|방금|아까)/.test(normalized)) {
    signals.push(
      createSignal("dated_life_log", `dated activity cue: ${text.trim()}`, "background", 0.8)
    );
  }

  if (/(해야 해|해야돼|남았어|미뤘어|아직 .*못|나중에|잊지 말아)/.test(normalized)) {
    signals.push(
      createSignal("open_loops", `open loop cue: ${text.trim()}`, "background", 0.82)
    );
  }

  if (/(정리해줘|보내줘|찾아줘|실행해줘|해줘)/.test(normalized)) {
    signals.push(
      createSignal("task_history", `task pattern cue: ${text.trim()}`, "background", 0.7)
    );
  }

  return signals;
}
