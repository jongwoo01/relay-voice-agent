import { describe, expect, it } from "vitest";
import {
  EnvelopeEncryptionService,
  InMemoryKeyWrappingService
} from "../src/index.js";

describe("secret encryption contract", () => {
  it("never stores plaintext in the encrypted payload", async () => {
    const service = new EnvelopeEncryptionService(
      new InMemoryKeyWrappingService()
    );

    const encrypted = await service.encryptPlaintext("secret-api-key-123", {
      userId: "user-1",
      purpose: "gemini_api_key"
    });

    expect(JSON.stringify(encrypted)).not.toContain("secret-api-key-123");
    expect(encrypted.ciphertext).not.toBe("secret-api-key-123");
    expect(encrypted.wrappedDek).toBeTruthy();
  });

  it("decrypts encrypted payload back to plaintext", async () => {
    const service = new EnvelopeEncryptionService(
      new InMemoryKeyWrappingService()
    );

    const encrypted = await service.encryptPlaintext("secret-api-key-123", {
      userId: "user-1",
      purpose: "gemini_api_key"
    });

    const plaintext = await service.decryptToPlaintext(encrypted, {
      userId: "user-1",
      purpose: "gemini_api_key"
    });

    expect(plaintext).toBe("secret-api-key-123");
  });

  it("fails to decrypt if ciphertext is tampered with", async () => {
    const service = new EnvelopeEncryptionService(
      new InMemoryKeyWrappingService()
    );

    const encrypted = await service.encryptPlaintext("secret-api-key-123", {
      userId: "user-1",
      purpose: "gemini_api_key"
    });

    await expect(
      service.decryptToPlaintext(
        {
          ...encrypted,
          ciphertext: Buffer.from("tampered").toString("base64")
        },
        {
          userId: "user-1",
          purpose: "gemini_api_key"
        }
      )
    ).rejects.toThrow();
  });
});
