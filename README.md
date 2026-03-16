# Relay

> Relay: The Voice Agent for the Google Ecosystem

Relay is a real-time voice agent that extends the Google ecosystem into an ongoing conversation with the local OS. A user can assign a task, keep chatting naturally, interrupt mid-response, redirect work, and receive grounded updates in the same live session.

This repository contains the public submission package for the prototype:

- a thin Electron Relay app used as the live demo surface
- a Cloud Run-ready agent service that owns the live session, task orchestration, and canonical state
- a Gemini CLI executor adapter for grounded local-machine work on the connected desktop
- Postgres schema and repository layers for canonical task state and session-scoped memory

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
- Shared typed and voice Relay surface in Electron
- Runtime-backed task intake and follow-up loop on the server
- Single-tool delegation path from Gemini Live to the connected desktop executor
- Structured completion reports for grounded task summaries
- Postgres persistence layer for sessions, tasks, task events, intake sessions, and session-scoped memory
- Ordered SQL migrations with deploy-time application and runtime schema validation
- Automated tests for judge auth, hosted WebSocket control, cloud-session executor round-trips, desktop hosted client behavior, routing, and persistence contracts

## What Is Still Outside The Repo-Managed Submission Package

- No committed Cloud deployment screenshots or screen-recording proof artifacts yet
- No Terraform or broader infrastructure-as-code stack yet
- No judge credentials or private hosted-demo access details are stored in this repository

The public repository does already contain code-level Google Cloud proof that can be linked in the submission:

- Google GenAI SDK usage for Vertex AI and Gemini Live client creation in `apps/agent-api/src/modules/config/genai-client-factory.ts`
- Gemini Live connection setup in `apps/agent-api/src/modules/live/google-live-api-transport.ts`
- Cloud Run + Artifact Registry + Cloud SQL deployment automation in `scripts/deploy-agent-api-cloud-run.sh`
- Hosted runtime startup guards for Google Cloud and Postgres in `apps/agent-api/src/server.ts`

These gaps are documented on purpose so the public repository does not over-claim what has already been packaged.

## Submission Docs

- [Architecture overview](docs/architecture.md)
- [Cloud deployment and proof checklist](docs/cloud-deployment.md)
- [Judge testing guide](docs/judge-testing.md)

## Repository Map

- `apps/desktop`
  - Electron Relay window
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
- Postgres is required for the hosted path because sessions, tasks, and session memory are canonical server state

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

This command applies the repo migration set before starting the server.
To run migrations explicitly, use:

```bash
npm run db:migrate --workspace @agent/agent-api
```

For local development with Docker-managed Postgres, start the database separately:

```bash
npm run dev:postgres
```

Required environment for the hosted path:

- `GOOGLE_CLOUD_PROJECT`
- `GOOGLE_CLOUD_LOCATION`
- `GEMINI_API_KEY` or `GOOGLE_API_KEY`
- `DATABASE_URL` or `PGHOST` + `PGUSER` + `PGDATABASE`
- `JUDGE_PASSCODE` or `JUDGE_USERS_JSON`
- `JUDGE_TOKEN_SECRET`

Optional judge identity mapping:

- `JUDGE_USERS_JSON`
  - JSON array of `{ "passcode": "...", "email": "...", "displayName": "..." }`
  - Recommended for per-judge isolation so task history and session memory do not bleed across judges

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

For a safer Cloud SQL runtime path on Cloud Run, use Cloud SQL socket mode instead of sending a direct runtime `DATABASE_URL` into the service:

```bash
GCP_PROJECT_ID=<project-id> \
GCP_REGION=<region> \
CLOUD_RUN_SERVICE=gemini-live-agent \
ARTIFACT_REGISTRY_REPO=<repo> \
GOOGLE_CLOUD_LOCATION=<region> \
CLOUD_SQL_CONNECTION_NAME=<project:region:instance> \
CLOUD_SQL_DATABASE_NAME=gemini_live_agent \
CLOUD_SQL_DATABASE_USER=agent_user \
CLOUD_SQL_DATABASE_PASSWORD_SECRET=<secret-name> \
MIGRATION_DATABASE_URL_SECRET=<direct-db-url-secret-name> \
JUDGE_PASSCODE_SECRET=<secret-name> \
JUDGE_TOKEN_SECRET_SECRET=<secret-name> \
GEMINI_API_KEY_SECRET=<secret-name> \
npm run deploy:agent-api:cloud-run
```

