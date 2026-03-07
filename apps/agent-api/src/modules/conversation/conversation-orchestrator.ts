import { decideNextAction } from "@agent/brain-domain";
import type { FinalizedUtterance, NextAction, Task } from "@agent/shared-types";

export class ConversationOrchestrator {
  decide(utterance: FinalizedUtterance, activeTasks: Task[]): NextAction {
    return decideNextAction(utterance, activeTasks);
  }
}
