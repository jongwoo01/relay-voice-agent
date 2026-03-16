import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CrossIcon } from "../icons.jsx";

function formatCheckedAt(value) {
  if (!value) {
    return "Not checked yet";
  }

  return new Date(value).toLocaleString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    month: "short",
    day: "numeric"
  });
}

function formatExecutionMode(value) {
  return value === "mock" ? "Mock executor" : "Gemini CLI";
}

function formatPermissionStatus(value) {
  if (value === "granted") {
    return "Granted";
  }

  if (value === "denied") {
    return "Denied";
  }

  return "Unknown";
}

function Section({ title, description, children }) {
  return (
    <section className="rounded-[28px] border border-gray-200/80 bg-white/85 px-5 py-5 shadow-[0_18px_40px_-28px_rgba(15,23,42,0.28)]">
      <div className="mb-4">
        <h3 className="m-0 text-sm font-semibold tracking-wide text-gray-800">{title}</h3>
        <p className="m-0 mt-1 text-xs leading-relaxed text-gray-500">{description}</p>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function SettingRow({ title, description, action, children }) {
  return (
    <div className="flex flex-col gap-3 rounded-[22px] border border-gray-100 bg-gray-50/80 px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="m-0 text-sm font-medium text-gray-800">{title}</p>
          <p className="m-0 mt-1 text-xs leading-relaxed text-gray-500">{description}</p>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </div>
  );
}

function Toggle({ checked, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`inline-flex h-8 w-14 items-center rounded-full border transition-colors ${
        checked
          ? "border-blue-500 bg-blue-500/90"
          : "border-gray-300 bg-white"
      }`}
    >
      <span
        className={`ml-1 inline-flex h-6 w-6 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-6" : "translate-x-0"
        }`}
      />
    </button>
  );
}

function Badge({ children, tone = "neutral" }) {
  const className =
    tone === "success"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : tone === "warning"
        ? "bg-amber-50 text-amber-800 border-amber-200"
        : tone === "error"
          ? "bg-rose-50 text-rose-700 border-rose-200"
          : "bg-gray-50 text-gray-600 border-gray-200";

  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium ${className}`}>
      {children}
    </span>
  );
}

function SecondaryButton({ children, onClick, disabled = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-full border border-gray-200 bg-white px-4 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function executorTone(executorHealth) {
  if (executorHealth.status === "healthy") {
    return "success";
  }

  if (executorHealth.code === "permission_denied") {
    return "warning";
  }

  if (executorHealth.status === "checking") {
    return "neutral";
  }

  return "error";
}

export function SettingsModal({
  open,
  onClose,
  settings,
  systemStatus,
  microphones,
  selectedMicId,
  selectedMicrophoneLabel,
  executionMode,
  executorHealth,
  historyLoading,
  onSelectMicrophone,
  onRefreshMicrophones,
  onRequestMicrophoneAccess,
  onStartMutedChange,
  onExecutorEnabledChange,
  onRetryExecutorHealthCheck,
  onMotionPreferenceChange,
  onHeaderHealthWarningsChange,
  onAutoOpenCompletedTasksChange,
  onOpenDeveloperConsole,
  debugFilters,
  onToggleDebugFilter,
  onCopyDiagnostics,
  onRefreshHistory,
  onResetSettings
}) {
  const [copiedAt, setCopiedAt] = useState(null);
  const platform = globalThis.window?.desktopSystem?.platform ?? "unknown";
  const permissionTone =
    systemStatus.microphonePermissionStatus === "granted"
      ? "success"
      : systemStatus.microphonePermissionStatus === "denied"
        ? "error"
        : "neutral";
  const selectedMicText = useMemo(() => {
    if (!selectedMicId) {
      return selectedMicrophoneLabel || "Default input";
    }

    return (
      microphones.find((device) => device.deviceId === selectedMicId)?.label ||
      selectedMicrophoneLabel ||
      "Selected input"
    );
  }, [microphones, selectedMicId, selectedMicrophoneLabel]);

  useEffect(() => {
    if (!copiedAt) {
      return undefined;
    }

    const timer = setTimeout(() => {
      setCopiedAt(null);
    }, 1800);

    return () => clearTimeout(timer);
  }, [copiedAt]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30 p-6 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.section
            className="flex max-h-[88vh] w-full max-w-[980px] flex-col overflow-hidden rounded-[34px] border border-gray-200 bg-[#f8f9fb]/95 shadow-2xl"
            initial={{ y: 18, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 18, opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-gray-200/80 px-7 py-6">
              <div>
                <h2 className="m-0 text-xl font-semibold tracking-tight text-gray-900">
                  Settings
                </h2>
                <p className="m-0 mt-1 text-sm text-gray-500">
                  Audio devices, local executor health, interface preferences, and diagnostics.
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close settings"
                className="flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800"
              >
                <CrossIcon />
              </button>
            </div>
            <div className="grid gap-5 overflow-y-auto px-7 py-6">
              <Section
                title="Audio & Voice"
                description="Choose the default microphone and how voice capture should behave when a session starts."
              >
                <SettingRow
                  title="Default microphone"
                  description="Relay will reuse this input device the next time voice capture starts."
                  action={
                    <SecondaryButton onClick={onRefreshMicrophones}>
                      Refresh devices
                    </SecondaryButton>
                  }
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <select
                      value={selectedMicId}
                      onChange={(event) => void onSelectMicrophone(event.target.value)}
                      className="min-w-[260px] rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700 outline-none"
                    >
                      {microphones.length === 0 ? (
                        <option value="">Default input</option>
                      ) : (
                        microphones.map((microphone) => (
                          <option key={microphone.deviceId} value={microphone.deviceId}>
                            {microphone.label || "Audio input"}
                          </option>
                        ))
                      )}
                    </select>
                    <Badge>{selectedMicText}</Badge>
                  </div>
                </SettingRow>

                <SettingRow
                  title="Microphone permission"
                  description="Voice mode requires OS microphone access before Relay can open a hosted session."
                  action={
                    <Badge tone={permissionTone}>
                      {formatPermissionStatus(systemStatus.microphonePermissionStatus)}
                    </Badge>
                  }
                >
                  <div className="flex flex-wrap gap-2">
                    <SecondaryButton onClick={() => void onRequestMicrophoneAccess()}>
                      Request microphone access
                    </SecondaryButton>
                    {platform === "darwin" ? (
                      <SecondaryButton
                        onClick={() =>
                          void globalThis.window?.desktopSystem?.openMacPrivacySettings?.()
                        }
                      >
                        Open Privacy Settings
                      </SecondaryButton>
                    ) : null}
                  </div>
                </SettingRow>

                <SettingRow
                  title="Start session muted"
                  description="Apply mute immediately after connection so voice capture starts in a safe default state."
                  action={
                    <Toggle
                      checked={settings.audio.startMuted}
                      onChange={(nextValue) => void onStartMutedChange(nextValue)}
                      label="Start session muted"
                    />
                  }
                />
              </Section>

              <Section
                title="Local Executor"
                description="Relay uses the local Gemini CLI for grounded machine work. This section helps diagnose and control that path."
              >
                <SettingRow
                  title="Gemini CLI health"
                  description="Checks whether the CLI is installed, authenticated, and ready for local tasks."
                  action={<Badge tone={executorTone(executorHealth)}>{executorHealth.code ?? "unknown"}</Badge>}
                >
                  <div className="space-y-2">
                    <p className="m-0 text-sm font-medium text-gray-800">
                      {executorHealth.summary}
                    </p>
                    <p className="m-0 text-sm leading-relaxed text-gray-600">
                      {executorHealth.detail}
                    </p>
                    <div className="flex flex-wrap gap-2 text-xs text-gray-500">
                      <span>Last checked: {formatCheckedAt(executorHealth.checkedAt)}</span>
                      <span>Command: {executorHealth.commandPath ?? "unknown"}</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <SecondaryButton onClick={onRetryExecutorHealthCheck}>
                        Retry health check
                      </SecondaryButton>
                      {platform === "darwin" ? (
                        <SecondaryButton
                          onClick={() =>
                            void globalThis.window?.desktopSystem?.openMacPrivacySettings?.()
                          }
                        >
                          Open Privacy Settings
                        </SecondaryButton>
                      ) : null}
                    </div>
                  </div>
                </SettingRow>

                <SettingRow
                  title="Enable local task execution"
                  description="When off, Relay will keep the hosted session running but refuse local Gemini-backed task execution on this machine."
                  action={
                    <Toggle
                      checked={settings.executor.enabled}
                      onChange={(nextValue) => void onExecutorEnabledChange(nextValue)}
                      label="Enable local task execution"
                    />
                  }
                />
              </Section>

              <Section
                title="Interface"
                description="Adjust display behavior and how much runtime status Relay keeps visible outside this modal."
              >
                <SettingRow
                  title="Reduced motion"
                  description="Follow the system preference or force motion on or off for the live scene."
                >
                  <div className="flex flex-wrap gap-2">
                    {[
                      ["system", "Use system"],
                      ["on", "Always reduce"],
                      ["off", "Allow motion"]
                    ].map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => void onMotionPreferenceChange(value)}
                        className={`rounded-full border px-4 py-2 text-xs font-medium transition-colors ${
                          settings.ui.motionPreference === value
                            ? "border-blue-500 bg-blue-50 text-blue-700"
                            : "border-gray-200 bg-white text-gray-700 hover:bg-gray-100"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </SettingRow>

                <SettingRow
                  title="Auto-open completed tasks"
                  description="Open the completed task drawer automatically when a running task finishes."
                  action={
                    <Toggle
                      checked={settings.ui.autoOpenCompletedTasks}
                      onChange={(nextValue) =>
                        void onAutoOpenCompletedTasksChange(nextValue)
                      }
                      label="Auto-open completed tasks"
                    />
                  }
                />

                <SettingRow
                  title="Show header health warnings"
                  description="Keep the Gemini CLI warning banner visible in the main session header after unlock."
                  action={
                    <Toggle
                      checked={settings.ui.showHeaderHealthWarnings}
                      onChange={(nextValue) =>
                        void onHeaderHealthWarningsChange(nextValue)
                      }
                      label="Show header health warnings"
                    />
                  }
                />

                <SettingRow
                  title="Keyboard shortcuts"
                  description="Relay keeps the advanced console on a hidden shortcut for quick diagnosis."
                >
                  <Badge>Cmd/Ctrl + Shift + D opens Developer Console</Badge>
                </SettingRow>
              </Section>

              <Section
                title="Advanced"
                description="Read-only execution context, debug defaults, and one-shot troubleshooting tools."
              >
                <SettingRow
                  title="Execution mode"
                  description="Read-only runtime mode for the local execution layer."
                  action={<Badge>{formatExecutionMode(executionMode)}</Badge>}
                />

                <SettingRow
                  title="Default debug event filters"
                  description="These saved filters control which event sources the developer console shows by default."
                >
                  <div className="flex flex-wrap gap-2">
                    {Object.keys(debugFilters).map((source) => (
                      <label
                        key={source}
                        className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700"
                      >
                        <input
                          type="checkbox"
                          checked={debugFilters[source]}
                          onChange={() => void onToggleDebugFilter(source)}
                        />
                        {source}
                      </label>
                    ))}
                  </div>
                </SettingRow>

                <SettingRow
                  title="Diagnostics"
                  description="Open the developer console, copy a diagnostics snapshot, or refresh recent sessions from the hosted service."
                >
                  <div className="flex flex-wrap gap-2">
                    <SecondaryButton onClick={onOpenDeveloperConsole}>
                      Open developer console
                    </SecondaryButton>
                    <SecondaryButton
                      onClick={async () => {
                        const snapshot = await onCopyDiagnostics();
                        if (snapshot) {
                          setCopiedAt(Date.now());
                        }
                      }}
                    >
                      {copiedAt ? "Copied diagnostics" : "Copy diagnostics"}
                    </SecondaryButton>
                    <SecondaryButton onClick={onRefreshHistory} disabled={historyLoading}>
                      {historyLoading ? "Refreshing sessions…" : "Refresh recent sessions"}
                    </SecondaryButton>
                    <SecondaryButton onClick={onResetSettings}>
                      Clear local UI preferences
                    </SecondaryButton>
                  </div>
                </SettingRow>
              </Section>
            </div>
          </motion.section>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
