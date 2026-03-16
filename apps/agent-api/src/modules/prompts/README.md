# Runtime Prompt Registry

This folder is the single source of truth for production runtime prompts used by
the hosted agent API.

Included prompt groups:
- live conversation system instruction
- intent / task-intake / task-routing prompts
- session memory extraction prompt

Excluded on purpose:
- test fixture strings
- script-only smoke/debug prompts
- documentation examples

The local Gemini CLI execution prompt lives in
`packages/gemini-cli-runner/src/prompts.ts` because it belongs to a separate
runtime package and is consumed directly by the local executor command builder.
