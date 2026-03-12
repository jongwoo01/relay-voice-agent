alter table tasks
  add column if not exists completion_report_json jsonb;
