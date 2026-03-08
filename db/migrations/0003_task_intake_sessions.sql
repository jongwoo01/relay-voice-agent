alter table tasks
  drop constraint if exists tasks_status_check;

alter table tasks
  add constraint tasks_status_check check (
    status in (
      'created',
      'queued',
      'running',
      'waiting_input',
      'approval_required',
      'completed',
      'failed',
      'cancelled'
    )
  );

alter table task_events
  drop constraint if exists task_events_type_check;

alter table task_events
  add constraint task_events_type_check check (
    type in (
      'task_created',
      'task_queued',
      'task_started',
      'executor_progress',
      'executor_waiting_input',
      'executor_approval_required',
      'executor_completed',
      'executor_failed'
    )
  );

create table if not exists task_intake_sessions (
  brain_session_id text primary key references brain_sessions(id) on delete cascade,
  status text not null check (status in ('collecting', 'ready', 'cancelled')),
  source_text text not null,
  working_text text not null,
  required_slots_json jsonb not null default '[]'::jsonb,
  filled_slots_json jsonb not null default '{}'::jsonb,
  missing_slots_json jsonb not null default '[]'::jsonb,
  last_question text,
  created_at timestamptz not null,
  updated_at timestamptz not null
);
