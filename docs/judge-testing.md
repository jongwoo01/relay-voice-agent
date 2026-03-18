# Judge Testing Guide

This guide is the extended companion to the judge-first README. It keeps the main focus on the actual submission path and only moves source-based verification to the end.

## 1. Judge Path

Use this if you want the intended Relay submission experience.

1. Open [relay.leejongwoo.com](https://relay.leejongwoo.com).
2. Install Gemini CLI.
3. Launch `gemini` once and complete Gemini CLI OAuth sign-in.
4. Install the Workspace extension.
5. Complete the extension's separate Google Workspace OAuth consent when it first asks for Docs, Drive, or Gmail access.
6. Download Relay for macOS or Windows.
7. Launch Relay.
8. Enter the passcode from Devpost Additional Info.

Judge-path expectations:

- the public repository does not store passcodes or hosted-demo credentials
- the passcode is provided privately through Devpost Additional Info
- the desktop app prompts for the passcode before opening the hosted session
- Gemini CLI must be installed and signed in on the connected machine because it is Relay's core grounded execution path
- the Workspace extension must be both installed and authorized
- once the Workspace extension is authorized, Relay can inspect and act across the Google Workspace surfaces the judge explicitly allowed, including Docs, Drive, and Gmail
- unsigned builds may still show standard macOS Gatekeeper or Windows SmartScreen warnings on first launch

## 2. Repository Verification

Use this if you want a repo-level validation path without stepping through the packaged app flow.

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

## 3. Optional Maintainer Path From Source

Use this only if you want to run Relay from source instead of using the packaged judge flow.

```bash
npm run dev:postgres
npm run dev:agent-api
npm run dev:desktop:prepare
npm run dev:desktop
```

Notes for the source-based path:

- this is a maintainer or reviewer path, not the recommended judge path
- local source runs still expect `AGENT_CLOUD_URL`
- a judge passcode is still required in the app at runtime
- voice mode needs microphone and audio permissions on the local machine
- real local execution still requires Gemini CLI and the authorized Workspace extension

## Access Model

- public landing page: [relay.leejongwoo.com](https://relay.leejongwoo.com)
- public code repo: [github.com/jongwoo01/relay-voice-agent](https://github.com/jongwoo01/relay-voice-agent)
- private passcode delivery: Devpost Additional Info only
- no passcodes or hosted-demo secrets are committed to this repository

## Supporting Proof

For Google Cloud proof and hosted topology notes, see [cloud-deployment.md](cloud-deployment.md).
