create table if not exists task_execution_artifacts (
  id uuid primary key default gen_random_uuid(),
  task_id text not null references tasks(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  seq integer not null,
  kind text not null check (
    kind in ('init', 'message', 'tool_use', 'tool_result', 'error', 'result')
  ),
  title text not null,
  body text,
  detail text,
  tool_name text,
  status text,
  role text,
  payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  unique (task_id, seq)
);

create index if not exists task_execution_artifacts_task_seq_idx
  on task_execution_artifacts (task_id, seq asc);

create index if not exists task_execution_artifacts_task_created_idx
  on task_execution_artifacts (task_id, created_at asc);
