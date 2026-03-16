# Relay

> Relay is a real-time voice agent for the Google ecosystem.

Relay combines a hosted voice-first agent core with grounded local execution on the connected desktop. A user can speak naturally, interrupt the assistant mid-response, redirect work, and receive grounded updates in the same live session.

This repository contains the public submission package: the Electron desktop client, the Cloud Run-ready hosted agent core, the Gemini CLI executor path for local-machine work, and the Postgres-backed persistence layer that keeps canonical task and session state.

Judges should use the public download flow at [relay.leejongwoo.com](https://relay.leejongwoo.com). The judge passcode is provided privately through Devpost Additional Info. This public repository does not contain hosted-demo credentials.

## For Judges

Use this path if you want the intended submission experience:

1. Go to [relay.leejongwoo.com](https://relay.leejongwoo.com).
2. Install Gemini CLI.
3. Install the Workspace extension.
4. Download Relay for macOS or Windows.
5. Launch Relay and enter the judge passcode from Devpost Additional Info.

What judges need:

- an operating-system-specific Relay download from [relay.leejongwoo.com](https://relay.leejongwoo.com)
- Gemini CLI installed on the local machine
- the Workspace extension installed for Gemini CLI
- the private judge passcode from Devpost Additional Info

## Reproducible Testing

### No-cost smoke test

Use this when you want a deterministic repo-level sanity check without the packaged desktop app or hosted judge environment.

```bash
npm install
cp .env.example .env
npm run dev:text-session
```

This validates the local text harness, task flow shape, and repo wiring. It does not validate the packaged desktop app, the hosted Cloud Run service, or real Gemini CLI execution on a local machine.

### Repository test suite

Use this when you want reproducible code-level validation from the public repo alone.

```bash
npm run typecheck
npm test
```

This covers the hosted session path, judge auth, persistence contracts, routing and intake logic, and desktop-side client behavior at the repository level.

### Judge path

Use this when you want the actual submission-facing flow.

1. Open [relay.leejongwoo.com](https://relay.leejongwoo.com).
2. Install Gemini CLI.
3. Install the Workspace extension.
4. Download Relay for your operating system.
5. Launch the app and enter the passcode from Devpost Additional Info.

For the expanded testing guide, see [docs/judge-testing.md](docs/judge-testing.md).

## Architecture At A Glance

![Relay submission architecture](docs/devpost-simple-architecture.png)

Relay keeps live conversation, canonical task state, and orchestration in a hosted Cloud Run core backed by Cloud SQL for Postgres. The desktop app is the user-facing surface. Grounded local-machine work runs only through Gemini CLI on the connected device.

More detail:

- [Architecture overview](docs/architecture.md)
- [Cloud deployment notes](docs/cloud-deployment.md)
- [Judge testing guide](docs/judge-testing.md)

## Repo Map

- `apps/desktop`
  - Electron Relay client
  - voice and typed UI surface
  - connected desktop executor bridge
- `apps/agent-api`
  - Cloud Run-ready HTTP and WebSocket service
  - Gemini Live session ownership
  - judge auth, task orchestration, routing, and persistence
- `packages/gemini-cli-runner`
  - Gemini CLI command builder and subprocess execution
- `packages/brain-domain`
  - task and continuation rules
- `db/migrations`
  - ordered Postgres schema for canonical state

## Developer Setup

### Prerequisites

- Node `24.14.0`
- npm `11.9.0`
- Postgres for the hosted path
- `gcloud` CLI plus Application Default Credentials for Vertex AI-backed local development
- Gemini CLI if you want real local execution instead of a mock path

### Install

```bash
npm install
cp .env.example .env
```

Set the core environment values in `.env`:

- `GOOGLE_CLOUD_PROJECT`
- `GOOGLE_CLOUD_LOCATION`
- `GEMINI_API_KEY` or `GOOGLE_API_KEY`
- `PGHOST` + `PGUSER` + `PGDATABASE` + `PGPASSWORD` for the recommended Postgres path
- legacy local fallback: `DATABASE_URL`
- `JUDGE_PASSCODE` or `JUDGE_USERS_JSON`
- `JUDGE_TOKEN_SECRET`

Authenticate for local Vertex AI usage:

```bash
gcloud auth application-default login
gcloud config set project <project-id>
```

### Run locally

Start Docker Postgres if needed:

```bash
npm run dev:postgres
```

Start the hosted agent service:

```bash
npm run dev:agent-api
```

Start Relay from source:

```bash
npm run dev:desktop:prepare
npm run dev:desktop
```

Desktop local development expects:

- `AGENT_CLOUD_URL`
- a judge passcode entered in the app at runtime
- Gemini CLI installed for real local execution
- microphone permissions enabled

### Package the desktop app

```bash
npm run dist:desktop:mac
npm run dist:desktop:win
```

The packaged builds are unsigned judge-style artifacts. macOS may show Gatekeeper warnings and Windows may show SmartScreen warnings on first launch.

## Cloud Deployment

Relay’s hosted submission topology is Cloud Run plus Cloud SQL for Postgres. Runtime should prefer Cloud SQL socket mode, while migrations should use a separate direct database URL secret.

Recommended deploy command:

```bash
GCP_PROJECT_ID=<project-id> \
GCP_REGION=<region> \
CLOUD_RUN_SERVICE=gemini-live-agent \
ARTIFACT_REGISTRY_REPO=<repo> \
GOOGLE_CLOUD_LOCATION=<region> \
CLOUD_SQL_CONNECTION_NAME=<project:region:instance> \
CLOUD_SQL_DATABASE_NAME=gemini_live_agent \
CLOUD_SQL_DATABASE_USER=<db-user> \
CLOUD_SQL_DATABASE_PASSWORD_SECRET=<secret-name> \
MIGRATION_DATABASE_URL_SECRET=<direct-db-url-secret-name> \
JUDGE_PASSCODE_SECRET=<secret-name> \
JUDGE_TOKEN_SECRET_SECRET=<secret-name> \
GEMINI_API_KEY_SECRET=<secret-name> \
npm run deploy:agent-api:cloud-run
```

The deployment helper applies migrations, builds the monorepo image, pushes it to Artifact Registry, and deploys the hosted agent to Cloud Run with the required runtime configuration.

For the expanded deployment and proof notes, see [docs/cloud-deployment.md](docs/cloud-deployment.md).

## Public Repository Notes

- Public landing page: [relay.leejongwoo.com](https://relay.leejongwoo.com)
- Public code repository: [github.com/jongwoo01/relay-voice-agent](https://github.com/jongwoo01/relay-voice-agent)
- Judge passcodes and hosted-demo credentials are never stored in this repository