The hosted service now fails fast if any of these are missing:

- `DATABASE_URL` or `PGHOST` + `PGUSER` + `PGDATABASE`
- `GOOGLE_CLOUD_PROJECT`
- `GOOGLE_CLOUD_LOCATION`
- `JUDGE_PASSCODE` or `JUDGE_USERS_JSON`
- `JUDGE_TOKEN_SECRET`
- `GEMINI_API_KEY` or `GOOGLE_API_KEY`

The hosted path now fails fast if no Postgres connection config is present. The Cloud Run service is intentionally Postgres-backed only.

### Deploy The Hosted Service To Cloud Run

Set the deployment variables shown in `.env.example`, then run:

```bash
npm run deploy:agent-api:cloud-run
```

This script:

- applies the ordered SQL migration set against the target database before deployment
- builds the monorepo image with `apps/agent-api/Dockerfile`
- pushes it to Artifact Registry
- deploys the service to Cloud Run with the required hosted-path environment

At runtime, the server validates that all repo migrations are already applied and refuses to boot if the database schema is behind or drifted.

### Run Relay

```bash
npm run dev:desktop:prepare
npm run dev:desktop
```

Desktop environment:

- `AGENT_CLOUD_URL` pointing at the Cloud Run or local agent service
- judge passcode entered in the desktop lock screen at runtime
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

Notes:

- `npm run dist:desktop:mac` builds a macOS universal DMG so the same artifact runs on Apple Silicon and Intel Macs
- `npm run dist:desktop:win` builds a Windows x64 NSIS installer for standard judge laptops and desktops
- unsigned desktop builds may still show macOS Gatekeeper or Windows SmartScreen warnings

### Build Unsigned Judge Installers

```bash
npm run dist:desktop:mac
npm run dist:desktop:win
```

These builds are intended for judge distribution. The macOS artifact is universal, and the Windows installer targets x64. They are unsigned, so macOS Gatekeeper or Windows SmartScreen may show a first-launch warning.

### Fast Smoke Paths

Text runtime harness:

```bash
npm run dev:text-session
```

Suggested no-cost commands inside the harness:

- `/task Clean up the downloads folder`
- `/chat Hello`
- `/messages`

Gemini CLI-backed text runtime:

```bash
npm run dev:text-session -- --gemini --raw-executor
```

Standalone live text harness:

```bash
npm run dev:live-text-session
```

Note: the hosted service owns the Gemini Live connection and uses the Gemini Developer API (`GEMINI_API_KEY` or `GOOGLE_API_KEY`) for the live path, while task routing, task intake, and intent resolution remain on Vertex AI runtime configuration. The Relay desktop app is intentionally thin: it captures audio, renders hosted state, and executes local `gemini` CLI requests on behalf of the server. If Vertex AI intent/intake/routing calls fail, the hosted path returns an explicit error instead of guessing.

## Testing And Verification

Run the full test suite:

```bash
npm test
```

The repository is intentionally organized so the core behavior can be verified without relying on the final submission video or a hosted demo environment.

## Judge And Tester Notes

- Start with [docs/judge-testing.md](docs/judge-testing.md)
- The repo supports both a no-cost text harness path and a hosted judge path
- The hosted service owns live/session/task orchestration on Google Cloud
- The hosted path requires model-backed intent, intake, and routing; failures are surfaced explicitly to the user
- Real local task execution still requires the `gemini` CLI on the connected desktop machine
- Judge access details should be provided privately at submission time rather than committed to the public repository
- The recommended submission pattern is: public repo + private hosted judge URL/passcode in Devpost Additional Info

## Known Limits

- The public repo packages the hosted runtime and Relay desktop app, and it also contains code-link proof for Google Cloud usage, but screenshot or recording proof still depends on deployed-environment artifacts
- Cloud deployment proof can be satisfied either by deployed-environment artifacts or by linking the relevant Google Cloud integration files in this repository
- Voice mode depends on local microphone/audio permissions and Gemini Live availability
- Cloud SQL persistence exists at the repository and migration layer, but the hosted judge path is intentionally Postgres-only
