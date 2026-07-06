-- HaiBack｜還袂 — v1.2.5 migration: hb_user_settings
-- Run once in Supabase SQL Editor

create table if not exists public.hb_user_settings (
  user_id    uuid        primary key references auth.users(id) on delete cascade,
  tags       text[]      not null default '{}',
  theme      text        not null default 'light',
  updated_at timestamptz not null default now()
);

-- Auto-update updated_at
create or replace function public.set_user_settings_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists hb_user_settings_updated_at on public.hb_user_settings;
create trigger hb_user_settings_updated_at
  before update on public.hb_user_settings
  for each row execute function public.set_user_settings_updated_at();

-- RLS
alter table public.hb_user_settings enable row level security;

drop policy if exists "users_select_own_settings" on public.hb_user_settings;
drop policy if exists "users_insert_own_settings" on public.hb_user_settings;
drop policy if exists "users_update_own_settings" on public.hb_user_settings;

create policy "users_select_own_settings"
  on public.hb_user_settings for select
  using (auth.uid() = user_id);

create policy "users_insert_own_settings"
  on public.hb_user_settings for insert
  with check (auth.uid() = user_id);

create policy "users_update_own_settings"
  on public.hb_user_settings for update
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);
