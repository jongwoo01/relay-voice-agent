# Database Plan

This project starts with plain Postgres as the canonical state store.

## Why this shape
- `users` and `user_identities` define the account boundary.
- `brain_sessions`, `conversation_messages`, `tasks`, `task_events`, and `task_executor_sessions` persist the live/task runtime.
- `memory_items` stores typed long-term memory.
- `session_memory_items` stores LLM-extracted session-scoped memory keyed by `brain_session_id`.
- `schema_migrations` tracks which ordered SQL files from `db/migrations` have been applied.

## Memory strategy
- Start with typed memory, not vector-only memory.
- Store only extracted memory candidates, not raw transcripts.
- Current productionized memory path:
  - `profile`
    - `display_name`
- Reserved schema slots exist for:
  - `preferences`
  - `routines`
  - `current_context`
  - `task_history`

## Optional vector search
- `0002_memory_embeddings_optional.sql` adds `pgvector`.
- This is for semantic recall only.
- Typed lookup remains the source of truth.

## Migration policy
1. Add every schema change as a new ordered SQL file under `db/migrations`
2. Apply migrations with `npm run db:migrate --workspace @agent/agent-api`
3. The deployment script runs the same migration command before Cloud Run deploy
4. The runtime validates that all tracked migrations are already applied and fails fast on drift or missing schema
