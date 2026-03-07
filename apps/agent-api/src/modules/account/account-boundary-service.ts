import { randomUUID } from "node:crypto";
import type { SecretEncryptionService } from "../security/secret-encryption.js";
import type {
  UserApiCredentialRecord,
  UserApiCredentialRepository
} from "../persistence/user-api-credential-repository.js";
import type {
  UserAuthMode,
  UserAuthModeRepository
} from "../persistence/user-auth-mode-repository.js";
import type {
  UserIdentityRecord,
  UserIdentityRepository
} from "../persistence/user-identity-repository.js";
import type { UserRecord, UserRepository } from "../persistence/user-repository.js";

export interface GoogleIdentityInput {
  providerUserId: string;
  email: string;
  emailVerified: boolean;
  displayName?: string;
}

export interface AccountBoundaryResult {
  user: UserRecord;
  authMode: UserAuthMode;
}

export class AccountBoundaryService {
  constructor(
    private readonly users: UserRepository,
    private readonly identities: UserIdentityRepository,
    private readonly authModes: UserAuthModeRepository,
    private readonly apiCredentials: UserApiCredentialRepository,
    private readonly encryption: SecretEncryptionService
  ) {}

  async findOrCreateUserFromGoogleIdentity(input: {
    identity: GoogleIdentityInput;
    now: string;
  }): Promise<AccountBoundaryResult> {
    const existingIdentity = await this.identities.getByProviderIdentity(
      "google",
      input.identity.providerUserId
    );

    let user: UserRecord | null = null;

    if (existingIdentity) {
      user = await this.users.getById(existingIdentity.userId);
    }

    if (!user) {
      user = await this.users.getByEmail(input.identity.email);
    }

    if (!user) {
      user = {
        id: randomUUID(),
        email: input.identity.email,
        displayName: input.identity.displayName,
        createdAt: input.now,
        updatedAt: input.now
      };
      await this.users.create(user);
    }

    const identityRecord: UserIdentityRecord = {
      userId: user.id,
      provider: "google",
      providerUserId: input.identity.providerUserId,
      email: input.identity.email,
      emailVerified: input.identity.emailVerified,
      createdAt: existingIdentity?.createdAt ?? input.now,
      updatedAt: input.now
    };
    await this.identities.save(identityRecord);

    const authMode = await this.setPrimaryAuthMode({
      userId: user.id,
      mode: "google_oauth",
      now: input.now
    });

    return { user, authMode };
  }

  async saveGeminiApiKey(input: {
    userId: string;
    apiKey: string;
    keyLabel?: string;
    now: string;
  }): Promise<void> {
    const encryptedPayload = await this.encryption.encryptPlaintext(input.apiKey, {
      userId: input.userId,
      purpose: "gemini_api_key"
    });

    const record: UserApiCredentialRecord = {
      userId: input.userId,
      provider: "gemini_developer_api",
      encryptedPayload,
      keyLabel: input.keyLabel,
      isActive: true,
      createdAt: input.now,
      updatedAt: input.now
    };

    await this.apiCredentials.save(record);
    await this.setPrimaryAuthMode({
      userId: input.userId,
      mode: "gemini_api_key",
      now: input.now
    });
  }

  async getGeminiApiKey(userId: string): Promise<string | null> {
    const credential = await this.apiCredentials.getActiveByUserId(
      userId,
      "gemini_developer_api"
    );

    if (!credential) {
      return null;
    }

    return this.encryption.decryptToPlaintext(credential.encryptedPayload, {
      userId,
      purpose: "gemini_api_key"
    });
  }

  async setPrimaryAuthMode(input: {
    userId: string;
    mode: UserAuthMode;
    now: string;
  }): Promise<UserAuthMode> {
    const current = await this.authModes.getByUserId(input.userId);
    await this.authModes.save({
      userId: input.userId,
      primaryMode: input.mode,
      createdAt: current?.createdAt ?? input.now,
      updatedAt: input.now
    });
    return input.mode;
  }
}
