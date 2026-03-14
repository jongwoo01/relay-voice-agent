# Judge Testing Guide

This guide gives judges and testers a clear path through the repository without requiring them to guess which command matters.

## Fastest Paths

### Option 1: No-cost smoke path

Use this when you want to verify the runtime shape without live cloud credentials or local-machine side effects.

```bash
npm install
npm run dev:text-session
```

What this shows:

- text-driven orchestration without the Electron shell
- assistant/task state transitions
- summary output without requiring the `gemini` CLI when you stay on the default mock executor
- a local developer harness only; it is not the hosted judging path

Suggested commands inside the harness:

- `/task Clean up the downloads folder`
- `/chat Hello`
- `/messages`

### Option 2: Hosted judge path

Use this when you want to verify the main submission-facing desktop flow.

Requirements:

- running hosted agent service on Cloud Run or locally with `npm run dev:agent-api`
- judge passcode
  - recommended: one unique passcode per judge
- the `gemini` CLI installed on the connected desktop if you want real local task execution
- desktop `AGENT_CLOUD_URL` set to that hosted service

Commands:

```bash
npm run dev:agent-api
npm run dev:desktop:prepare
npm run dev:desktop
```

For local-only development, run `npm run dev:postgres` first to start or reuse the Docker Postgres container, then launch `npm run dev:agent-api`.

Hosted flow expectations:

- judges receive the hosted service URL and a judge-specific passcode privately through Devpost Additional Info
- the public repository and public README do not contain private passcodes
- when `JUDGE_USERS_JSON` is used, each passcode maps to a distinct hosted user identity so task history and profile memory remain isolated per judge
- the desktop app prompts for the judge passcode before opening the live session
- the connected machine still needs the `gemini` CLI if you want real local task execution instead of a mock run
- unsigned desktop builds may show standard macOS or Windows trust warnings on first launch
- intent, task intake, and task routing are model-backed on the hosted service; if those upstream calls fail, the app surfaces an explicit error instead of guessing

### Option 2B: Packaged desktop build for judges

Use this when you want to hand judges a desktop build instead of asking them to run Electron from source.

Commands:

```bash
npm run dist:desktop:mac
npm run dist:desktop:win
```

Notes:

- these are unsigned judge builds
- the macOS artifact is a universal build for Apple Silicon and Intel Macs
- the Windows installer targets x64 instead of ARM64
- macOS may show a Gatekeeper warning for an unidentified developer build
- Windows may show a SmartScreen warning before first launch
- the packaged app still expects a hosted `AGENT_CLOUD_URL` and a judge passcode
- real local task execution still requires the connected machine to have `gemini` CLI installed

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

- `AGENT_CLOUD_URL`
- `JUDGE_PASSCODE` or `JUDGE_USERS_JSON`
- `GOOGLE_CLOUD_PROJECT`
- `GOOGLE_CLOUD_LOCATION`
- `GOOGLE_GENAI_API_VERSION`
- `LIVE_MODEL`
- `DATABASE_URL`

## Judge Access Model

- This public repository does not store judge credentials or private demo URLs
- If a private hosted demo is used for submission, judge credentials should be provided privately at submission time
- Do not commit private credentials to the public repo or the public README
- Recommended Devpost wording:
  - `Hosted demo URL: <url>`
  - `Judge passcode: <passcode>`
  - `Testing note: install the desktop app, enter the passcode, and ensure the local machine has gemini CLI configured if you want real local task execution.`
- If you provide a packaged desktop build, give judges the hosted URL and passcode in Devpost Additional Info rather than in public docs

## Known Limitations

- Full voice mode needs microphone and audio permissions on the local machine
- Persistent state requires Postgres on the hosted service
- Real local task execution still requires the desktop machine to have `gemini` CLI installed and authenticated
- The hosted core refuses to start without Cloud-hosted runtime configuration; it does not fall back to in-memory judge mode
- The packaged desktop app is a thin client; it does not embed the hosted agent core
- The main submission story is the desktop companion plus cloud-hosted core, not the standalone live-text harness
- Cloud deployment proof is documented separately in [cloud-deployment.md](cloud-deployment.md)
