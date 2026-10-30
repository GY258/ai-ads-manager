-- Core schema. Every table: id, created_at, updated_at, user_id (single demo user in v1).

create table if not exists app_users (
  id uuid primary key,
  name text not null,
  created_at timestamptz not null default now()
);

create type brand_status as enum ('researching', 'draft', 'confirmed', 'failed');
create type campaign_status as enum ('researching', 'active', 'archived');
create type ad_status as enum ('draft', 'approved', 'rejected');
create type variant_status as enum ('queued', 'generating_scene', 'composing', 'ready', 'failed');
create type qa_status as enum ('pass', 'warn', 'fail', 'skipped');
create type ad_angle as enum ('social_proof', 'gift', 'problem_solution', 'lifestyle', 'offer', 'feature');
create type ad_layout as enum ('top_headline', 'bottom_card', 'split');

create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create table brands (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id),
  url text not null,
  domain text not null unique,
  name text,
  logo_path text,
  colors jsonb not null default '[]',
  fonts jsonb not null default '[]',
  voice text,
  value_prop text,
  audience text,
  tone_words text[] not null default '{}',
  source jsonb not null default '{}',
  status brand_status not null default 'researching',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table products (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id),
  brand_id uuid not null references brands(id) on delete cascade,
  source_id text not null,
  handle text,
  title text not null,
  description text,
  price numeric,
  currency text,
  url text,
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id, source_id)
);

create table product_images (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id),
  product_id uuid not null references products(id) on delete cascade,
  source_url text not null,
  storage_path text,
  width int,
  height int,
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, position)
);

create table campaigns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id),
  brand_id uuid references brands(id) on delete set null,
  store_url text not null,
  name text not null,
  goal text,
  offer text,
  product_ids uuid[] not null default '{}',
  constraints jsonb not null default '[]',
  status campaign_status not null default 'researching',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table ads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  product_id uuid not null references products(id),
  product_image_id uuid not null references product_images(id),
  angle ad_angle not null,
  headline text not null,
  cta text not null,
  subhead text,
  layout ad_layout not null,
  scene_prompt text not null,
  status ad_status not null default 'draft',
  current_variant_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table ad_variants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id),
  ad_id uuid not null references ads(id) on delete cascade,
  parent_variant_id uuid references ad_variants(id),
  scene_path text,
  final_path text,
  prompt text,
  model text,
  seed bigint,
  layout ad_layout not null,
  copy jsonb not null,
  status variant_status not null default 'queued',
  error text,
  qa jsonb not null default '{}',
  qa_status qa_status,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table ads add constraint ads_current_variant_fk foreign key (current_variant_id) references ad_variants(id) on delete set null;

create table feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  ad_id uuid references ads(id) on delete cascade,
  variant_id uuid references ad_variants(id) on delete set null,
  text text not null,
  parsed jsonb not null default '{}',
  applied boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  message_id text not null,
  message jsonb not null,
  seq int not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, message_id)
);

create table events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  type text not null,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table tool_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id),
  campaign_id uuid references campaigns(id) on delete cascade,
  tool text not null,
  input jsonb,
  output jsonb,
  error text,
  duration_ms int,
  model_calls int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on products (brand_id);
create index on product_images (product_id);
create index on ads (campaign_id);
create index on ad_variants (ad_id);
create index on feedback (campaign_id);
create index on chat_messages (campaign_id, seq);
create index on events (campaign_id, created_at);
create index on tool_runs (campaign_id);

do $$
declare t text;
begin
  foreach t in array array['brands','products','product_images','campaigns','ads','ad_variants','feedback','chat_messages','events','tool_runs'] loop
    execute format('create trigger %I_touch before update on %I for each row execute function touch_updated_at()', t, t);
  end loop;
end $$;

-- Demo user (v1 has a single user; see DECISIONS.md for the RLS needed for real auth).
insert into app_users (id, name) values ('00000000-0000-4000-8000-000000000001', 'Demo') on conflict do nothing;

-- Supabase exposes `public` over PostgREST. The app only talks to Postgres from the server
-- (bypassing RLS as the table owner), so enable RLS with no policies: anon/authenticated get nothing.
do $$
declare t text;
begin
  foreach t in array array['app_users','brands','products','product_images','campaigns','ads','ad_variants','feedback','chat_messages','events','tool_runs','model_cache','_migrations'] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;
