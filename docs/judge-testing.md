# Judge Testing Guide

This is the expanded testing companion to the README. It keeps the same three validation paths, but adds the detail a judge, tester, or reviewer may want after the first pass.

## 1. No-cost smoke test

Use this when you want a deterministic local sanity check from the public repo without the hosted judge environment or packaged desktop build.

```bash
npm install
cp .env.example .env
npm run dev:text-session
```

What this validates:

- the local text harness starts correctly
- task and chat message flow are wired up
- the repo can demonstrate orchestration behavior without the Electron shell

What this does not validate:

- the packaged desktop app
- the Cloud Run hosted service
- judge auth and judge passcode flow
- real Gemini CLI execution on the local machine

Useful sample commands inside the harness:

- `/task Clean up the downloads folder`
- `/chat Hello`
- `/messages`

## 2. Repository test suite

Use this when you want reproducible code-level verification directly from the repository.

```bash
npm run typecheck
npm test
```

At a high level this covers:

- judge auth behavior
- hosted session and WebSocket control paths
- Postgres-backed persistence contracts
- intent, intake, routing, and task runtime logic
- desktop-side client and local execution layer behavior

This is the best repo-only signal for reviewers who want more than a smoke test but do not need the full judge experience.

## 3. Judge path

Use this when you want the intended submission-facing Relay flow.

1. Open [relay.leejongwoo.com](https://relay.leejongwoo.com).
2. Install Gemini CLI.
3. Install the Workspace extension.
4. Download Relay for macOS or Windows.
5. Launch Relay.
6. Enter the passcode from Devpost Additional Info.

Judge-path expectations:

- the public repository does not store passcodes or hosted-demo credentials
- the passcode is provided privately through Devpost Additional Info
- the desktop app prompts for the passcode before opening the hosted session
- Gemini CLI must be installed on the connected machine for real grounded local execution
- unsigned builds may show standard macOS Gatekeeper or Windows SmartScreen warnings

## Optional source-based local judge path

Use this only if you want to run the desktop app from source instead of using the packaged download flow.

```bash
npm run dev:postgres
npm run dev:agent-api
npm run dev:desktop:prepare
npm run dev:desktop
```

This is a developer path, not the main judge recommendation. The public judge path should use the packaged app from [relay.leejongwoo.com](https://relay.leejongwoo.com).

## Access model

- public landing page: [relay.leejongwoo.com](https://relay.leejongwoo.com)
- public code repo: [github.com/jongwoo01/relay-voice-agent](https://github.com/jongwoo01/relay-voice-agent)
- private passcode delivery: Devpost Additional Info only
- no passcodes or hosted-demo secrets are committed to this repository

## Known limitations

- voice mode needs microphone and audio permissions on the local machine
- real local execution still requires Gemini CLI to be installed and authenticated
- persistent hosted state requires Postgres
- the packaged Relay desktop app is a thin client; it does not embed the hosted agent core
- the main submission story is the packaged desktop app plus the hosted cloud core, not the standalone harnesses

For deployment proof and hosted topology notes, see [cloud-deployment.md](cloud-deployment.md).
