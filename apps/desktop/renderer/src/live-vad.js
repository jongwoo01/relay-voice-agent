export const SPEECH_CANDIDATE_DIP_TOLERANCE_MS = 120;

export function deriveLiveSpeechGate(
  config,
  threshold,
  { assistantSpeaking = false } = {}
) {
  const baseThreshold = Math.max(config?.minSpeechThreshold ?? 0, threshold ?? 0);

  if (!assistantSpeaking) {
    return {
      onsetThreshold: baseThreshold,
      confirmMs: config?.confirmMs ?? 0,
      minRms: baseThreshold * Math.max(0.34, Math.min(0.52, config?.transientRmsRatio ?? 0.42))
    };
  }

  return {
    onsetThreshold: Math.max(baseThreshold * 1.3, (config?.minSpeechThreshold ?? baseThreshold) * 1.35),
    confirmMs: Math.max((config?.confirmMs ?? 0) + 120, Math.round((config?.confirmMs ?? 0) * 1.7)),
    minRms:
      Math.max(baseThreshold * 1.3, (config?.minSpeechThreshold ?? baseThreshold) * 1.35) *
      Math.max(0.58, (config?.transientRmsRatio ?? 0.42) + 0.18)
  };
}

export function classifyLiveSpeechCandidate({
  activityLevel,
  rms,
  threshold,
  config,
  assistantSpeaking = false
}) {
  const gate = deriveLiveSpeechGate(config, threshold, { assistantSpeaking });
  return {
    ...gate,
    accepted: activityLevel >= gate.onsetThreshold && rms >= gate.minRms
  };
}
