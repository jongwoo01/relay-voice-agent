# gemini_live_agent

Minimal monorepo scaffold for a test-first desktop live agent.

Runtime baseline:
- Node `24.14.0` via `.nvmrc`
- npm `11.9.0`

Current focus:
- `@agent/brain-domain`: pure domain logic and unit tests
- `@agent/agent-api`: thin shell around the brain-domain
- `@agent/local-executor-protocol`: shared executor contract
- `@agent/gemini-cli-runner`: command builder and parser for the real CLI adapter
- `@agent/shared-types`: shared contracts

Next steps:
- replace the in-memory repository with real persistence
- wire a real Live API transport into the live transcript adapter

Dev entrypoints:
- `npm run dev:text-session`
- `npm run dev:live-text-session`
- `npm run smoke:gemini`

Local environment:
- copy `.env.example` to `.env`
- set `GOOGLE_API_KEY` or `GEMINI_API_KEY` for dev intent resolution and Live API scripts
