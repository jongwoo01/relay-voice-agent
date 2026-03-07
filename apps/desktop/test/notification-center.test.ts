import { describe, expect, it } from "vitest";
import {
  createInitialInteractionActivityState,
  createInitialNotificationCenterState,
  enqueueNotificationPlan,
  flushPendingNotificationPlans,
  setInteractionSpeaking
} from "../src/shared/notification-center.js";

describe("notification-center", () => {
  it("starts idle with empty queues", () => {
    expect(createInitialInteractionActivityState()).toEqual({
      userSpeaking: false,
      assistantSpeaking: false
    });
    expect(createInitialNotificationCenterState()).toEqual({
      delivered: [],
      pending: []
    });
  });

  it("enqueues immediate plans as delivered", () => {
    const center = enqueueNotificationPlan(
      createInitialNotificationCenterState(),
      {
        uiText: "done",
        speechText: "done",
        delivery: "immediate"
      }
    );

    expect(center.delivered).toHaveLength(1);
    expect(center.pending).toHaveLength(0);
  });

  it("keeps next_turn plans pending until speech stops", () => {
    const pendingCenter = enqueueNotificationPlan(
      createInitialNotificationCenterState(),
      {
        uiText: "done",
        speechText: "done",
        delivery: "next_turn"
      }
    );

    expect(
      flushPendingNotificationPlans(pendingCenter, {
        userSpeaking: true,
        assistantSpeaking: false
      })
    ).toEqual(pendingCenter);

    expect(
      flushPendingNotificationPlans(pendingCenter, {
        userSpeaking: false,
        assistantSpeaking: false
      })
    ).toEqual({
      delivered: [
        {
          uiText: "done",
          speechText: "done",
          delivery: "next_turn"
        }
      ],
      pending: []
    });
  });

  it("updates speaking flags independently", () => {
    const userSpeaking = setInteractionSpeaking(
      createInitialInteractionActivityState(),
      "user",
      true
    );
    const assistantSpeaking = setInteractionSpeaking(
      userSpeaking,
      "assistant",
      true
    );

    expect(userSpeaking).toEqual({
      userSpeaking: true,
      assistantSpeaking: false
    });
    expect(assistantSpeaking).toEqual({
      userSpeaking: true,
      assistantSpeaking: true
    });
  });
});
