import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CrossIcon } from "../icons.jsx";
import {
  formatMicrophoneAccessError,
  requestMicrophoneStream
} from "../../microphone-access.js";

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

  if (value === "restricted") {
    return "Restricted";
  }

  if (value === "not-determined") {
    return "Not requested";
  }

  return "Unknown";
}

function formatStatusLabel(value) {
  if (value === "ready") {
    return "Ready";
  }

  if (value === "warning") {
    return "Needs Attention";
  }

  if (value === "error") {
    return "Blocked";
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

function toneForStatus(status) {
  if (status === "ready") {
    return "success";
  }

  if (status === "warning") {
    return "warning";
  }

  if (status === "error") {
    return "error";
  }

  return "neutral";
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

function MetaChips({ items }) {
  const visibleItems = items.filter(Boolean);
  if (visibleItems.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {visibleItems.map((item) => (
        <span
          key={item}
          className="rounded-full border border-gray-200 bg-white px-3 py-1 text-[11px] text-gray-600"
        >
          {item}
        </span>
      ))}
    </div>
  );
}

function SetupStatusItem({ title, item, meta = [], actions = null, children = null }) {
  return (
    <div className="rounded-[24px] border border-gray-200 bg-white px-4 py-4 shadow-[0_14px_34px_-26px_rgba(15,23,42,0.28)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="m-0 text-sm font-semibold text-gray-800">{title}</p>
            <Badge tone={toneForStatus(item.status)}>{formatStatusLabel(item.status)}</Badge>
          </div>
          <p className="m-0 mt-2 text-sm font-medium text-gray-700">{item.summary}</p>
          <p className="m-0 mt-1 text-xs leading-relaxed text-gray-500">{item.detail}</p>
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap justify-end gap-2">{actions}</div> : null}
      </div>
      <div className="mt-3 space-y-3">
        <MetaChips items={meta} />
        {children}
      </div>
    </div>
  );
}

function MicrophoneLevelPreview({ open, selectedMicId, enabled }) {
  const [level, setLevel] = useState(0);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open || !enabled || !navigator.mediaDevices?.getUserMedia) {
      setLevel(0);
      return undefined;
    }

    let cancelled = false;
    let stream;
    let audioContext;
    let analyser;
    let source;
    let animationFrame = 0;
    const data = new Uint8Array(512);

    const tick = () => {
      if (!analyser || cancelled) {
        return;
      }

      analyser.getByteTimeDomainData(data);
      let sumSquares = 0;
      for (let index = 0; index < data.length; index += 1) {
        const normalized = (data[index] - 128) / 128;
        sumSquares += normalized * normalized;
      }
      const rms = Math.sqrt(sumSquares / data.length);
      setLevel(Math.min(1, rms * 5.5));
      animationFrame = requestAnimationFrame(tick);
    };

    (async () => {
      try {
        setError(null);
        const result = await requestMicrophoneStream({
          mediaDevices: navigator.mediaDevices,
          selectedMicId,
          audioConstraints: {
            channelCount: 1
          }
        });
        stream = result.stream;

        if (cancelled) {
          return;
        }

        audioContext = new AudioContext();
        source = audioContext.createMediaStreamSource(stream);
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 1024;
        source.connect(analyser);
        tick();
      } catch (nextError) {
        const formatted = formatMicrophoneAccessError(nextError, {
          selectedMicId
        });
        setError(
          formatted instanceof Error ? formatted.message : "Microphone preview failed."
        );
      }
    })();

    return () => {
      cancelled = true;
      if (animationFrame) {
        cancelAnimationFrame(animationFrame);
      }
      setLevel(0);
      source?.disconnect?.();
      if (audioContext && audioContext.state !== "closed") {
        void audioContext.close().catch(() => undefined);
      }
      stream?.getTracks?.().forEach((track) => track.stop());
    };
  }, [enabled, open, selectedMicId]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-gray-400">
          Live Input Level
        </span>
        <span className="text-[11px] text-gray-500">
          {enabled ? `${Math.round(level * 100)}%` : "Unavailable"}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-gray-200">
        <div
          className="h-full rounded-full bg-gradient-to-r from-sky-400 via-cyan-400 to-emerald-400 transition-[width] duration-100"
          style={{ width: `${Math.max(4, Math.round(level * 100))}%` }}
        />
      </div>
      {error ? <p className="m-0 text-[11px] text-rose-600">{error}</p> : null}
    </div>
  );
}

