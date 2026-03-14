# Desktop Companion

Desktop Companion is a real-time Gemini Live agent for desktop work. A user can speak naturally, interrupt the assistant mid-response, delegate local tasks, answer follow-up questions, and hear grounded task results in the same live conversation.

This repository contains the public submission package for the prototype:

- an Electron companion client used as the live demo surface
- a Cloud Run-ready agent service that owns the live session, task orchestration, and canonical state
- a Gemini CLI executor adapter for grounded local-machine work on the connected desktop
- Postgres schema and repository layers for canonical task state and narrow typed profile memory

## Why This Fits The Gemini Live Agent Challenge

- Uses Gemini Live for real-time audio interaction and interruption handling
- Uses Gemini models for intent resolution, task intake, and task routing
- Fails explicitly when intent, intake, or routing model calls are unavailable instead of guessing with local heuristics
- Keeps spoken task results grounded through a single live tool path, `delegate_to_gemini_cli`
- Supports multi-turn task clarification, background task continuity, and grounded completion briefings
- Maps to a Google Cloud submission topology where the agent core runs on Cloud Run and state lives in Cloud SQL

## Core Demo Scenarios

- Ask for a local task in natural speech, get a short clarification only when required, then continue in the same conversation
- Interrupt the assistant while it is speaking and pivot immediately to a new request
- Continue or inspect an existing task without inventing local-machine facts
- Hear grounded task results after runtime confirmation instead of speculative assistant summaries

## What Works Today

- Cloud-owned live session path with judge-authenticated WebSocket control channel
- Shared typed and voice companion surface in Electron
- Runtime-backed task intake and follow-up loop on the server
- Single-tool delegation path from Gemini Live to the connected desktop executor
- Structured completion reports for grounded task summaries
- Postgres persistence layer for sessions, tasks, task events, intake sessions, and typed profile memory
- Automated tests for judge auth, hosted WebSocket control, cloud-session executor round-trips, desktop hosted client behavior, routing, and persistence contracts

## What Is Still Outside The Repo-Managed Submission Package

- No committed Cloud deployment screenshots or service URLs yet
- No IaC or Cloud Build automation yet
- No judge credentials or private hosted-demo access details are stored in this repository

These gaps are documented on purpose so the public repository does not over-claim what has already been packaged.

## Submission Docs

- [Architecture overview](docs/architecture.md)
- [Cloud deployment and proof checklist](docs/cloud-deployment.md)
- [Judge testing guide](docs/judge-testing.md)

## Repository Map

- `apps/desktop`
  - Electron companion window
  - hosted Cloud session client
  - local audio/UI shell and local `gemini` CLI worker
- `apps/agent-api`
  - agent core modules
  - Cloud Run HTTP + WebSocket entrypoint
  - hosted live transport and session logic
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
- Postgres is required for the hosted path because sessions, tasks, and profile memory are canonical server state

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

### Run The Cloud Agent Service

```bash
npm run dev:agent-api
```

For local development with Docker-managed Postgres, start the database separately:

```bash
npm run dev:postgres
```

Required environment for the hosted path:

- `GOOGLE_CLOUD_PROJECT`
- `GOOGLE_CLOUD_LOCATION`
- `GEMINI_API_KEY` or `GOOGLE_API_KEY`
- `DATABASE_URL`
- `JUDGE_PASSCODE` or `JUDGE_USERS_JSON`
- `JUDGE_TOKEN_SECRET`

Optional judge identity mapping:

- `JUDGE_USERS_JSON`
  - JSON array of `{ "passcode": "...", "email": "...", "displayName": "..." }`
  - Recommended for per-judge isolation so task history and profile memory do not bleed across judges

Optional local Postgres overrides:

- `DEV_POSTGRES_CONTAINER_NAME`
- `DEV_POSTGRES_USER`
- `DEV_POSTGRES_PASSWORD`
- `DEV_POSTGRES_DB`
- `DEV_POSTGRES_PORT`

