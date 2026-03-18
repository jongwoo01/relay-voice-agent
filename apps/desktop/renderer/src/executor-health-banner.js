export function classifyExecutorHealthTone(executorHealth) {
  if (!executorHealth || executorHealth.status !== "unhealthy") {
    return null;
  }

  return executorHealth.code === "permission_denied" ? "warning" : "error";
}

export function buildExecutorHealthBannerModel(executorHealth, platform) {
  const tone = classifyExecutorHealthTone(executorHealth);
  if (!tone) {
    return null;
  }

  const permissionDenied = executorHealth.code === "permission_denied";

  return {
    tone,
    title: executorHealth.summary,
    detail: executorHealth.detail,
    checkedAt: executorHealth.checkedAt ?? null,
    showPrivacyShortcut: permissionDenied && platform === "darwin",
    privacySection: permissionDenied ? "files" : null,
    showRetry: true,
    showSettingsShortcut: true
  };
}
