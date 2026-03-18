# Relay

> Relay is a real-time voice agent that combines hosted Gemini Live conversation with grounded local execution on the connected desktop.

Relay is built for the Gemini Live Agent Challenge judging flow first. Judges should be able to understand what Relay is, why it qualifies, and how to use it in a few minutes without reading internal setup notes first.

## Judge Start Here

Use this exact path for the intended submission experience:

1. Open [relay.leejongwoo.com](https://relay.leejongwoo.com).
2. Install Gemini CLI.
3. Launch `gemini` once and complete Gemini CLI OAuth sign-in.
4. Install the Workspace extension for Gemini CLI.
5. Complete the extension's separate Google Workspace OAuth consent when it first asks for Docs, Drive, or Gmail access.
6. Download Relay for macOS or Windows from the landing page.
7. Launch Relay and enter the judge passcode from Devpost Additional Info.

What judges need:

- the public landing page: [relay.leejongwoo.com](https://relay.leejongwoo.com)
- Gemini CLI installed and signed in on the local machine because it is Relay's core grounded execution path
- the Workspace extension installed and authorized
- the private judge passcode from Devpost Additional Info

## Why Relay Exists

Relay is built around a simple product belief: the Google ecosystem is where real work already lives, but most assistants still trap the user in a text box and make the user manually bridge the gap between talking, local desktop work, and Google Workspace work.

Relay is meant to close that gap:

- speak naturally instead of typing command-style prompts
- interrupt and redirect work mid-response instead of restarting a workflow
- combine hosted live reasoning with grounded local desktop execution
- inspect and act across the Google surfaces the user explicitly authorized instead of forcing the user to copy information between Gmail, Drive, Docs, and the desktop by hand

## What Relay Does

Relay is a voice-first desktop agent for the Google ecosystem.

- It supports real-time voice conversation instead of turn-based text chat.
- It lets the user interrupt, redirect, and continue work in the same live session.
- It keeps the live Gemini session and task truth in a hosted cloud core instead of hiding product logic inside the desktop shell.
- It delegates grounded local file, app, and browser work through Gemini CLI on the connected machine.
- With the Workspace extension authorized, it can inspect and act across the Google Workspace surfaces the user explicitly allowed, including Docs, Drive, and Gmail.
- It preserves session and task continuity through hosted persistence.

## Google Workflow Coverage

Relay is designed to replace the common "open five tools and manually stitch the workflow together" pattern.

With Gemini CLI as the grounded local execution path and the authorized Workspace extension as the Google access layer, Relay can combine:

- local desktop work such as files, folders, browser state, and app-level follow-up on the connected machine
- Google Workspace work across the surfaces the user explicitly allowed, including Gmail, Drive, and Docs
- live conversational control, so the user can ask, interrupt, refine, and continue without dropping into separate tools

The intended value is not just answering questions about Google Workspace data. It is reducing real multi-step workflow friction across local desktop work plus the Google ecosystem the user authorized.

## Why This Qualifies For The Challenge

Relay is submitted as a **Live Agents** project for the Gemini Live Agent Challenge.

| Challenge requirement | Relay evidence |
| --- | --- |
| Live Agents category | Real-time voice interaction, interruption handling, and hosted live session flow |
| Leverages a Gemini model | Gemini Live powers the conversation and Gemini models handle routing, intake, and reasoning |
| Uses Google GenAI SDK or ADK | The hosted backend uses the Google GenAI SDK |
| Uses Gemini Live | The hosted core owns the Gemini Live session |
| Uses at least one Google Cloud service | Hosted on Cloud Run with Cloud SQL for canonical state |
| Public code repository | This repository is public for judge review |
| Architecture diagram | Included below and expanded in `docs/architecture.md` |
| Proof of Google Cloud usage | Linked in `docs/cloud-deployment.md` and backed by repository code paths |

## Architecture At A Glance

![Relay submission architecture](docs/devpost-simple-architecture.png)

Relay keeps the cloud and local boundaries explicit:

- **Desktop surface**: Electron app for voice input, playback, transcript, and task visibility
- **Hosted cloud core**: Cloud Run service for judge auth, live orchestration, and canonical task state
- **Gemini Live**: server-owned realtime conversation layer
- **Cloud SQL / Postgres**: durable sessions, messages, tasks, and task events
- **Local Gemini CLI executor**: grounded work on the connected device only when the hosted core delegates it

The short version is: **the cloud is the brain, and the desktop is the voice surface plus grounded hands on the local machine**.

## Proof Links

Use these links if you want to verify the submission quickly:

- Public landing page: [relay.leejongwoo.com](https://relay.leejongwoo.com)
- Public code repository: [github.com/jongwoo01/relay-voice-agent](https://github.com/jongwoo01/relay-voice-agent)
- Architecture overview: [docs/architecture.md](docs/architecture.md)
- Google Cloud proof notes: [docs/cloud-deployment.md](docs/cloud-deployment.md)
- Judge testing guide: [docs/judge-testing.md](docs/judge-testing.md)

## Repository Map

- `apps/desktop`: Electron desktop client, voice UI, and connected local executor bridge
- `apps/agent-api`: hosted HTTP and WebSocket service, Gemini Live session ownership, judge auth, orchestration, and persistence
- `packages/gemini-cli-runner`: Gemini CLI command builder and subprocess execution path for grounded local work
- `db/migrations`: ordered Postgres schema for canonical task and session state

## Minimal Repro Appendix

For the intended judge flow, use the packaged path at the top of this README.

For repo-level verification from the public codebase:

```bash
npm run typecheck
npm test
```

For a source-based maintainer run, use this path:

```bash
npm run dev:postgres
npm run dev:agent-api
npm run dev:desktop:prepare
npm run dev:desktop
```

Source-based notes:

- this maintainer path still expects `AGENT_CLOUD_URL`
- the app still requires a judge passcode at runtime
- real grounded local execution still requires Gemini CLI plus the authorized Workspace extension
- expanded setup notes remain in [docs/judge-testing.md](docs/judge-testing.md)

Hosted demo credentials are not stored in this repository. The judge passcode is provided privately through Devpost Additional Info.
