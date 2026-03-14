import { describe, expect, it } from "vitest";
import {
  InMemoryProfileMemoryStore,
  ProfileMemoryService
} from "../src/modules/memory/profile-memory-service.js";

describe("profile-memory-service", () => {
  it("stores a preferred name from a Korean self-introduction", async () => {
    const service = new ProfileMemoryService(new InMemoryProfileMemoryStore());

    const result = await service.rememberFromUtterance({
      brainSessionId: "brain-1",
      text: "내 이름은 종우야",
      now: "2026-03-14T00:00:00.000Z"
    });

    expect(result).toEqual({
      updated: true,
      preferredName: "종우"
    });
    await expect(service.buildRuntimeContext("brain-1")).resolves.toContain(
      "Preferred name: 종우"
    );
  });

  it("does not rewrite memory when the preferred name is unchanged within the same session", async () => {
    const service = new ProfileMemoryService(new InMemoryProfileMemoryStore());

    await service.rememberFromUtterance({
      brainSessionId: "brain-1",
      text: "my name is jongwoo",
      now: "2026-03-14T00:00:00.000Z"
    });

    const result = await service.rememberFromUtterance({
      brainSessionId: "brain-1",
      text: "제 이름은 jongwoo 입니다",
      now: "2026-03-14T00:01:00.000Z"
    });

    expect(result).toEqual({
      updated: false,
      preferredName: "jongwoo"
    });
  });

  it("starts fresh for a new session even when the same user would reconnect later", async () => {
    const service = new ProfileMemoryService(new InMemoryProfileMemoryStore());

    await service.rememberFromUtterance({
      brainSessionId: "brain-1",
      text: "내 이름은 종우야",
      now: "2026-03-14T00:00:00.000Z"
    });

    await expect(service.buildRuntimeContext("brain-2")).resolves.toBe("");
  });
});
