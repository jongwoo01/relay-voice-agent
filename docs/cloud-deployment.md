# Cloud Deployment And Proof Checklist

This repository now includes a Cloud Run service entrypoint, Dockerfile, and deployment helper script for the hosted agent path, but it still does not include Terraform/IaC.

Use this document to keep the public submission claims accurate and to collect the evidence judges will expect.

## What The Repo Already Supports

- `apps/agent-api`
  - agent core modules
  - hosted HTTP + WebSocket service
  - server-owned Gemini Live transport
  - model-backed intent, task routing, and intake
  - Postgres-backed persistence repositories
- `db/migrations`
  - schema for sessions, tasks, task events, intake sessions, and completion reports
- `apps/desktop`
  - thin Electron demo client
  - local audio shell and local `gemini` CLI worker
- `scripts/deploy-agent-api-cloud-run.sh`
  - one-command image build and Cloud Run deploy flow for the hosted service

## Submission Deployment Shape

### Google Cloud hosted core

- Package the agent core around `@agent/agent-api`
- Run that service on Cloud Run
- Keep canonical state in Cloud SQL for Postgres
- Use Gemini Live from the server and Vertex AI for intent, routing, and intake
- Connect the desktop client to the hosted core over HTTP + WebSocket for task truth and persistence
- Treat intent/routing/intake failures as explicit user-facing errors, not heuristic fallbacks

### Local or client-side pieces

- Electron remains the companion demo surface
- The live session and task truth are hosted
- The local runtime is reduced to the desktop executor worker that runs `gemini` CLI on the user's machine
- Hosted proof should focus on the cloud-hosted live session, task orchestration, and persistence layer

## Environment Matrix

### Required for the main desktop and hosted core path

- `GOOGLE_CLOUD_PROJECT`
- `GOOGLE_CLOUD_LOCATION`
- `DATABASE_URL`
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

The deployment script uses `apps/agent-api/Dockerfile`, builds from the monorepo root, and deploys the hosted service with Cloud Run environment variables or Secret Manager-backed values. The server now refuses to boot without the required hosted variables, so the judge path cannot silently fall back to in-memory state or a degraded live mode.

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

The main remaining cloud-packaging gap is not agent behavior. It is operational proof:

- judge-safe access details
- screenshots or logs from the deployed environment
- optional IaC or Cloud Build automation if you want bonus-point packaging depth
