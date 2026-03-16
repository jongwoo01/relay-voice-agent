export function classifyExecutorHealthTone(executorHealth) {
  if (
    !executorHealth ||
    executorHealth.status === "healthy" ||
    executorHealth.status === "unknown"
  ) {
    return null;
  }

  if (executorHealth.status === "checking") {
    return "info";
  }

  return executorHealth.code === "permission_denied" ? "warning" : "error";
}

export function buildExecutorHealthBannerModel(executorHealth, platform) {
  const tone = classifyExecutorHealthTone(executorHealth);
  if (!tone) {
    return null;
  }

  return {
    tone,
    title: executorHealth.summary,
    detail: executorHealth.detail,
    checkedAt: executorHealth.checkedAt ?? null,
    showPrivacyShortcut:
      executorHealth.code === "permission_denied" && platform === "darwin",
    showRetry: true
  };
}
