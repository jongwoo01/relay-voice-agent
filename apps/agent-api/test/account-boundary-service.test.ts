import { describe, expect, it } from "vitest";
import {
  AccountBoundaryService,
  EnvelopeEncryptionService,
  InMemoryKeyWrappingService,
  InMemoryUserApiCredentialRepository,
  InMemoryUserAuthModeRepository,
  InMemoryUserIdentityRepository,
  InMemoryUserRepository
} from "../src/index.js";

describe("account-boundary-service", () => {
  it("creates or links a user from google identity and sets oauth mode", async () => {
    const service = new AccountBoundaryService(
      new InMemoryUserRepository(),
      new InMemoryUserIdentityRepository(),
      new InMemoryUserAuthModeRepository(),
      new InMemoryUserApiCredentialRepository(),
      new EnvelopeEncryptionService(new InMemoryKeyWrappingService())
    );

    const result = await service.findOrCreateUserFromGoogleIdentity({
      identity: {
        providerUserId: "google-sub-1",
        email: "user@example.com",
        emailVerified: true,
        displayName: "User"
      },
      now: "2026-03-08T00:00:00.000Z"
    });

    expect(result.user.email).toBe("user@example.com");
    expect(result.authMode).toBe("google_oauth");
  });

  it("stores the user's gemini api key encrypted and can decrypt it later", async () => {
    const users = new InMemoryUserRepository();
    const identities = new InMemoryUserIdentityRepository();
    const authModes = new InMemoryUserAuthModeRepository();
    const credentials = new InMemoryUserApiCredentialRepository();
    const service = new AccountBoundaryService(
      users,
      identities,
      authModes,
      credentials,
      new EnvelopeEncryptionService(new InMemoryKeyWrappingService())
    );

    const account = await service.findOrCreateUserFromGoogleIdentity({
      identity: {
        providerUserId: "google-sub-1",
        email: "user@example.com",
        emailVerified: true
      },
      now: "2026-03-08T00:00:00.000Z"
    });

    await service.saveGeminiApiKey({
      userId: account.user.id,
      apiKey: "AIza-user-secret",
      keyLabel: "primary",
      now: "2026-03-08T00:01:00.000Z"
    });

    const stored = await credentials.getActiveByUserId(
      account.user.id,
      "gemini_developer_api"
    );
    expect(stored).not.toBeNull();
    expect(JSON.stringify(stored)).not.toContain("AIza-user-secret");

    const apiKey = await service.getGeminiApiKey(account.user.id);
    expect(apiKey).toBe("AIza-user-secret");

    const authMode = await authModes.getByUserId(account.user.id);
    expect(authMode?.primaryMode).toBe("gemini_api_key");
  });
});
