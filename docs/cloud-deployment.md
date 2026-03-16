# Cloud Deployment And Proof Notes

This document supports the public submission claims for Relay’s hosted architecture. It is intentionally focused on proof and topology, not general repository onboarding.

## Hosted topology

Relay’s hosted core is designed for:

- Cloud Run for the agent service
- Cloud SQL for Postgres as canonical state
- Gemini Live for the server-owned realtime session
- Vertex AI-backed model calls for intent, intake, routing, and session memory

The desktop app remains a thin client. It is the user-facing surface, but it does not own the live session or canonical task state.

## Repo-backed proof already present

The public repository already contains code-level proof for the Google Cloud submission topology:

- `apps/agent-api/src/modules/config/genai-client-factory.ts`
  - creates the Google GenAI client for Vertex AI-backed model usage
- `apps/agent-api/src/modules/live/google-live-api-transport.ts`
  - opens the hosted Gemini Live session
- `apps/agent-api/src/server.ts`
  - validates hosted runtime requirements for Google Cloud and Postgres
- `scripts/deploy-agent-api-cloud-run.sh`
  - applies migrations, builds the image, and deploys the hosted core to Cloud Run with Cloud SQL support

## Recommended runtime shape

For the hosted deployment path:

- prefer Cloud SQL socket mode at runtime
  - `PGHOST`
  - `PGUSER`
  - `PGDATABASE`
  - `PGPASSWORD`
- keep migrations on a separate direct database URL secret
  - `MIGRATION_DATABASE_URL_SECRET`
- keep judge credentials private and outside the public repo

Legacy runtime `DATABASE_URL` support remains available as a fallback, but it is not the preferred hosted configuration.

## Deploy command

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

The deployment helper:

- runs the ordered SQL migrations before deploy
- builds from the monorepo root using `apps/agent-api/Dockerfile`
- pushes through Artifact Registry
- deploys the Cloud Run service with hosted runtime configuration

The hosted service refuses to boot if required Google Cloud or Postgres configuration is missing, or if the schema is behind the repo migration set.

## Proof checklist

For final submission evidence, capture:

- Cloud Run service overview
- Cloud SQL instance overview
- one hosted request or task-processing proof point
- one proof point showing persisted state
- one short note explaining the cloud/local responsibility split

## Public repo guardrails

- keep passcodes and hosted-demo credentials out of the public repo
- describe Cloud Run and Cloud SQL as the hosted deployment topology only where the repo already supports that claim
- avoid claiming Terraform or broader IaC unless it is actually committed
- direct judges to [relay.leejongwoo.com](https://relay.leejongwoo.com) for the packaged app flow and Devpost Additional Info for the private passcode
