import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { AgentActivityPanel } from "./components/activity/AgentActivityPanel.jsx";
import { HistoryIcon, SettingsIcon } from "./components/icons.jsx";
import { LiveSpeechHud } from "./components/overlays/LiveSpeechHud.jsx";
import { buildExecutorHealthBannerModel } from "./executor-health-banner.js";
import { useDesktopAppController } from "./hooks/useDesktopAppController.js";

const LiveScene = lazy(() => import("./LiveScene.jsx"));
const ConversationOverlay = lazy(() =>
  import("./components/overlays/ConversationOverlay.jsx").then((module) => ({
    default: module.ConversationOverlay
  }))
);
const HistoryModal = lazy(() =>
  import("./components/overlays/HistoryModal.jsx").then((module) => ({
    default: module.HistoryModal
  }))
);
const SettingsModal = lazy(() =>
  import("./components/overlays/SettingsModal.jsx").then((module) => ({
    default: module.SettingsModal
  }))
);
const DebugConsole = lazy(() =>
  import("./components/overlays/DebugConsole.jsx").then((module) => ({
    default: module.DebugConsole
  }))
);
const relayLogoUrl = new URL("../../build/icon.png", import.meta.url).href;

function runtimeMetaText(uiState, voiceState) {
  if (uiState.runtimeError) {
    return "Connection needs attention";
  }

  if (voiceState.connecting) {
    return "Connecting to Relay…";
  }

  if (voiceState.connected) {
    return uiState.brainSessionId
      ? `Session ${uiState.brainSessionId.slice(0, 8)} is live`
      : "Relay is ready";
  }

  return "Connect to start a Relay session";
}

function classifyRuntimeIssue(errorText, platform) {
  if (!errorText) {
    return null;
  }

  const normalized = errorText.toLowerCase();

  if (
    normalized.includes("permission denied") ||
    normalized.includes("operation not permitted") ||
    normalized.includes("eacces")
  ) {
      return {
      kind: "permission",
      title: "Local access needs macOS permission",
      guidance:
        platform === "darwin"
          ? "Open macOS Privacy settings and allow Relay to access your files. If needed, grant Full Disk Access and Files & Folders for Desktop, Documents, and Downloads."
          : "Allow the app to access the folders it needs, then retry the task."
    };
  }

  if (
    normalized.includes("spawn gemini") ||
    normalized.includes("gemini") && normalized.includes("not found") ||
    normalized.includes("enoent")
  ) {
    return {
      kind: "gemini_cli",
      title: "Gemini CLI needs to be available locally",
      guidance:
        "Install the Gemini CLI on this machine and make sure the app can find it from /usr/local/bin, /opt/homebrew/bin, or GEMINI_CLI_PATH."
    };
  }

  return null;
}

