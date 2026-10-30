create table if not exists model_cache (
  key text primary key,
  response jsonb not null,
  created_at timestamptz not null default now()
);
