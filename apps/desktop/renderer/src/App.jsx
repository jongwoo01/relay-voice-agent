import { lazy, Suspense, useEffect, useState } from "react";
import { AgentActivityPanel } from "./components/activity/AgentActivityPanel.jsx";
import { HistoryIcon } from "./components/icons.jsx";
import { LiveSpeechHud } from "./components/overlays/LiveSpeechHud.jsx";
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
const DebugConsole = lazy(() =>
  import("./components/overlays/DebugConsole.jsx").then((module) => ({
    default: module.DebugConsole
  }))
);

function runtimeMetaText(uiState, voiceState) {
  if (uiState.runtimeError) {
    return "Connection needs attention";
  }

  if (voiceState.connecting) {
    return "Connecting to Gemini…";
  }

  if (voiceState.connected) {
    return uiState.brainSessionId
      ? `Session ${uiState.brainSessionId.slice(0, 8)} is live`
      : "Live session is ready";
  }

  return "Connect to start a live desktop session";
}

export default function App() {
  const {
    archivedEntries,
    audioEnergy,
    avatarState,
    chatOpen,
    completedDrawerAutoOpenTick,
    debugFilters,
    debugOpen,
    debugTaskFilter,
    debugTurnFilter,
    displayConversationTimeline,
    deferredUiState,
    filteredDebugEvents,
    handleConnect,
    handleHangup,
    handleMicToggle,
    handleMuteToggle,
    handlePromptKeyDown,
    handlePromptSubmit,
    handleRefreshHistory,
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
    selectedTaskId,
    setChatOpen,
    setDebugFilters,
    setDebugOpen,
    setDebugTaskFilter,
    setDebugTurnFilter,
    setHistoryOpen,
    setPasscode,
    setPrompt,
    setPromptComposing,
    setSelectedMicId,
    setSelectedTaskId,
    summary,
    taskRunners,
    turnsById,
    voiceState
  } = useDesktopAppController();

  const [isUnlocked, setIsUnlocked] = useState(false);
  const [showPasscode, setShowPasscode] = useState(false);
  const [passcodeError, setPasscodeError] = useState(false);

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
      <main className="h-screen overflow-hidden bg-[#f8f9fa] p-4 text-gray-800">
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

            <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between px-8 py-8">
              <div className="pointer-events-auto flex items-center gap-6">
                <div>
                  <h1 className="m-0 text-[18px] font-bold tracking-tight text-gray-800">
                    Gemini Live
                  </h1>
                  <p className="mt-1 text-[11px] font-medium tracking-[0.08em] text-gray-500 uppercase">
                    {runtimeMetaText(deferredUiState, voiceState)}
                  </p>
                </div>
                
                <div className="h-10 w-px bg-gray-200/60" />
                
                <div className="flex items-center gap-2.5">
                  {!voiceState.connected ? (
                    <>
                      <div className="relative flex items-center">
                        <select
                          value={selectedMicId}
                          onChange={(event) => setSelectedMicId(event.target.value)}
                          className="appearance-none w-[140px] truncate rounded-full border border-gray-200/80 bg-white/80 py-2 pl-4 pr-8 text-[12px] font-medium text-gray-700 outline-none backdrop-blur-md transition-all hover:bg-white focus:bg-white focus:ring-2 focus:ring-blue-100/50 shadow-sm"
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
                        <div className="pointer-events-none absolute right-3 flex items-center text-gray-400">
                          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                        </div>
                      </div>
                      <button
                        onClick={handleConnect}
                        disabled={voiceState.connecting}
                        className="flex items-center gap-1.5 rounded-full bg-blue-600 px-5 py-2 text-[12px] font-semibold text-white shadow-sm transition-all duration-200 hover:bg-blue-500 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {voiceState.connecting ? "Connecting…" : "Start Session"}
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={handleMuteToggle}
                        className={`group flex items-center justify-center gap-1.5 rounded-full px-5 py-2 text-[12px] font-semibold transition-all duration-200 border shadow-sm ${
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
                        className="group flex items-center gap-1.5 rounded-full bg-red-500 px-5 py-2 text-[12px] font-semibold text-white shadow-sm transition-all duration-200 hover:bg-red-400 hover:shadow-md"
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
                  className="flex h-[46px] w-[46px] items-center justify-center rounded-full border border-white/40 bg-white/40 text-gray-600 backdrop-blur-3xl transition-all duration-200 hover:bg-white/70 hover:text-gray-900 shadow-[0_8px_24px_rgba(0,0,0,0.06)]"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 21 1.9-5.7a8.5 8.5 0 1 1 3.8 3.8z"/></svg>
                </button>
                <button
                  onClick={() => setHistoryOpen(true)}
                  aria-label="Recent Sessions"
                  className="flex h-[46px] w-[46px] items-center justify-center rounded-full border border-white/40 bg-white/40 text-gray-600 backdrop-blur-3xl transition-all duration-200 hover:bg-white/70 hover:text-gray-900 shadow-[0_8px_24px_rgba(0,0,0,0.06)]"
                >
                  <HistoryIcon />
                </button>
              </div>
            </header>

            {(runtimeError || deferredUiState.runtimeError) && (
              <div className="absolute left-1/2 top-28 z-50 -translate-x-1/2 rounded-full border border-red-200 bg-red-50/90 px-6 py-2.5 text-[13px] font-medium text-red-600 shadow-lg backdrop-blur-xl">
                {runtimeError ?? deferredUiState.runtimeError}
              </div>
            )}

            <LiveSpeechHud
              sessionActive={sessionActive}
              voiceState={voiceState}
              inputPartial={deferredUiState.inputPartial}
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
            completedDrawerAutoOpenTick={completedDrawerAutoOpenTick}
            selectedTaskId={selectedTaskId}
            onSelectTask={setSelectedTaskId}
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
      {debugOpen ? (
        <Suspense fallback={null}>
          <DebugConsole
            open={debugOpen}
            filters={debugFilters}
            onToggleFilter={(source) =>
              setDebugFilters((current) => ({ ...current, [source]: !current[source] }))
            }
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
              <div className="flex h-[52px] w-[52px] items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-[0_8px_24px_-6px_rgba(79,70,229,0.3)]">
                 <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              </div>
              <h2 className="mt-1 text-xl font-bold tracking-tight text-gray-800">Passcode</h2>
              <p className="text-[13px] leading-relaxed text-gray-500">
                Enter the judge passcode to open the hosted Gemini live session.
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
