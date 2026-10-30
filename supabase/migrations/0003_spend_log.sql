-- Paid-call ledger: every live image call is recorded and checked against LIVE_BUDGET_USD before it runs.
create table spend_log (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  model text not null,
  usd numeric not null,
  note text,
  created_at timestamptz not null default now()
);
alter table spend_log enable row level security;
