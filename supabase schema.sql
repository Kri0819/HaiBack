-- ═══════════════════════════════════════════════════════════════
-- HaiBack｜還袂 — Supabase Schema
-- Run this once in your Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- Records table
create table if not exists public.hb_records (
  id               text        primary key,
  user_id          uuid        not null references auth.users(id) on delete cascade,
  kind             text        not null,                    -- 'reimburse' | 'advance'
  adv_status       text,                                    -- 'pending' | 'rejected' | 'approved' | null
  title            text        not null default '',
  date             text        not null default '',
  note             text        not null default '',
  amount           numeric     not null default 0,
  advance_received numeric     not null default 0,
  actual_spent     numeric     not null default 0,
  settlement_date  text        not null default '',
  payment_records  jsonb       not null default '[]',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Auto-update updated_at
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists hb_records_updated_at on public.hb_records;
create trigger hb_records_updated_at
  before update on public.hb_records
  for each row execute function public.set_updated_at();

-- ── Row Level Security ───────────────────────────────────────
-- Each user can only see and modify their own records.

alter table public.hb_records enable row level security;

-- Drop existing policies if re-running
drop policy if exists "users_select_own" on public.hb_records;
drop policy if exists "users_insert_own" on public.hb_records;
drop policy if exists "users_update_own" on public.hb_records;
drop policy if exists "users_delete_own" on public.hb_records;

create policy "users_select_own"
  on public.hb_records for select
  using (auth.uid() = user_id);

create policy "users_insert_own"
  on public.hb_records for insert
  with check (auth.uid() = user_id);

create policy "users_update_own"
  on public.hb_records for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "users_delete_own"
  on public.hb_records for delete
  using (auth.uid() = user_id);

-- ── Index for faster per-user queries ────────────────────────
create index if not exists hb_records_user_id_idx
  on public.hb_records (user_id, date desc);

-- ═══════════════════════════════════════════════════════════════
-- Supabase Auth Settings (do in Dashboard, not SQL)
-- ═══════════════════════════════════════════════════════════════
--
-- 1. Go to Authentication → Providers → Email
--    ✓ Enable Email provider
--    ✓ Enable "Magic Link" (Email OTP)
--    ✗ Disable "Confirm email" (optional, easier for dev)
--
-- 2. Go to Authentication → URL Configuration
--    Site URL: https://your-app.vercel.app
--    Redirect URLs: https://your-app.vercel.app/**
--
-- 3. Go to Authentication → Email Templates → Magic Link
--    Customize subject/body if you want (optional)
--
-- ═══════════════════════════════════════════════════════════════
-- .env file for your Vite project
-- ═══════════════════════════════════════════════════════════════
--
-- VITE_SUPABASE_URL=https://xxxxx.supabase.co
-- VITE_SUPABASE_ANON_KEY=eyJhbGci...
--
-- ═══════════════════════════════════════════════════════════════
-- npm install
-- ═══════════════════════════════════════════════════════════════
--
-- npm install @supabase/supabase-js
--
