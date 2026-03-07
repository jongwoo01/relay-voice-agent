import type { ConversationMessage } from "@agent/shared-types";

export interface ConversationMessageRepository {
  listByBrainSessionId(brainSessionId: string): Promise<ConversationMessage[]>;
  save(message: ConversationMessage): Promise<void>;
}

export class InMemoryConversationMessageRepository
  implements ConversationMessageRepository
{
  private readonly messages = new Map<string, ConversationMessage[]>();

  async listByBrainSessionId(
    brainSessionId: string
  ): Promise<ConversationMessage[]> {
    return this.messages.get(brainSessionId) ?? [];
  }

  async save(message: ConversationMessage): Promise<void> {
    const current = this.messages.get(message.brainSessionId) ?? [];
    this.messages.set(message.brainSessionId, [...current, message]);
  }
}
