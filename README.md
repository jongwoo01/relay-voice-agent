# gemini_live_agent

Minimal monorepo scaffold for a test-first desktop live agent.

Current focus:
- `@agent/brain-domain`: pure domain logic and unit tests
- `@agent/agent-api`: thin shell around the brain-domain
- `@agent/local-executor-protocol`: shared executor contract
- `@agent/gemini-cli-runner`: command builder and parser for the real CLI adapter
- `@agent/shared-types`: shared contracts

Next steps:
- replace the in-memory repository with real persistence
- add a realtime lane that feeds finalized utterances into RealtimeGatewayService
- replace the text realtime loop with a Live API-backed realtime gateway
