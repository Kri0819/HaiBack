-- HaiBack｜還袂 — migration: feedback table
-- Run once in Supabase SQL Editor

create table if not exists public.hb_feedback (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        references auth.users(id) on delete set null,
  is_guest    boolean     not null default false,
  app_name    text        not null default 'HaiBack',
  app_version text        not null default '',
  platform    text        not null default '',
  type        text        not null,   -- 'bug' | 'feature' | 'other'
  title       text        not null,
  content     text        not null,
  email       text        not null default '',
  created_at  timestamptz not null default now()
);

-- Anyone can insert (including guests), no one can read others' rows
alter table public.hb_feedback enable row level security;

drop policy if exists "anyone_insert_feedback" on public.hb_feedback;
create policy "anyone_insert_feedback"
  on public.hb_feedback for insert
  with check (true);
