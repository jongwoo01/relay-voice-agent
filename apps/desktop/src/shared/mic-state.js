export function createInitialMicState() {
  return {
    enabled: true,
    mode: "idle"
  };
}

export function toggleMicState(state) {
  if (state.enabled) {
    return {
      enabled: false,
      mode: "muted"
    };
  }

  return {
    enabled: true,
    mode: "idle"
  };
}
