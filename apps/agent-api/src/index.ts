export { ConversationOrchestrator } from "./modules/conversation/conversation-orchestrator.js";
export {
  loadDotEnvFromRoot,
  parseDotEnv
} from "./modules/config/env-loader.js";
export { BrainTurnService, type BrainTurnResult } from "./modules/conversation/brain-turn-service.js";
export { AccountBoundaryService, type AccountBoundaryResult, type GoogleIdentityInput } from "./modules/account/account-boundary-service.js";
export {
  createDefaultIntentResolver,
  createGeminiIntentClient,
  DEFAULT_INTENT_MODEL,
  FallbackIntentResolver,
  GeminiIntentResolver,
  HeuristicIntentResolver,
  inferIntentFromText,
  type IntentModelClientLike,
  type IntentResolver
} from "./modules/conversation/intent-resolver.js";
export { GeminiCliExecutor, MockExecutor } from "./modules/executor/index.js";
export {
  InMemoryConversationMessageRepository,
  PostgresConversationMessageRepository,
  type ConversationMessageRepository
} from "./modules/persistence/conversation-message-repository.js";
export {
  InMemoryTaskRepository,
  PostgresTaskRepository,
  type TaskRepository
} from "./modules/persistence/task-repository.js";
export {
  InMemoryTaskEventRepository,
  PostgresTaskEventRepository,
  type TaskEventRepository
} from "./modules/persistence/task-event-repository.js";
export {
  InMemoryTaskExecutorSessionRepository,
  PostgresTaskExecutorSessionRepository,
  type TaskExecutorSessionRepository
} from "./modules/persistence/task-executor-session-repository.js";
export {
  PostgresBrainSessionRepository,
  type BrainSessionRecord,
  type BrainSessionRepository
} from "./modules/persistence/brain-session-repository.js";
export {
  InMemoryUserRepository,
  PostgresUserRepository,
  type UserRecord,
  type UserRepository
} from "./modules/persistence/user-repository.js";
export {
  InMemoryUserIdentityRepository,
  PostgresUserIdentityRepository,
  type UserIdentityRecord,
  type UserIdentityRepository
} from "./modules/persistence/user-identity-repository.js";
export {
  InMemoryUserAuthModeRepository,
  PostgresUserAuthModeRepository,
  type UserAuthMode,
  type UserAuthModeRecord,
  type UserAuthModeRepository
} from "./modules/persistence/user-auth-mode-repository.js";
export {
  InMemoryUserApiCredentialRepository,
  PostgresUserApiCredentialRepository,
  type UserApiCredentialRecord,
  type UserApiCredentialRepository
} from "./modules/persistence/user-api-credential-repository.js";
export {
  createPostgresPool,
  type PostgresConnectionOptions,
  type SqlClientLike
} from "./modules/persistence/postgres-client.js";
export {
  createInMemorySessionPersistence,
  createPostgresSessionPersistence,
  type SessionPersistence
} from "./modules/persistence/session-persistence.js";
export {
  EnvelopeEncryptionService,
  InMemoryKeyWrappingService,
  type EncryptionContext,
  type KeyWrappingService,
  type SecretEncryptionService,
  type StoredEncryptedSecret,
  type WrappedKeyMaterial
} from "./modules/security/secret-encryption.js";
export type {
  AssistantDeliveryPolicy,
  AssistantNotification,
  AssistantNotificationReason,
  AssistantPriority
} from "@agent/shared-types";
export {
  FinalizedUtteranceHandler,
  type FinalizedUtteranceHandled
} from "./modules/realtime/finalized-utterance-handler.js";
export {
  LiveTranscriptAdapter,
  type LiveTranscriptInput,
  type LiveTranscriptResult
} from "./modules/realtime/live-transcript-adapter.js";
export {
  LiveSessionController,
  type LiveSessionTurnResult,
  type LiveTranscriptChunk
} from "./modules/realtime/live-session-controller.js";
export {
  DEFAULT_LIVE_MODEL,
  GoogleLiveApiTransport,
  type GoogleLiveApiClientLike,
  type GoogleLiveApiTransportCallbacks,
  type GoogleLiveApiTransportConnectInput,
  type GoogleLiveSessionTransport,
  type GoogleLiveTransportEvent
} from "./modules/realtime/google-live-api-transport.js";
export { RealtimeGatewayService, type RealtimeGatewayResult } from "./modules/realtime/realtime-gateway-service.js";
export { TextRealtimeSessionLoop } from "./modules/realtime/text-realtime-session-loop.js";
export { TaskExecutionService } from "./modules/tasks/task-execution-service.js";
export { TaskRuntime } from "./modules/tasks/task-runtime.js";
export {
  buildAssistantFollowUpMessage,
  type BuildAssistantFollowUpInput
} from "./modules/tasks/task-event-announcer.js";
export { planAssistantNotificationDelivery } from "./modules/tasks/task-notification-policy.js";
