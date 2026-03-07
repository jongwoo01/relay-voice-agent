create extension if not exists pgcrypto;

create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table user_identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  provider text not null,
  provider_user_id text not null,
  email text,
  email_verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_user_id)
);

create table user_auth_modes (
  user_id uuid primary key references users(id) on delete cascade,
  primary_mode text not null check (primary_mode in ('google_oauth', 'gemini_api_key')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table user_api_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  provider text not null check (provider in ('gemini_developer_api')),
  encrypted_payload jsonb not null,
  key_label text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index user_api_credentials_provider_idx
  on user_api_credentials (user_id, provider);

create table brain_sessions (
  id text primary key,
  user_id uuid not null references users(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'closed')),
  source text not null default 'live' check (source in ('live', 'text_dev', 'desktop')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);

create index brain_sessions_user_created_idx
  on brain_sessions (user_id, created_at desc);

create table conversation_messages (
  id uuid primary key default gen_random_uuid(),
  brain_session_id text not null references brain_sessions(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  speaker text not null check (speaker in ('user', 'assistant', 'system')),
  text text not null,
  tone text check (tone in ('reply', 'clarify', 'task_ack')),
  source text not null default 'live' check (
    source in ('live', 'text_dev', 'executor_summary', 'system')
  ),
  created_at timestamptz not null
);

create index conversation_messages_session_created_idx
  on conversation_messages (brain_session_id, created_at asc);

create index conversation_messages_user_created_idx
  on conversation_messages (user_id, created_at desc);

create table tasks (
  id text primary key,
  brain_session_id text not null references brain_sessions(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  title text not null,
  normalized_goal text not null,
  status text not null check (
    status in ('created', 'queued', 'running', 'waiting_input', 'completed', 'failed', 'cancelled')
  ),
  kind text not null default 'local_executor' check (kind in ('local_executor')),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  completed_at timestamptz
);

create index tasks_session_updated_idx
  on tasks (brain_session_id, updated_at desc);

create index tasks_user_status_updated_idx
  on tasks (user_id, status, updated_at desc);

create table task_events (
  id uuid primary key default gen_random_uuid(),
  task_id text not null references tasks(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  type text not null check (
    type in ('task_created', 'task_queued', 'task_started', 'executor_progress', 'executor_completed', 'executor_failed')
  ),
  message text not null,
  payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null
);

create index task_events_task_created_idx
  on task_events (task_id, created_at asc);

create table task_executor_sessions (
  task_id text primary key references tasks(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  executor_type text not null default 'gemini_cli' check (executor_type in ('gemini_cli')),
  session_id text,
  working_directory text,
  updated_at timestamptz not null,
  last_heartbeat_at timestamptz
);

create index task_executor_sessions_user_updated_idx
  on task_executor_sessions (user_id, updated_at desc);

create table memory_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  type text not null check (
    type in ('profile', 'preferences', 'routines', 'current_context', 'task_history')
  ),
  key text not null,
  value_json jsonb not null,
  summary text not null,
  confidence real not null default 0.5 check (confidence >= 0 and confidence <= 1),
  source_message_id uuid references conversation_messages(id) on delete set null,
  last_used_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, type, key)
);

create index memory_items_user_type_updated_idx
  on memory_items (user_id, type, updated_at desc);

create index memory_items_user_last_used_idx
  on memory_items (user_id, last_used_at desc nulls last);
