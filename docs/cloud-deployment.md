# Cloud Deployment And Proof Checklist

This repository now includes a Cloud Run service entrypoint, Dockerfile, and deployment helper script for Relay's hosted agent path, but it still does not include Terraform/IaC.

Use this document to keep the public submission claims accurate and to collect the evidence judges will expect.

## Code-Link Proof Already In Repo

Devpost allows proof of Google Cloud deployment through a code file link that demonstrates use of Google Cloud services and APIs. This repository already contains that proof path even if screenshots or recordings are attached separately later.

- `apps/agent-api/src/modules/config/genai-client-factory.ts`
  - creates a `GoogleGenAI` Vertex AI client with `vertexai: true`, project, location, and API version
- `apps/agent-api/src/modules/live/google-live-api-transport.ts`
  - opens the Gemini Live session from the hosted agent service
- `apps/agent-api/src/server.ts`
  - fails fast unless the hosted runtime has Google Cloud and Postgres configuration
- `scripts/deploy-agent-api-cloud-run.sh`
  - builds the image, pushes through Cloud Build / Artifact Registry, and deploys to Cloud Run with Cloud SQL support

## What The Repo Already Supports

- `apps/agent-api`
  - agent core modules
  - hosted HTTP + WebSocket service
  - server-owned Gemini Live transport
  - model-backed intent, task routing, and intake
  - Postgres-backed persistence repositories
- `db/migrations`
  - ordered schema for sessions, tasks, task events, intake sessions, completion reports, and session memory
- `apps/desktop`
  - thin Electron Relay client
  - local audio shell and local `gemini` CLI worker
- `scripts/deploy-agent-api-cloud-run.sh`
  - one-command migration, image build, and Cloud Run deploy flow for the hosted service

## Submission Deployment Shape

### Google Cloud hosted core

- Package the agent core around `@agent/agent-api`
- Run that service on Cloud Run
- Keep canonical state in Cloud SQL for Postgres
- Use Gemini Live from the server and Vertex AI for intent, routing, and intake
- Connect the desktop client to the hosted core over HTTP + WebSocket for task truth and persistence
- Treat intent/routing/intake failures as explicit user-facing errors, not heuristic fallbacks

### Local or client-side pieces

- Relay remains the thin demo surface on the desktop
- The live session and task truth are hosted
- The local runtime is reduced to the desktop executor worker that runs `gemini` CLI on the user's machine
- Hosted proof should focus on the cloud-hosted live session, task orchestration, and persistence layer

## Environment Matrix

### Required for the main desktop and hosted core path

- `GOOGLE_CLOUD_PROJECT`
- `GOOGLE_CLOUD_LOCATION`
- `DATABASE_URL` or `PGHOST` + `PGUSER` + `PGDATABASE`
- `JUDGE_PASSCODE` or `JUDGE_USERS_JSON`
- `JUDGE_TOKEN_SECRET`
- `GEMINI_API_KEY` or `GOOGLE_API_KEY`

### Required for the deployment script

- `GCP_PROJECT_ID`
- `GCP_REGION`
- `CLOUD_RUN_SERVICE`
- `ARTIFACT_REGISTRY_REPO`

## Fastest Deploy Path

From the repo root:

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

For Cloud Run + Cloud SQL socket mode, separate the runtime DB connection from the migration DB connection:

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

The deployment script uses `apps/agent-api/Dockerfile`, runs the repo migration set against the target database, builds from the monorepo root, and deploys the hosted service with Cloud Run environment variables or Secret Manager-backed values. The server now refuses to boot without the required hosted variables, and it also refuses to boot if the database schema is missing, behind, or drifted.

### Required for persistent state

### Optional

- `GOOGLE_GENAI_API_VERSION`
- `LIVE_MODEL`
- `GEMINI_TASK_ROUTING_MODEL`
- `GEMINI_TASK_INTAKE_MODEL`
- `GEMINI_INTENT_MODEL`
- `JUDGE_USER_EMAIL`
- `JUDGE_USER_DISPLAY_NAME`
- optional: `JUDGE_USERS_JSON` for per-judge hosted identities
- `JUDGE_SESSION_TTL_SECONDS`
- `DESKTOP_EXECUTOR`, `GEMINI_EXECUTOR`, `DEV_POSTGRES`, `DEV_RAW_EXECUTOR` for local testing modes

### Separate standalone harness path

The `dev:live-text-session` harness still uses an API key path (`GOOGLE_API_KEY` or `GEMINI_API_KEY`). That harness is useful for transport testing, but it is not the main submission story.

## Proof Checklist For Submission

Capture these from the deployed environment before final submission:

- Cloud Run service overview screenshot
- Cloud SQL instance overview screenshot
- one screenshot or log excerpt showing the hosted core receiving or processing a live/task request
- one screenshot or SQL view showing persisted task or session state
- one short written note that explains which component is cloud-hosted and which component is the desktop client

## Public Repo Wording Guardrails

When writing the public submission:

- claim only what is already implemented in this repository
- describe Cloud Run and Cloud SQL as the submission deployment topology
- do not claim repo-managed IaC or packaged deployment assets unless they actually exist
- do not commit service credentials, judge passwords, or production URLs that should stay private

## Current Gap

The main remaining cloud-packaging gap is not whether the repo shows Google Cloud usage. That proof already exists in code. The remaining gap is operational packaging:

- judge-safe access details
- screenshots or recordings from the deployed environment
- optional Terraform or broader infrastructure-as-code if you want bonus-point packaging depth
