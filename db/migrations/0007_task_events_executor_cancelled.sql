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
      'executor_failed',
      'executor_cancelled'
    )
  );
