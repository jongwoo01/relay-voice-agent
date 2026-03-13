# Desktop Companion

Desktop Companion is a real-time Gemini Live agent for desktop work. A user can speak naturally, interrupt the assistant mid-response, delegate local tasks, answer follow-up questions, and hear grounded task results in the same live conversation.

This repository contains the public submission package for the prototype:

- an Electron companion client used as the live demo surface
- the agent core modules that handle intent, intake, task routing, persistence, and follow-up policy
- a Gemini CLI executor adapter for grounded local-machine work
- Postgres schema and repository layers for canonical task and memory state

## Why This Fits The Gemini Live Agent Challenge

- Uses Gemini Live for real-time audio interaction and interruption handling
- Uses Gemini models for intent resolution, task intake, and task routing
- Keeps spoken task results grounded through a single live tool path, `delegate_to_gemini_cli`
- Supports multi-turn task clarification, background task continuity, and grounded completion briefings
- Maps to a Google Cloud submission topology where the agent core runs on Cloud Run and state lives in Cloud SQL

## Core Demo Scenarios

- Ask for a local task in natural speech, get a short clarification only when required, then continue in the same conversation
- Interrupt the assistant while it is speaking and pivot immediately to a new request
- Continue or inspect an existing task without inventing local-machine facts
- Hear grounded task results after runtime confirmation instead of speculative assistant summaries

## What Works Today

- Live audio path with Gemini Live inside the Electron companion
- Shared typed and voice companion surface
- Runtime-backed task intake and follow-up loop
- Single-tool delegation path from Gemini Live to the task runtime
- Structured completion reports for grounded task summaries
- Postgres persistence layer for sessions, tasks, task events, intake sessions, and completion reports
- Smoke and test flows for desktop runtime, text runtime, transport, routing, and persistence contracts

## What Is Still Outside The Repo-Managed Submission Package

- No repo-managed Cloud Run wrapper, Dockerfile, or IaC assets yet
- No committed Cloud deployment screenshots or service URLs yet
- No judge credentials or private hosted-demo access details are stored in this repository

These gaps are documented on purpose so the public repository does not over-claim what has already been packaged.

## Submission Docs

- [Architecture overview](docs/architecture.md)
- [Cloud deployment and proof checklist](docs/cloud-deployment.md)
- [Judge testing guide](docs/judge-testing.md)

## Repository Map

- `apps/desktop`
  - Electron companion window
  - live voice session
  - live-to-runtime bridge
- `apps/agent-api`
  - agent core modules
  - live transport and session logic
  - task routing, intake, follow-up, and persistence
- `packages/gemini-cli-runner`
  - Gemini CLI command builder and subprocess executor
- `packages/brain-domain`
  - pure task and continuation rules
- `db/migrations`
  - Postgres schema for sessions, tasks, task events, intake state, and completion reports

## Quick Start

### Prerequisites

- Node `24.14.0`
- npm `11.9.0`
- `gcloud` CLI with Application Default Credentials for the main desktop flow
- the `gemini` CLI installed if you want real local task execution
- optional Postgres if you want persistent sessions instead of in-memory runtime state

### Install

```bash
npm install
cp .env.example .env
```

For the main desktop flow, set:

- `GOOGLE_CLOUD_PROJECT`
- `GOOGLE_CLOUD_LOCATION`

Authenticate locally for Vertex AI:

```bash
gcloud auth application-default login
```

If needed, set the active project:

```bash
gcloud config set project <project-id>
```

### Run The Desktop Companion

```bash
npm run dev:desktop:prepare
npm run dev:desktop
```

### Fast Smoke Paths

Mocked desktop runtime:

```bash
npm run smoke:desktop -- --mock
```

Gemini CLI-backed desktop runtime:

```bash
npm run smoke:desktop -- --raw-executor
```

Text runtime harness:

```bash
npm run dev:text-session
```

Standalone live text harness:

```bash
npm run dev:live-text-session
```

Note: live/bidi sessions use the Gemini Developer API (`GEMINI_API_KEY` or `GOOGLE_API_KEY`) so the desktop companion can keep tool `NON_BLOCKING` behavior, while task routing, task intake, and intent resolution remain on Vertex AI runtime configuration.

## Testing And Verification

Run the full test suite:

```bash
npm test
```

The repository is intentionally organized so the core behavior can be verified without relying on the final submission video or a hosted demo environment.

## Judge And Tester Notes

- Start with [docs/judge-testing.md](docs/judge-testing.md)
- The repo supports both a no-cost mock smoke path and a real live path
- Real live desktop runs use Vertex AI project and ADC configuration
- Real local task execution also requires the `gemini` CLI on the local machine
- If a private hosted demo is used for submission, access details should be provided privately at submission time rather than committed to the public repository

## Known Limits

- The public repo currently emphasizes the desktop demo client and agent core modules, not a finished Cloud Run packaging layer
- Cloud deployment proof must be attached from the deployed environment; it cannot be inferred from this repo alone
- Voice mode depends on local microphone/audio permissions and Gemini Live availability
- Cloud SQL persistence exists at the repository and migration layer, but local dev defaults still allow in-memory runtime flows
