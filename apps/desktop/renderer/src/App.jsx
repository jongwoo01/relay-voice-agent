import { AgentAvatar } from "./AgentAvatar.jsx";
import AvatarFieldLayer from "./AvatarFieldLayer.jsx";
import { AgentActivityPanel } from "./components/activity/AgentActivityPanel.jsx";
import { HistoryIcon } from "./components/icons.jsx";
import { ConversationOverlay } from "./components/overlays/ConversationOverlay.jsx";
import { DebugConsole } from "./components/overlays/DebugConsole.jsx";
import { HistoryModal } from "./components/overlays/HistoryModal.jsx";
import { LiveSpeechHud } from "./components/overlays/LiveSpeechHud.jsx";
import { useDesktopAppController } from "./hooks/useDesktopAppController.js";

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
          <section className="relative overflow-hidden rounded-[40px] border border-white/70 bg-[radial-gradient(circle_at_top,#ffffff_0%,#f7f9fc_42%,#eef3ff_100%)] shadow-[0_30px_120px_-50px_rgba(15,23,42,0.22)]">
            {sessionActive ? (
              <>
                <AvatarFieldLayer
                  state={avatarState}
                  speechEnergy={audioEnergy}
                  fieldIntensity={inputEnergy}
                  glowIntensity={audioEnergy}
                  reducedMotion={prefersReducedMotion}
                />

                <div className="pointer-events-none absolute inset-0 z-[1] flex items-center justify-center">
                  <AgentAvatar
                    state={avatarState}
                    inputEnergy={inputEnergy}
                    mouthOpen={mouthOpen}
                    speechEnergy={audioEnergy}
                    reducedMotion={prefersReducedMotion}
                  />
                </div>
              </>
            ) : (
              <div className="pointer-events-none absolute inset-0 z-[1] flex items-center justify-center">
                <div className="flex max-w-[420px] flex-col items-center gap-5 px-8 text-center">
                  <div className="h-32 w-32 rounded-full bg-[radial-gradient(circle_at_50%_35%,rgba(255,255,255,0.98),rgba(191,219,254,0.65)_38%,rgba(216,180,254,0.28)_68%,rgba(255,255,255,0)_100%)] shadow-[0_0_120px_rgba(125,155,255,0.2)]" />
                  <div className="space-y-2">
                    <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400">
                      Live Presence
                    </p>
                    <p className="m-0 text-[15px] leading-relaxed text-gray-500">
                      Start a session to bring Gemini on screen. The live avatar only appears during an active connection.
                    </p>
                  </div>
                </div>
              </div>
            )}

            <header className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between px-8 py-7">
              <div className="pointer-events-auto">
                <h1 className="m-0 bg-gradient-to-br from-blue-600 via-purple-500 to-rose-500 bg-clip-text text-[26px] font-semibold tracking-tight text-transparent">
                  Gemini Live
                </h1>
                <p className="mt-2 text-[12px] font-medium tracking-[0.08em] text-gray-500">
                  {runtimeMetaText(deferredUiState, voiceState)}
                </p>
              </div>
              <button
                onClick={() => setHistoryOpen(true)}
                aria-label="Recent Sessions"
                className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full border border-gray-200 bg-white/70 text-gray-500 backdrop-blur-lg transition-all duration-200 hover:bg-white hover:text-gray-800 hover:shadow-md"
              >
                <HistoryIcon />
              </button>
            </header>

            {(runtimeError || deferredUiState.runtimeError) && (
              <div className="absolute left-1/2 top-24 z-50 -translate-x-1/2 rounded-2xl border border-red-200 bg-red-50 px-5 py-3 text-[13px] font-medium text-red-600 shadow-lg backdrop-blur-xl">
                {runtimeError ?? deferredUiState.runtimeError}
              </div>
            )}

            <LiveSpeechHud
              sessionActive={sessionActive}
              voiceState={voiceState}
              inputPartial={deferredUiState.inputPartial}
              outputTranscript={deferredUiState.outputTranscript}
            />

            <div className="pointer-events-auto absolute bottom-10 left-1/2 z-20 -translate-x-1/2">
              <div className="flex items-center gap-2 rounded-full border border-gray-200/80 bg-white/72 p-2.5 shadow-[0_8px_32px_-8px_rgba(0,0,0,0.12)] backdrop-blur-2xl">
                {!voiceState.connected ? (
                  <form
                    className="contents"
                    onSubmit={(event) => {
                      event.preventDefault();
                      handleConnect();
                    }}
                  >
                    <input
                      type="password"
                      autoComplete="one-time-code"
                      placeholder="Enter Session Key"
                      value={passcode}
                      onChange={(event) => setPasscode(event.target.value)}
                      className="w-40 bg-transparent border-none outline-none text-gray-800 text-[13px] px-3 py-2 font-medium tracking-wide font-[inherit] placeholder:text-gray-400"
                    />
                    <div className="mx-1 h-6 w-px bg-gray-200" />
                    <select
                      value={selectedMicId}
                      onChange={(event) => setSelectedMicId(event.target.value)}
                      className="max-w-[220px] rounded-full border border-gray-200 bg-gray-50/90 px-4 py-2.5 text-[13px] text-gray-600 outline-none"
                    >
                      {microphones.length === 0 ? (
                        <option value="">Default microphone</option>
                      ) : (
                        microphones.map((microphone) => (
                          <option key={microphone.deviceId} value={microphone.deviceId}>
                            {microphone.label || "Audio input"}
                          </option>
                        ))
                      )}
                    </select>
                    <button
                      type="submit"
                      disabled={voiceState.connecting}
                      className="rounded-full border-none bg-gradient-to-br from-blue-500 to-purple-600 px-7 py-2.5 text-[13px] font-semibold text-white shadow-[0_4px_16px_rgba(79,70,229,0.3)] transition-all duration-200 hover:from-blue-400 hover:to-purple-500 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {voiceState.connecting ? "Connecting…" : "Start Session"}
                    </button>
                  </form>
                ) : (
                  <>
                    <button
                      onClick={handleMuteToggle}
                      className={`rounded-full px-7 py-2.5 text-[13px] font-semibold transition-all duration-200 ${
                        voiceState.muted
                          ? "bg-red-50 text-red-500 hover:bg-red-100"
                          : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                      }`}
                    >
                      {voiceState.muted ? "Unmute" : "Mute"}
                    </button>
                    <button
                      onClick={handleMicToggle}
                      className="rounded-full bg-gray-100 px-7 py-2.5 text-[13px] font-semibold text-gray-700 transition-all duration-200 hover:bg-gray-200"
                    >
                      {voiceState.mic?.enabled ? "Mic On" : "Mic Off"}
                    </button>
                    <div className="mx-1 h-6 w-px bg-gray-200" />
                    <button
                      onClick={handleHangup}
                      className="rounded-full bg-red-500 px-7 py-2.5 text-[13px] font-semibold text-white shadow-[0_4px_12px_rgba(239,68,68,0.25)] transition-all duration-200 hover:bg-red-400"
                    >
                      End
                    </button>
                  </>
                )}
              </div>
            </div>

            <button
              onClick={() => setChatOpen(true)}
              title="Open Live Transcript"
              className="absolute bottom-10 right-10 z-20 flex h-[54px] w-[54px] items-center justify-center rounded-full border border-gray-200 bg-white/68 text-gray-500 backdrop-blur-lg transition-all duration-200 hover:bg-white hover:text-gray-800 hover:shadow-md"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 21 1.9-5.7a8.5 8.5 0 1 1 3.8 3.8z"/></svg>
            </button>

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
          </section>

          <AgentActivityPanel
            taskRunners={taskRunners}
            archivedEntries={archivedEntries}
            selectedTaskId={selectedTaskId}
            onSelectTask={setSelectedTaskId}
            summary={summary}
            debugEvents={filteredDebugEvents}
            voiceConnected={voiceState.connected}
            pendingBriefingCount={summary.pendingBriefingCount ?? 0}
          />
        </div>
      </main>

      <HistoryModal
        open={historyOpen}
        entries={historyEntries}
        loading={historySummary.loading}
        error={historySummary.error}
        onClose={() => setHistoryOpen(false)}
        onRefresh={handleRefreshHistory}
      />
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
    </>
  );
}