### Deploy The Hosted Agent To Cloud Run

Use the included deployment helper:

```bash
GCP_PROJECT_ID=<project-id> \
GCP_REGION=<region> \
CLOUD_RUN_SERVICE=gemini-live-agent \
ARTIFACT_REGISTRY_REPO=<repo> \
GOOGLE_CLOUD_LOCATION=<region> \
DATABASE_URL_SECRET=<secret-name> \
JUDGE_PASSCODE_SECRET=<secret-name> \
JUDGE_TOKEN_SECRET_SECRET=<secret-name> \
GEMINI_API_KEY_SECRET=<secret-name> \
npm run deploy:agent-api:cloud-run
```

The hosted service now fails fast if any of these are missing:

- `DATABASE_URL`
- `GOOGLE_CLOUD_PROJECT`
- `GOOGLE_CLOUD_LOCATION`
- `JUDGE_PASSCODE` or `JUDGE_USERS_JSON`
- `JUDGE_TOKEN_SECRET`
- `GEMINI_API_KEY` or `GOOGLE_API_KEY`

The hosted path now fails fast if `DATABASE_URL` is missing. The Cloud Run service is intentionally Postgres-backed only.

### Deploy The Hosted Service To Cloud Run

Set the deployment variables shown in `.env.example`, then run:

```bash
npm run deploy:agent-api:cloud-run
```

This script:

- builds the monorepo image with `apps/agent-api/Dockerfile`
- pushes it to Artifact Registry
- deploys the service to Cloud Run with the required hosted-path environment

### Run The Desktop Companion

```bash
npm run dev:desktop:prepare
npm run dev:desktop
```

Desktop environment:

- `AGENT_CLOUD_URL` pointing at the Cloud Run or local agent service
- local `gemini` CLI installed if you want real local task execution
- microphone permissions enabled

### Package The Desktop App

Create an unpacked app bundle:

```bash
npm run dist:desktop:dir
```

Platform-specific builds:

```bash
npm run dist:desktop:mac
npm run dist:desktop:win
```

Note: unsigned desktop builds may still show macOS Gatekeeper or Windows SmartScreen warnings.

### Build Unsigned Judge Installers

```bash
npm run dist:desktop:mac
npm run dist:desktop:win
```

These builds are intended for judge distribution. They are unsigned, so macOS Gatekeeper or Windows SmartScreen may show a first-launch warning.

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

Note: the hosted service owns the Gemini Live connection and uses the Gemini Developer API (`GEMINI_API_KEY` or `GOOGLE_API_KEY`) for the live path, while task routing, task intake, and intent resolution remain on Vertex AI runtime configuration. The desktop app is intentionally thin: it captures audio, renders hosted state, and executes local `gemini` CLI requests on behalf of the server. If Vertex AI intent/intake/routing calls fail, the hosted path returns an explicit error instead of guessing.

## Testing And Verification

Run the full test suite:

```bash
npm test
```

The repository is intentionally organized so the core behavior can be verified without relying on the final submission video or a hosted demo environment.

## Judge And Tester Notes

- Start with [docs/judge-testing.md](docs/judge-testing.md)
- The repo supports both a no-cost mock smoke path and a hosted judge path
- The hosted service owns live/session/task orchestration on Google Cloud
- The hosted path requires model-backed intent, intake, and routing; failures are surfaced explicitly to the user
- Real local task execution still requires the `gemini` CLI on the connected desktop machine
- Judge access details should be provided privately at submission time rather than committed to the public repository
- The recommended submission pattern is: public repo + private hosted judge URL/passcode in Devpost Additional Info

## Known Limits

- The public repo currently emphasizes the desktop demo client and agent core modules, not a finished Cloud Run packaging layer
- Cloud deployment proof must be attached from the deployed environment; it cannot be inferred from this repo alone
- Voice mode depends on local microphone/audio permissions and Gemini Live availability
- Cloud SQL persistence exists at the repository and migration layer, but the hosted judge path is intentionally Postgres-only