function DirectoryProbeList({ directories }) {
  if (!Array.isArray(directories) || directories.length === 0) {
    return null;
  }

  return (
    <div className="grid gap-2">
      {directories.map((directory) => (
        <div
          key={directory.key}
          className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-gray-200 bg-gray-50 px-3 py-2"
        >
          <div className="min-w-0">
            <p className="m-0 text-xs font-medium text-gray-700">{directory.label}</p>
            <p className="m-0 mt-1 truncate text-[11px] text-gray-500">{directory.path || "Unavailable"}</p>
          </div>
          <Badge tone={directory.status === "granted" ? "success" : directory.status === "probe_failed" ? "warning" : "neutral"}>
            {directory.status === "granted" ? "Readable" : directory.status === "probe_failed" ? "Probe Failed" : "Unavailable"}
          </Badge>
        </div>
      ))}
    </div>
  );
}

export function SettingsModal({
  open,
  onClose,
  settings,
  systemStatus,
  microphones,
  selectedMicId,
  selectedMicrophoneLabel,
  setupStatus,
  setupStatusLoading,
  executionMode,
  executorHealth,
  historyLoading,
  onSelectMicrophone,
  onRefreshMicrophones,
  onRefreshSetupStatus,
  onRequestMicrophoneAccess,
  onMicrophoneEnabledChange,
  onStartMutedChange,
  onExecutorEnabledChange,
  onRetryExecutorHealthCheck,
  onMotionPreferenceChange,
  onHeaderHealthWarningsChange,
  onCopyText,
  onDisableGeminiFolderTrust,
  onOpenGeminiLoginTerminal,
  onOpenDeveloperConsole,
  onOpenSupportTarget,
  debugFilters,
  onToggleDebugFilter,
  onCopyDiagnostics,
  onRefreshHistory,
  onResetSettings,
  onTrustGeminiWorkspace
}) {
  const [copiedAt, setCopiedAt] = useState(null);
  const platform = globalThis.window?.desktopSystem?.platform ?? "unknown";
  const supportsSystemPrivacyShortcut =
    platform === "darwin" || platform === "win32";
  const privacySettingsLabel =
    platform === "win32" ? "Open Windows Privacy Settings" : "Open Privacy Settings";
  const permissionTone =
    systemStatus.microphonePermissionStatus === "granted"
      ? "success"
      : systemStatus.microphonePermissionStatus === "denied" ||
          systemStatus.microphonePermissionStatus === "restricted"
        ? "error"
        : systemStatus.microphonePermissionStatus === "not-determined"
          ? "warning"
          : "neutral";
  const shouldShowMicrophonePrivacyShortcut =
    supportsSystemPrivacyShortcut &&
    (systemStatus.microphonePermissionStatus === "denied" ||
      systemStatus.microphonePermissionStatus === "restricted");
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

  const setup = setupStatus ?? {};

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
            className="flex max-h-[88vh] w-full max-w-[1040px] flex-col overflow-hidden rounded-[34px] border border-gray-200 bg-[#f8f9fb]/95 shadow-2xl"
            initial={{ y: 18, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 18, opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-gray-200/80 px-7 py-6">
              <div>
                <h2 className="m-0 text-xl font-semibold tracking-tight text-gray-900">
                  Setup & Settings
                </h2>
                <p className="m-0 mt-1 text-sm text-gray-500">
                  Readiness checks first, then voice defaults, local executor controls, and diagnostics.
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
                title="Setup Status"
                description="Relay's critical readiness checks live here: voice permissions, hosted backend reachability, local Gemini CLI, file access, and trusted workspace coverage."
              >
                <div className="flex items-center justify-between gap-3 rounded-[22px] border border-blue-100 bg-blue-50/70 px-4 py-3">
                  <div>
                    <p className="m-0 text-sm font-medium text-blue-900">Readiness snapshot</p>
                    <p className="m-0 mt-1 text-xs text-blue-700">
                      Last checked: {formatCheckedAt(setup.checkedAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={setupStatusLoading ? "warning" : "neutral"}>
                      {setupStatusLoading ? "Refreshing…" : "On demand"}
                    </Badge>
                    <SecondaryButton
                      onClick={() => void onRefreshSetupStatus({ refresh: true })}
                      disabled={setupStatusLoading}
                    >
                      Retry checks
                    </SecondaryButton>
                  </div>
                </div>

                <SetupStatusItem
                  title="Hosted backend"
                  item={setup.hostedBackend}
                  meta={[setup.hostedBackend?.baseUrl ? `Base URL: ${setup.hostedBackend.baseUrl}` : null]}
                  actions={
                    <SecondaryButton onClick={onRefreshHistory}>
                      Refresh sessions
                    </SecondaryButton>
                  }
                />

                <SetupStatusItem
                  title="Microphone"
                  item={setup.microphone}
                  meta={[
                    `Permission: ${formatPermissionStatus(systemStatus.microphonePermissionStatus)}`,
                    `Input: ${selectedMicText}`
                  ]}
                  actions={
                    <>
                      <SecondaryButton onClick={() => void onRequestMicrophoneAccess()}>
                        Request access
                      </SecondaryButton>
                      {shouldShowMicrophonePrivacyShortcut ? (
                        <SecondaryButton
                          onClick={() =>
                            void globalThis.window?.desktopSystem?.openMicrophonePrivacySettings?.()
                          }
                        >
                          {privacySettingsLabel}
                        </SecondaryButton>
                      ) : null}
                    </>
                  }
                >
                  <MicrophoneLevelPreview
                    open={open}
                    selectedMicId={selectedMicId}
                    enabled={systemStatus.microphonePermissionStatus === "granted"}
                  />
                </SetupStatusItem>

                <SetupStatusItem
                  title="Local executor binary"
                  item={setup.localExecutorBinary}
                  meta={[
                    setup.localExecutorBinary?.commandPath
                      ? `Path: ${setup.localExecutorBinary.commandPath}`
                      : null,
                    setup.localExecutorBinary?.version
                      ? `Version: ${setup.localExecutorBinary.version}`
                      : null,
                    setup.localExecutorBinary?.commandSource
                      ? `Source: ${setup.localExecutorBinary.commandSource}`
                      : null
                  ]}
                  actions={
                    <>
                      <SecondaryButton onClick={() => void onCopyText("gemini --version")}>
                        Copy setup command
                      </SecondaryButton>
                      <SecondaryButton
                        onClick={() => void onOpenSupportTarget("gemini_install_docs")}
                      >
                        Open install docs
                      </SecondaryButton>
                    </>
                  }
                />

                <SetupStatusItem
                  title="Local file access"
                  item={setup.localFileAccess}
                  meta={[
                    setup.localFileAccess?.probeSource
                      ? `Probe source: ${setup.localFileAccess.probeSource}`
                      : null
                  ]}
                  actions={
                    platform === "darwin" ? (
                      <SecondaryButton
                        onClick={() =>
                          void globalThis.window?.desktopSystem?.openMacPrivacySettings?.("files")
                        }
                      >
                        Open Privacy Settings
                      </SecondaryButton>
                    ) : null
                  }
                >
                  <DirectoryProbeList directories={setup.localFileAccess?.directories ?? []} />
                </SetupStatusItem>

                <SetupStatusItem
                  title="Workspace tools readiness"
                  item={setup.workspaceToolsReady}
                  meta={[
                    setup.workspaceToolsReady?.workspacePath
                      ? `Workspace: ${setup.workspaceToolsReady.workspacePath}`
                      : null,
                    setup.workspaceToolsReady?.outputFormat
                      ? `Output format: ${setup.workspaceToolsReady.outputFormat}`
                      : null,
                    setup.workspaceToolsReady?.expectedResponse
                      ? `Expected probe: ${setup.workspaceToolsReady.expectedResponse}`
                      : null
                  ]}
                  actions={
                    <>
                      <SecondaryButton onClick={() => void onRefreshSetupStatus({ refresh: true })}>
                        Retry workspace probe
                      </SecondaryButton>
                      <SecondaryButton
                        onClick={() => void onOpenSupportTarget("gemini_trusted_docs")}
                      >
                        Open trust docs
                      </SecondaryButton>
                    </>
                  }
                />

                <SetupStatusItem
                  title="Gemini workspace trust"
                  item={setup.geminiWorkspaceTrust}
                  meta={[
                    setup.geminiWorkspaceTrust?.workspacePath
                      ? `Workspace: ${setup.geminiWorkspaceTrust.workspacePath}`
                      : null,
                    setup.geminiWorkspaceTrust?.folderTrustEnabled === true
                      ? "Trusted Folders: enabled"
                      : "Trusted Folders: disabled",
                    setup.geminiWorkspaceTrust?.effectiveRulePath
                      ? `Rule path: ${setup.geminiWorkspaceTrust.effectiveRulePath}`
                      : null,
                    setup.geminiWorkspaceTrust?.effectiveRuleValue
                      ? `Rule value: ${setup.geminiWorkspaceTrust.effectiveRuleValue}`
                      : null
                  ]}
                  actions={
                    <>
                      <SecondaryButton
                        onClick={() => void onOpenSupportTarget("gemini_trusted_docs")}
                      >
                        Open trust docs
                      </SecondaryButton>
                      <SecondaryButton
                        onClick={() => void onOpenSupportTarget("gemini_trusted_folders")}
                      >
                        Open trustedFolders.json
                      </SecondaryButton>
                      <SecondaryButton
                        onClick={() => void onDisableGeminiFolderTrust()}
                        disabled={setup.geminiWorkspaceTrust?.folderTrustEnabled !== true}
                      >
                        Disable Trusted Folders
                      </SecondaryButton>
                      <SecondaryButton
                        onClick={() => void onTrustGeminiWorkspace()}
                        disabled={
                          setup.geminiWorkspaceTrust?.folderTrustEnabled !== true ||
                          setup.geminiWorkspaceTrust?.trusted === true
                        }
                      >
                        Trust this workspace
                      </SecondaryButton>
                    </>
                  }
                />

              </Section>

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
                      className="min-w-[260px] rounded-2xl border border-gray-200/80 bg-white px-4 py-3 text-sm text-gray-700 outline-none cursor-pointer shadow-sm hover:border-gray-300/90 focus:border-blue-400/60 focus:ring-2 focus:ring-blue-100/70 transition-all appearance-none"
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
                  description="Turn this on to use the microphone in hosted sessions. On a fresh machine, request access in Relay first so macOS can register the app. Open system privacy settings only after the OS has already denied or restricted access."
                  action={
                    <Toggle
                      checked={settings.audio.voiceCaptureEnabled !== false}
                      onChange={(nextValue) => void onMicrophoneEnabledChange(nextValue)}
                      label="Use microphone in hosted sessions"
                    />
                  }
                >
                  <div className="flex flex-wrap gap-2">
                    <Badge tone={permissionTone}>
                      {formatPermissionStatus(systemStatus.microphonePermissionStatus)}
                    </Badge>
                    <SecondaryButton onClick={() => void onRequestMicrophoneAccess()}>
                      Request microphone access
                    </SecondaryButton>
                    {shouldShowMicrophonePrivacyShortcut ? (
                      <SecondaryButton
                        onClick={() =>
                          void globalThis.window?.desktopSystem?.openMicrophonePrivacySettings?.()
                        }
                      >
                        {privacySettingsLabel}
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
                  description="Runs a minimal non-interactive Gemini CLI probe and shows diagnostics without blocking local tasks."
                  action={<Badge tone={executorTone(executorHealth)}>{executorHealth.code ?? "unknown"}</Badge>}
                >
                  <div className="space-y-3">
                    <div>
                      <p className="m-0 text-sm font-medium text-gray-800">
                        {executorHealth.summary}
                      </p>
                      <p className="m-0 mt-1 text-sm leading-relaxed text-gray-600">
                        {executorHealth.detail}
                      </p>
                    </div>
                    {executorHealth.stderrSnippet ? (
                      <div className="rounded-2xl border border-amber-200 bg-amber-50/70 px-4 py-3">
                        <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700">
                          Saved stderr snippet
                        </p>
                        <pre className="m-0 mt-2 whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-amber-900">
                          {executorHealth.stderrSnippet}
                        </pre>
                      </div>
                    ) : null}
                    {executorHealth.stdoutSnippet ? (
                      <div className="rounded-2xl border border-sky-200 bg-sky-50/70 px-4 py-3">
                        <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">
                          Saved stdout snippet
                        </p>
                        <pre className="m-0 mt-2 whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-sky-900">
                          {executorHealth.stdoutSnippet}
                        </pre>
                      </div>
                    ) : null}
                    <div className="flex flex-wrap gap-2 text-xs text-gray-500">
                      <span>Last checked: {formatCheckedAt(executorHealth.checkedAt)}</span>
                      <span>Command: {executorHealth.commandPath ?? "unknown"}</span>
                      <span>Exit: {executorHealth.exitCode ?? "unknown"}</span>
                      <span>Cwd: {executorHealth.probeWorkingDirectory ?? "unknown"}</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <SecondaryButton onClick={onRetryExecutorHealthCheck}>
                        Retry checks
                      </SecondaryButton>
                      <SecondaryButton onClick={() => void onOpenGeminiLoginTerminal()}>
                        Open Terminal for gemini login
                      </SecondaryButton>
                      <SecondaryButton
                        onClick={() => void onOpenSupportTarget("gemini_auth_docs")}
                      >
                        Open auth docs
                      </SecondaryButton>
                      <SecondaryButton
                        onClick={() => void onOpenSupportTarget("gemini_settings")}
                      >
                        Open ~/.gemini/settings.json
                      </SecondaryButton>
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
                description="Read-only execution context, debug defaults, and troubleshooting tools."
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
                  description="Open the developer console, copy a diagnostics snapshot, refresh recent sessions, or reset all local settings."
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
                      Reset all local settings
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
