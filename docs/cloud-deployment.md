# Cloud Deployment And Proof Notes

This document exists to support the public submission claims for Relay's hosted Google Cloud architecture. It is written as a proof companion for judges and reviewers, not as a full deployment handbook.

## What Judges Can Verify

Relay's hosted submission topology is:

- **Cloud Run** for the hosted agent service
- **Cloud SQL for Postgres** as canonical state
- **Gemini Live** for the server-owned realtime session
- **Vertex AI-backed Gemini model calls** for intent, intake, routing, and session memory

The desktop app is the user-facing surface, but it is not the system of record for the live session or task state.

## Repo-Backed Proof

The public repository already contains code-level proof for the Google Cloud submission claims:

- `apps/agent-api/src/modules/config/genai-client-factory.ts`
  - creates the Google GenAI client and uses Vertex AI-backed model configuration for hosted reasoning paths
- `apps/agent-api/src/modules/live/google-live-api-transport.ts`
  - opens and manages the hosted Gemini Live session
- `apps/agent-api/src/server.ts`
  - enforces required Google Cloud and Postgres runtime configuration for the hosted path
- `scripts/deploy-agent-api-cloud-run.sh`
  - builds, migrates, and deploys the hosted agent service to Cloud Run with Cloud SQL support

## What To Look For In Judging

If you are reviewing the hosted proof, the fastest checks are:

1. Confirm that the backend is designed to run on Cloud Run.
2. Confirm that persistent canonical state is designed around Cloud SQL / Postgres.
3. Confirm that Gemini Live is owned by the hosted core, not embedded as desktop-only logic.
4. Confirm that Google GenAI SDK and Vertex AI-backed model usage are present in code.
5. Confirm that judge credentials and hosted-demo secrets are not committed to the public repo.

## Recommended Hosted Runtime Shape

For the intended hosted deployment path:

- prefer Cloud SQL socket mode at runtime
  - `PGHOST`
  - `PGUSER`
  - `PGDATABASE`
  - `PGPASSWORD`
- prefer running migrations inside GCP with a Cloud Run Job in socket mode
- keep direct migration URLs only as a fallback for local migration runs
- keep judge credentials private and outside the public repository

Legacy `DATABASE_URL` support remains available as a compatibility fallback, but it is not the preferred hosted configuration for the submission topology.

## Deploy Command

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
JUDGE_PASSCODE_SECRET=<secret-name> \
JUDGE_TOKEN_SECRET_SECRET=<secret-name> \
GEMINI_API_KEY_SECRET=<secret-name> \
npm run deploy:agent-api:cloud-run
```

The deployment helper:

- builds the monorepo image
- runs ordered SQL migrations before service deploy
- defaults to Cloud Run Job-based migrations when Cloud SQL socket mode is enabled
- pushes through Artifact Registry
- deploys the hosted agent service with the required runtime configuration

The hosted service refuses to boot if required Google Cloud or Postgres configuration is missing, or if the schema is behind the repository migration set.

## Suggested Evidence Set

For submission proof or reviewer verification, the most useful evidence is:

- Cloud Run service overview
- Cloud SQL instance overview
- one hosted request or task-processing proof point
- one proof point showing persisted state
- one short explanation of the cloud/local responsibility split

## Public Repo Guardrails

- keep passcodes and hosted-demo credentials out of the public repo
- describe Cloud Run and Cloud SQL only where the repository already supports that claim
- avoid claiming broader infrastructure automation unless it is actually committed
- direct judges to [relay.leejongwoo.com](https://relay.leejongwoo.com) for the packaged app flow and Devpost Additional Info for the private passcode