function ExecutorHealthBanner({ model, onRetry, onOpenPrivacySettings, onDismiss }) {
  if (!model) {
    return null;
  }

  const accent =
    model.tone === "info"
      ? {
          surface: "border-sky-200 bg-sky-50/95 text-sky-800 shadow-[0_20px_60px_-20px_rgba(14,165,233,0.22)]",
          secondary: "text-sky-700",
          button: "border-sky-300 bg-white/85 text-sky-800 hover:bg-white"
        }
      : model.tone === "warning"
        ? {
            surface:
              "border-amber-200 bg-amber-50/95 text-amber-900 shadow-[0_20px_60px_-20px_rgba(245,158,11,0.24)]",
            secondary: "text-amber-800",
            button: "border-amber-300 bg-white/85 text-amber-900 hover:bg-white"
          }
        : {
            surface:
              "border-red-200 bg-red-50/95 text-red-800 shadow-[0_20px_60px_-20px_rgba(220,38,38,0.24)]",
            secondary: "text-red-700",
            button: "border-red-300 bg-white/85 text-red-800 hover:bg-white"
          };

  const checkedAtText = model.checkedAt
    ? new Date(model.checkedAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      })
    : null;

  return (
    <div
      className={`rounded-[26px] border px-5 py-4 backdrop-blur-xl ${accent.surface}`}
    >
      <div className="text-[13px] font-semibold tracking-wide">{model.title}</div>
      <p className={`mt-1 text-[13px] leading-relaxed ${accent.secondary}`}>
        {model.detail}
      </p>
      {checkedAtText ? (
        <p className={`mt-2 text-[11px] ${accent.secondary}`}>Last checked · {checkedAtText}</p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        {onDismiss ? (
          <button
            type="button"
            onClick={() => void onDismiss()}
            className={`rounded-full border px-4 py-2 text-[12px] font-semibold transition-colors ${accent.button}`}
          >
            Dismiss
          </button>
        ) : (
          <span />
        )}
        <div className="flex flex-wrap justify-end gap-2">
        {model.showPrivacyShortcut ? (
          <button
            type="button"
            onClick={() => void onOpenPrivacySettings?.(model)}
            className={`rounded-full border px-4 py-2 text-[12px] font-semibold transition-colors ${accent.button}`}
          >
            Open Privacy Settings
          </button>
        ) : null}
        {model.showRetry ? (
          <button
            type="button"
            onClick={() => void onRetry()}
            className={`rounded-full border px-4 py-2 text-[12px] font-semibold transition-colors ${accent.button}`}
          >
            Retry Health Check
          </button>
        ) : null}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const {
    archivedEntries,
    audioEnergy,
    avatarState,
    chatOpen,
    debugFilters,
    debugOpen,
    debugTaskFilter,
    debugTurnFilter,
    displayConversationTimeline,
    deferredUiState,
    executorHealth,
    filteredDebugEvents,
    handleCancelTask,
    handleConnect,
    handleCopyDiagnostics,
    handleCopyText,
    handleExecutorEnabledChange,
    handleHangup,
    handleHeaderHealthWarningsChange,
    handleVoiceCaptureEnabledChange,
    handleMuteToggle,
    handleMotionPreferenceChange,
    handleOpenGeminiLoginTerminal,
    handleOpenDeveloperConsole,
    handleOpenSupportTarget,
    handlePromptKeyDown,
    handlePromptSubmit,
    handleRefreshHistory,
    handleRefreshMicrophones,
    handleRequestMicrophoneAccess,
    handleResetSettings,
    refreshSetupStatus,
    handleRetryExecutorHealthCheck,
    handleSelectMicrophone,
    handleStartMutedChange,
    handleToggleDebugFilter,
    historyEntries,
    historyOpen,
    historySummary,
    inputEnergy,
    microphones,
    mouthOpen,
    passcode,
    prefersReducedMotion,
    prompt,
    promptComposing,
    runtimeError,
    selectedMicId,
    selectedMicrophoneLabel,
    selectedTaskId,
    setupStatus,
    setupStatusLoading,
    taskCancelUiState,
    taskSelectionDismissed,
    setChatOpen,
    setDebugOpen,
    setDebugTaskFilter,
    setDebugTurnFilter,
    setHistoryOpen,
    setPasscode,
    setPrompt,
    setPromptComposing,
    setSettingsOpen,
    handleSelectTask,
    settings,
    settingsOpen,
    summary,
    systemStatus,
    taskRunners,
    turnsById,
    voiceState
  } = useDesktopAppController();

  const [isUnlocked, setIsUnlocked] = useState(false);
  const [showPasscode, setShowPasscode] = useState(false);
  const [passcodeError, setPasscodeError] = useState(false);
  const resolvedRuntimeError = runtimeError ?? deferredUiState.runtimeError;
  const runtimeIssue = classifyRuntimeIssue(
    resolvedRuntimeError,
    window.desktopSystem?.platform ?? "unknown"
  );
  const executorHealthBanner = buildExecutorHealthBannerModel(
    executorHealth,
    window.desktopSystem?.platform ?? "unknown"
  );
  const [dismissedExecutorHealthKey, setDismissedExecutorHealthKey] = useState(null);
  const executorHealthBannerKey = executorHealthBanner
    ? [
        executorHealth.status,
        executorHealth.code ?? "",
        executorHealth.summary ?? "",
        executorHealth.detail ?? "",
        executorHealth.checkedAt ?? ""
      ].join("::")
    : null;

  useEffect(() => {
    if (!executorHealthBannerKey) {
      setDismissedExecutorHealthKey(null);
      return;
    }

    setDismissedExecutorHealthKey((current) =>
      current === executorHealthBannerKey ? current : null
    );
  }, [executorHealthBannerKey]);

  const showExecutorHealthBanner =
    executorHealthBanner && dismissedExecutorHealthKey !== executorHealthBannerKey;

  const handleOpenExecutorPrivacySettings = useCallback(async (model) => {
    if (model?.privacySection === "files") {
      await window.desktopSystem?.openMacPrivacySettings?.("files");
      return;
    }

    await window.desktopSystem?.openMicrophonePrivacySettings?.();
  }, []);

  useEffect(() => {
    if (voiceState.connected) {
      setIsUnlocked(true);
      setPasscodeError(false);
    }
  }, [voiceState.connected]);

  const sessionActive =
    voiceState.connecting ||
    voiceState.connected ||
    taskRunners.length > 0 ||
    (summary.activeTasks?.length ?? 0) > 0 ||
    Boolean(deferredUiState.brainSessionId);

  return (
    <>
      <main className="h-screen w-full overflow-hidden bg-[#f8f9fa] p-2 text-gray-800">
        <div className="grid h-full grid-cols-[minmax(0,1.65fr)_minmax(360px,0.95fr)] gap-4">
          <section className="relative overflow-hidden rounded-[40px] border border-white/80 bg-white/60 shadow-[0_20px_80px_-40px_rgba(15,23,42,0.08)] backdrop-blur-2xl">
            <Suspense fallback={null}>
              <LiveScene
                audioEnergy={audioEnergy}
                avatarState={avatarState}
                inputEnergy={inputEnergy}
                mouthOpen={mouthOpen}
                prefersReducedMotion={prefersReducedMotion}
              />
            </Suspense>

            <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between px-6 py-4">
              <div className="pointer-events-auto flex items-center gap-4">
                <div className="flex items-center gap-3.5">
                  <img
                    src={relayLogoUrl}
                    alt="Relay logo"
                    className="h-10 w-10 object-contain rounded-2xl border border-white/80 bg-white/85 p-1.5 shadow-[0_12px_30px_-18px_rgba(37,99,235,0.65)] backdrop-blur-xl"
                  />
                  <div>
                    <h1 className="m-0 text-[18px] font-bold tracking-tight text-gray-800">
                      Relay
                    </h1>
                    <p className="mt-1 text-[11px] font-medium tracking-[0.08em] text-gray-500 uppercase">
                      {runtimeMetaText(deferredUiState, voiceState)}
                    </p>
                  </div>
                </div>
                
                <div className="h-8 w-px bg-gray-200/60" />

                <div className="flex items-center gap-2.5">
                  {!voiceState.connected ? (
                    <>
                      <div className="flex h-9 items-center rounded-full border border-gray-200/80 bg-white/80 px-4 text-[12px] font-medium text-gray-700 shadow-sm backdrop-blur-md">
                        Mic · {selectedMicrophoneLabel}
                      </div>
                      <button
                        onClick={handleConnect}
                        disabled={voiceState.connecting}
                        className="flex h-9 items-center gap-1.5 rounded-full bg-blue-600 px-4 text-[12px] font-semibold text-white shadow-sm transition-all duration-200 hover:bg-blue-500 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {voiceState.connecting ? "Connecting…" : "Start Session"}
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={handleMuteToggle}
                        className={`group flex h-9 whitespace-nowrap items-center justify-center gap-1.5 rounded-full px-4 text-[12px] font-semibold transition-all duration-200 border shadow-sm ${
                          voiceState.muted
                            ? "bg-red-50 text-red-600 border-red-200/80 hover:bg-red-100"
                            : "bg-white/90 text-gray-700 border-gray-200/80 hover:bg-white"
                        }`}
                      >
                        {voiceState.muted ? (
                           <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="2" y1="2" x2="22" y2="22"/><path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2"/><path d="M5 10v2a7 7 0 0 0 12 5l-1.5-1.5a5 5 0 0 1-9-3.5v-2"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12l-1.5-1.5A1 1 0 0 1 11 12V9"/><path d="M12 2a3 3 0 0 0-3 3v2l6 6V5a3 3 0 0 0-3-3z"/></svg>
                        ) : (
                           <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-blue-500 group-hover:scale-110 transition-transform"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>
                        )}
                        {voiceState.muted ? "Muted" : "Mic On"}
                      </button>
                      <button
                        onClick={handleHangup}
                        className="group flex h-9 whitespace-nowrap items-center gap-1.5 rounded-full bg-red-500 px-4 text-[12px] font-semibold text-white shadow-sm transition-all duration-200 hover:bg-red-400 hover:shadow-md"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="transition-transform group-hover:scale-110"><path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67m-2.67-3.34a19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91"/><line x1="22" y1="2" x2="2" y2="22"/></svg>
                        End Session
                      </button>
                    </>
                  )}
                </div>
              </div>
              <div className="pointer-events-auto flex items-center gap-3">
                <button
                  onClick={() => setChatOpen(true)}
                  title="Open Live Transcript"
                  className="flex h-[40px] w-[40px] items-center justify-center rounded-full border border-white/40 bg-white/40 text-gray-600 backdrop-blur-3xl transition-all duration-200 hover:bg-white/70 hover:text-gray-900 shadow-[0_8px_24px_rgba(0,0,0,0.06)]"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 21 1.9-5.7a8.5 8.5 0 1 1 3.8 3.8z"/></svg>
                </button>
                <button
                  onClick={() => setHistoryOpen(true)}
                  aria-label="Recent Sessions"
                  className="flex h-[40px] w-[40px] items-center justify-center rounded-full border border-white/40 bg-white/40 text-gray-600 backdrop-blur-3xl transition-all duration-200 hover:bg-white/70 hover:text-gray-900 shadow-[0_8px_24px_rgba(0,0,0,0.06)]"
                >
                  <HistoryIcon />
                </button>
                <button
                  onClick={() => setSettingsOpen(true)}
                  aria-label="Settings"
                  className="flex h-[40px] w-[40px] items-center justify-center rounded-full border border-white/40 bg-white/40 text-gray-600 backdrop-blur-3xl transition-all duration-200 hover:bg-white/70 hover:text-gray-900 shadow-[0_8px_24px_rgba(0,0,0,0.06)]"
                >
                  <SettingsIcon />
                </button>
              </div>
            </header>

            {resolvedRuntimeError &&
              (runtimeIssue ? (
                <div className="absolute left-1/2 top-28 z-50 w-[min(92vw,680px)] -translate-x-1/2 rounded-[26px] border border-red-200 bg-red-50/95 px-5 py-4 text-red-700 shadow-[0_20px_60px_-20px_rgba(220,38,38,0.28)] backdrop-blur-xl">
                  <div className="text-[13px] font-semibold tracking-wide text-red-800">
                    {runtimeIssue.title}
                  </div>
                  <p className="mt-1 text-[13px] leading-relaxed text-red-700">
                    {resolvedRuntimeError}
                  </p>
                  <p className="mt-2 text-[12px] leading-relaxed text-red-600">
                    {runtimeIssue.guidance}
                  </p>
                  {runtimeIssue.kind === "permission" &&
                  window.desktopSystem?.platform === "darwin" ? (
                    <div className="mt-3 flex justify-end">
                      <button
                        type="button"
                        onClick={() => void window.desktopSystem.openMacPrivacySettings()}
                        className="rounded-full border border-red-300 bg-white/80 px-4 py-2 text-[12px] font-semibold text-red-700 transition-colors hover:bg-white"
                      >
                        Open Privacy Settings
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="absolute left-1/2 top-28 z-50 -translate-x-1/2 rounded-full border border-red-200 bg-red-50/90 px-6 py-2.5 text-[13px] font-medium text-red-600 shadow-lg backdrop-blur-xl">
                  {resolvedRuntimeError}
                </div>
              ))}

            {isUnlocked &&
            settings.ui.showHeaderHealthWarnings &&
            !resolvedRuntimeError &&
            showExecutorHealthBanner ? (
              <div className="absolute left-1/2 top-28 z-40 w-[min(92vw,680px)] -translate-x-1/2">
                <ExecutorHealthBanner
                  model={executorHealthBanner}
                  onRetry={handleRetryExecutorHealthCheck}
                  onOpenPrivacySettings={handleOpenExecutorPrivacySettings}
                  onDismiss={() => setDismissedExecutorHealthKey(executorHealthBannerKey)}
                />
              </div>
            ) : null}

            <LiveSpeechHud
              sessionActive={sessionActive}
              voiceState={voiceState}
              inputPartial={deferredUiState.rawInputPartial || deferredUiState.inputPartial}
              outputTranscript={deferredUiState.outputTranscript}
            />

            {chatOpen ? (
              <Suspense fallback={null}>
                <ConversationOverlay
                  open={chatOpen}
                  onClose={() => setChatOpen(false)}
                  timeline={displayConversationTimeline}
                  turnsById={turnsById}
                  prompt={prompt}
                  onPromptChange={setPrompt}
                  onSubmit={handlePromptSubmit}
                  onCompositionStart={() => setPromptComposing(true)}
                  onCompositionEnd={() => setPromptComposing(false)}
                  onPromptKeyDown={handlePromptKeyDown}
                />
              </Suspense>
            ) : null}
          </section>

          <AgentActivityPanel
            taskRunners={taskRunners}
            archivedEntries={archivedEntries}
            selectedTaskId={selectedTaskId}
            selectionDismissed={taskSelectionDismissed}
            onSelectTask={handleSelectTask}
            onCancelTask={handleCancelTask}
            taskCancelUiState={taskCancelUiState}
            summary={summary}
            debugEvents={filteredDebugEvents}
            voiceConnected={voiceState.connected}
            pendingBriefingCount={summary.pendingBriefingCount ?? 0}
          />
        </div>
      </main>

      {historyOpen ? (
        <Suspense fallback={null}>
          <HistoryModal
            open={historyOpen}
            entries={historyEntries}
            loading={historySummary.loading}
            error={historySummary.error}
            onClose={() => setHistoryOpen(false)}
            onRefresh={handleRefreshHistory}
          />
        </Suspense>
      ) : null}
      {settingsOpen ? (
        <Suspense fallback={null}>
          <SettingsModal
            open={settingsOpen}
            onClose={() => setSettingsOpen(false)}
            settings={settings}
            systemStatus={systemStatus}
            microphones={microphones}
            selectedMicId={selectedMicId}
            selectedMicrophoneLabel={selectedMicrophoneLabel}
            setupStatus={setupStatus}
            setupStatusLoading={setupStatusLoading}
            executionMode={deferredUiState.executionMode}
            executorHealth={executorHealth}
            historyLoading={historySummary.loading}
            onSelectMicrophone={handleSelectMicrophone}
            onRefreshMicrophones={handleRefreshMicrophones}
            onRefreshSetupStatus={refreshSetupStatus}
            onRequestMicrophoneAccess={handleRequestMicrophoneAccess}
            onMicrophoneEnabledChange={handleVoiceCaptureEnabledChange}
            onStartMutedChange={handleStartMutedChange}
            onExecutorEnabledChange={handleExecutorEnabledChange}
            onRetryExecutorHealthCheck={handleRetryExecutorHealthCheck}
            onMotionPreferenceChange={handleMotionPreferenceChange}
            onHeaderHealthWarningsChange={handleHeaderHealthWarningsChange}
            onCopyText={handleCopyText}
            onOpenGeminiLoginTerminal={handleOpenGeminiLoginTerminal}
            onOpenDeveloperConsole={handleOpenDeveloperConsole}
            onOpenSupportTarget={handleOpenSupportTarget}
            debugFilters={debugFilters}
            onToggleDebugFilter={handleToggleDebugFilter}
            onCopyDiagnostics={handleCopyDiagnostics}
            onRefreshHistory={handleRefreshHistory}
            onResetSettings={handleResetSettings}
          />
        </Suspense>
      ) : null}
      {debugOpen ? (
        <Suspense fallback={null}>
          <DebugConsole
            open={debugOpen}
            filters={debugFilters}
            onToggleFilter={handleToggleDebugFilter}
            turnFilter={debugTurnFilter}
            onTurnFilterChange={setDebugTurnFilter}
            taskFilter={debugTaskFilter}
            onTaskFilterChange={setDebugTaskFilter}
            events={filteredDebugEvents}
          />
        </Suspense>
      ) : null}

      {!isUnlocked && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-transparent backdrop-blur-[4px] transition-all duration-500">
          <div className="flex w-full max-w-[340px] flex-col items-center gap-6 rounded-[32px] border border-gray-300/40 bg-white/60 p-10 shadow-[0_30px_100px_-20px_rgba(15,23,42,0.15)] ring-1 ring-inset ring-white/80 backdrop-blur-3xl">
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="flex h-[64px] w-[64px] items-center justify-center rounded-[22px] border border-white/80 bg-white/85 p-2 shadow-[0_18px_40px_-18px_rgba(37,99,235,0.45)] backdrop-blur-xl">
                <img src={relayLogoUrl} alt="Relay logo" className="h-full w-full object-contain" />
              </div>
              <h2 className="mt-1 text-xl font-bold tracking-tight text-gray-800">Passcode</h2>
              <p className="text-[13px] leading-relaxed text-gray-500">
                Enter the judge passcode to open Relay, the hosted voice agent for the Google ecosystem.
              </p>
            </div>
            
            <form
              className="w-full space-y-4"
              onSubmit={async (event) => {
                event.preventDefault();
                setPasscodeError(false);
                const connected = await handleConnect();
                if (!connected) {
                  setPasscodeError(true);
                  return;
                }

                setIsUnlocked(true);
              }}
            >
              {showExecutorHealthBanner ? (
                <ExecutorHealthBanner
                  model={executorHealthBanner}
                  onRetry={handleRetryExecutorHealthCheck}
                  onOpenPrivacySettings={handleOpenExecutorPrivacySettings}
                  onDismiss={() => setDismissedExecutorHealthKey(executorHealthBannerKey)}
                />
              ) : null}
              <div className="relative flex w-full items-center">
                <input
                  type={showPasscode ? "text" : "password"}
                  placeholder="Enter judge passcode"
                  value={passcode}
                  onChange={(event) => {
                    setPasscode(event.target.value);
                    if (passcodeError) setPasscodeError(false);
                  }}
                  className={`w-full rounded-2xl border bg-white/70 px-5 py-3.5 pr-12 text-[14px] font-medium tracking-wide text-gray-900 outline-none shadow-inner backdrop-blur-sm transition-all placeholder:text-gray-400 focus:bg-white focus:ring-4 ${
                    passcodeError
                      ? "border-red-400/80 focus:border-red-500/80 focus:ring-red-100/70 animate-[shake_0.5s_ease-in-out]"
                      : "border-gray-300/80 hover:border-gray-400/80 focus:border-blue-500/80 focus:ring-blue-100/60"
                  }`}
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setShowPasscode(!showPasscode)}
                  className="absolute right-3 flex h-8 w-8 items-center justify-center rounded-xl text-gray-400 transition-colors hover:bg-black/5 hover:text-gray-600"
                >
                  {showPasscode ? (
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/></svg>
                  )}
                </button>
              </div>
              <button
                type="submit"
                disabled={!passcode.trim() || voiceState.connecting}
                className={`w-full rounded-2xl border-none px-6 py-3.5 text-[14px] font-semibold text-white transition-all disabled:pointer-events-none disabled:opacity-40 ${
                  passcodeError
                    ? "bg-red-500 shadow-lg shadow-red-500/25 transition-colors"
                    : "bg-gradient-to-br from-indigo-500 to-blue-600 shadow-lg shadow-blue-500/25 hover:scale-[1.02] hover:shadow-xl hover:shadow-blue-500/30 active:scale-[0.98]"
                }`}
              >
                {voiceState.connecting
                  ? "Connecting…"
                  : passcodeError
                    ? "Retry Judge Passcode"
                    : "Start Session"}
              </button>
              {passcodeError ? (
                <p className="text-center text-[12px] font-medium text-red-500">
                  {runtimeError ?? "Unable to connect with that judge passcode."}
                </p>
              ) : null}
            </form>
          </div>
        </div>
      )}
    </>
  );
}
