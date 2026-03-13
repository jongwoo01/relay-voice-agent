# Judge Testing Guide

This guide gives judges and testers a clear path through the repository without requiring them to guess which command matters.

## Fastest Paths

### Option 1: No-cost smoke path

Use this when you want to verify the runtime shape without live cloud credentials or local-machine side effects.

```bash
npm install
npm run smoke:desktop -- --mock
```

What this shows:

- desktop runtime boot
- task orchestration path
- assistant/task state transitions
- summary output without requiring Gemini Live or the `gemini` CLI

### Option 2: Real desktop companion path

Use this when you want to verify the main submission-facing desktop flow.

Requirements:

- `GOOGLE_CLOUD_PROJECT`
- `GOOGLE_CLOUD_LOCATION`
- local ADC auth: `gcloud auth application-default login`
- the `gemini` CLI installed if you want real local task execution

Commands:

```bash
npm run dev:desktop:prepare
npm run dev:desktop
```

### Option 3: Standalone live text harness

Use this when you want to inspect the Gemini Live transport without the Electron shell.

Requirements:

- `GOOGLE_API_KEY` or `GEMINI_API_KEY`

Command:

```bash
npm run dev:live-text-session
```

## Local Environment

Copy the example environment file:

```bash
cp .env.example .env
```

Common variables:

- `GOOGLE_CLOUD_PROJECT`
- `GOOGLE_CLOUD_LOCATION`
- `GOOGLE_GENAI_API_VERSION`
- `LIVE_MODEL`
- `DATABASE_URL`
- `DEV_USER_ID`

## Judge Access Model

- This public repository does not store judge credentials or private demo URLs
- If a private hosted demo is used for submission, judge credentials should be provided privately at submission time
- Do not commit private credentials to the public repo or the public README

## Known Limitations

- Full voice mode needs microphone and audio permissions on the local machine
- Persistent state requires Postgres; local smoke flows can still run in-memory
- The main submission story is the desktop companion plus cloud-hosted core, not the standalone live-text harness
- Cloud deployment proof is documented separately in [cloud-deployment.md](cloud-deployment.md)
