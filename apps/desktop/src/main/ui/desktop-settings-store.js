import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createDefaultDesktopSettings,
  mergeDesktopSettings,
  normalizeDesktopSettings
} from "./desktop-settings.js";

export class DesktopSettingsStore {
  constructor(options = {}) {
    this.filePath =
      options.filePath ?? path.join(options.directory ?? process.cwd(), "desktop-settings.json");
    this.settings = createDefaultDesktopSettings();
  }

  async load() {
    try {
      const content = await readFile(this.filePath, "utf8");
      this.settings = normalizeDesktopSettings(JSON.parse(content));
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        this.settings = createDefaultDesktopSettings();
        return this.get();
      }

      throw error;
    }

    return this.get();
  }

  async update(patch) {
    this.settings = mergeDesktopSettings(this.settings, patch);
    await this.save();
    return this.get();
  }

  async reset() {
    this.settings = createDefaultDesktopSettings();
    await this.save();
    return this.get();
  }

  get() {
    return structuredClone(this.settings);
  }

  async save() {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(this.settings, null, 2));
  }
}
