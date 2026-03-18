import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DesktopSettingsStore } from "../src/main/ui/desktop-settings-store.js";
import { createDefaultLiveVadSettings } from "../src/main/ui/desktop-settings.js";

describe("desktop-settings-store", () => {
  const defaultLiveVad = createDefaultLiveVadSettings();

  it("persists settings updates and reloads them from disk", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "relay-settings-"));
    const store = new DesktopSettingsStore({ directory });

    await store.load();
    const nextSettings = await store.update({
      audio: {
        defaultMicId: "mic-2",
        voiceCaptureEnabled: false,
        startMuted: true,
        liveVad: {
          confirmMs: 90,
          noiseGateMultiplier: 3.1
        }
      },
      executor: {
        enabled: false
      },
      ui: {
        motionPreference: "on",
        autoOpenCompletedTasks: false
      },
      debug: {
        defaultFilters: {
          executor: false
        }
      }
    });

    expect(nextSettings).toEqual(
      expect.objectContaining({
        audio: expect.objectContaining({
          defaultMicId: "mic-2",
          voiceCaptureEnabled: false,
          startMuted: true,
          liveVad: expect.objectContaining({
            confirmMs: 90,
            noiseGateMultiplier: 3.1,
            prerollChunks: defaultLiveVad.prerollChunks,
            transientRmsRatio: defaultLiveVad.transientRmsRatio
          })
        }),
        executor: expect.objectContaining({
          enabled: false
        }),
        ui: expect.objectContaining({
          motionPreference: "on",
          autoOpenCompletedTasks: false
        }),
        debug: expect.objectContaining({
          defaultFilters: expect.objectContaining({
            executor: false,
            transport: true
          })
        })
      })
    );

    const reloadedStore = new DesktopSettingsStore({ directory });
    await reloadedStore.load();
    expect(reloadedStore.get()).toEqual(nextSettings);
  });

  it("resets back to defaults", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "relay-settings-reset-"));
    const store = new DesktopSettingsStore({ directory });

    await store.load();
    await store.update({
      audio: {
        defaultMicId: "mic-3"
      }
    });
    const resetSettings = await store.reset();
    const saved = JSON.parse(
      await readFile(path.join(directory, "desktop-settings.json"), "utf8")
    );

    expect(resetSettings.audio.defaultMicId).toBe("");
    expect(resetSettings.audio.voiceCaptureEnabled).toBe(true);
    expect(saved.audio.defaultMicId).toBe("");
    expect(saved.audio.voiceCaptureEnabled).toBe(true);
    expect(resetSettings.audio.liveVad.confirmMs).toBe(defaultLiveVad.confirmMs);
    expect(resetSettings.audio.liveVad.minSpeechThreshold).toBe(
      defaultLiveVad.minSpeechThreshold
    );
    expect(resetSettings.executor.enabled).toBe(true);
  });

  it("migrates settings from a legacy file path when the new location is empty", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "relay-settings-current-"));
    const legacyDirectory = await mkdtemp(path.join(os.tmpdir(), "relay-settings-legacy-"));
    const legacyStore = new DesktopSettingsStore({ directory: legacyDirectory });

    await legacyStore.load();
    const legacySettings = await legacyStore.update({
      audio: {
        defaultMicId: "legacy-mic",
        voiceCaptureEnabled: false
      },
      ui: {
        motionPreference: "off"
      }
    });

    const migratedStore = new DesktopSettingsStore({
      directory,
      legacyFilePaths: [path.join(legacyDirectory, "desktop-settings.json")]
    });
    await migratedStore.load();

    expect(migratedStore.get()).toEqual(
      expect.objectContaining({
        ...legacySettings,
        audio: expect.objectContaining({
          ...legacySettings.audio,
          voiceCaptureEnabled: true
        })
      })
    );
    const saved = JSON.parse(
      await readFile(path.join(directory, "desktop-settings.json"), "utf8")
    );
    expect(saved.audio.voiceCaptureEnabled).toBe(true);
    expect(saved.audio.defaultMicId).toBe(legacySettings.audio.defaultMicId);
    expect(saved.ui.motionPreference).toBe(legacySettings.ui.motionPreference);
  });
});
