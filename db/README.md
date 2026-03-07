# Database Plan

This project starts with plain Postgres as the canonical state store.

## Why this shape
- `users` and `user_identities` define the account boundary.
- `brain_sessions`, `conversation_messages`, `tasks`, `task_events`, and `task_executor_sessions` persist the live/task runtime.
- `memory_items` stores typed long-term memory.

## Memory strategy
- Start with typed memory, not vector-only memory.
- Store only extracted memory candidates, not raw transcripts.
- Use these memory types:
  - `profile`
  - `preferences`
  - `routines`
  - `current_context`
  - `task_history`

## Optional vector search
- `0002_memory_embeddings_optional.sql` adds `pgvector`.
- This is for semantic recall only.
- Typed lookup remains the source of truth.

## Initial rollout order
1. Apply `0001_initial.sql`
2. Replace in-memory repositories with Postgres-backed repositories
3. Add memory extraction and memory recall
4. Apply `0002_memory_embeddings_optional.sql` only when semantic recall is needed
