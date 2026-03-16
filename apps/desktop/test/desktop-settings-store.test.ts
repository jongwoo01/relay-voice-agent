import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DesktopSettingsStore } from "../src/main/ui/desktop-settings-store.js";

describe("desktop-settings-store", () => {
  it("persists settings updates and reloads them from disk", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "relay-settings-"));
    const store = new DesktopSettingsStore({ directory });

    await store.load();
    const nextSettings = await store.update({
      audio: {
        defaultMicId: "mic-2",
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
          startMuted: true,
          liveVad: expect.objectContaining({
            confirmMs: 90,
            noiseGateMultiplier: 3.1,
            prerollChunks: 12,
            transientRmsRatio: 0.42
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
    expect(saved.audio.defaultMicId).toBe("");
    expect(resetSettings.audio.liveVad.confirmMs).toBe(180);
    expect(resetSettings.audio.liveVad.minSpeechThreshold).toBe(0.045);
    expect(resetSettings.executor.enabled).toBe(true);
  });
});
