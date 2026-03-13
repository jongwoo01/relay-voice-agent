# Cloud Deployment And Proof Checklist

This repository contains the core modules and database schema needed for a Google Cloud submission, but it does not yet include repo-managed Cloud Run packaging assets such as a Dockerfile, Cloud Build config, or Terraform.

Use this document to keep the public submission claims accurate and to collect the evidence judges will expect.

## What The Repo Already Supports

- `apps/agent-api`
  - agent core modules
  - live transport
  - task routing and intake
  - Postgres-backed persistence repositories
- `db/migrations`
  - schema for sessions, tasks, task events, intake sessions, and completion reports
- `apps/desktop`
  - Electron demo client and live companion surface

## Submission Deployment Shape

### Google Cloud hosted core

- Package the agent core around `@agent/agent-api`
- Run that service on Cloud Run
- Keep canonical state in Cloud SQL for Postgres
- Use Vertex AI for Gemini Live and model-assisted routing/intake
- Connect the desktop or demo client to the hosted core for task truth and persistence

### Local or client-side pieces

- Electron remains the companion demo surface
- The live session and local runtime can still be demonstrated locally
- Hosted proof should focus on the cloud-hosted agent core and persistence layer

## Environment Matrix

### Required for the main desktop and hosted core path

- `GOOGLE_CLOUD_PROJECT`
- `GOOGLE_CLOUD_LOCATION`

### Required for persistent state

- `DATABASE_URL`

### Optional

- `GOOGLE_GENAI_API_VERSION`
- `LIVE_MODEL`
- `GEMINI_TASK_ROUTING_MODEL`
- `GEMINI_TASK_INTAKE_MODEL`
- `GEMINI_INTENT_MODEL`
- `DEV_USER_ID` for local Postgres-backed dev harnesses
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

The main remaining cloud-packaging gap is not agent behavior. It is proof and packaging:

- Cloud Run service wrapper
- deployment asset files
- judge-safe access details
- screenshots or logs from the deployed environment
