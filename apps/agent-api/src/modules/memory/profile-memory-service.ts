export interface ProfileMemoryStore {
  getPreferredName(brainSessionId: string): Promise<string | null>;
  upsertPreferredName(input: {
    brainSessionId: string;
    preferredName: string;
    now: string;
  }): Promise<void>;
}

export interface ProfileMemoryServiceLike {
  rememberFromUtterance(input: {
    brainSessionId: string;
    text: string;
    now: string;
  }): Promise<{ updated: boolean; preferredName?: string }>;
  buildRuntimeContext(brainSessionId: string): Promise<string>;
}

function sanitizeName(value: string): string {
  return value
    .trim()
    .replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, "")
    .replace(/[.!?,]+$/g, "")
    .trim();
}

function extractPreferredName(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  const patterns = [
    /(?:내|제)\s*이름은\s+(.+?)(?:이야|입니다|예요|에요|야)?$/i,
    /my name is\s+(.+)$/i,
    /call me\s+(.+)$/i
  ];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    const candidate = sanitizeName(match?.[1] ?? "");
    if (candidate.length >= 2 && candidate.length <= 40) {
      return candidate;
    }
  }

  return null;
}

export class InMemoryProfileMemoryStore implements ProfileMemoryStore {
  private readonly preferredNames = new Map<string, string>();

  async getPreferredName(brainSessionId: string): Promise<string | null> {
    return this.preferredNames.get(brainSessionId) ?? null;
  }

  async upsertPreferredName(input: {
    brainSessionId: string;
    preferredName: string;
    now: string;
  }): Promise<void> {
    this.preferredNames.set(input.brainSessionId, input.preferredName);
  }
}

export class ProfileMemoryService implements ProfileMemoryServiceLike {
  constructor(
    private readonly store: ProfileMemoryStore = new InMemoryProfileMemoryStore()
  ) {}

  async rememberFromUtterance(input: {
    brainSessionId: string;
    text: string;
    now: string;
  }): Promise<{ updated: boolean; preferredName?: string }> {
    const preferredName = extractPreferredName(input.text);
    if (!preferredName) {
      return { updated: false };
    }

    const existing = await this.store.getPreferredName(input.brainSessionId);
    if (existing === preferredName) {
      return {
        updated: false,
        preferredName
      };
    }

    await this.store.upsertPreferredName({
      brainSessionId: input.brainSessionId,
      preferredName,
      now: input.now
    });

    return {
      updated: true,
      preferredName
    };
  }

  async buildRuntimeContext(brainSessionId: string): Promise<string> {
    const preferredName = await this.store.getPreferredName(brainSessionId);
    if (!preferredName) {
      return "";
    }

    return [
      "Known user profile:",
      `- Preferred name: ${preferredName}`,
      "Use this only when helpful, and never invent additional profile details."
    ].join("\n");
  }
}

export function createProfileMemoryService(): ProfileMemoryService {
  return new ProfileMemoryService(new InMemoryProfileMemoryStore());
}
