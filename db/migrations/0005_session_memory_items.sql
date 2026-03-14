create table if not exists session_memory_items (
  id uuid primary key default gen_random_uuid(),
  brain_session_id text not null references brain_sessions(id) on delete cascade,
  kind text not null check (
    kind in (
      'identity',
      'preference',
      'workflow',
      'constraint',
      'background',
      'current_context'
    )
  ),
  key text not null,
  summary text not null,
  value_json jsonb not null default '{}'::jsonb,
  importance text not null default 'medium' check (
    importance in ('high', 'medium', 'low')
  ),
  confidence real not null default 0.5 check (confidence >= 0 and confidence <= 1),
  source_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brain_session_id, kind, key)
);

create index if not exists session_memory_items_session_updated_idx
  on session_memory_items (brain_session_id, updated_at desc);
