-- ═══════════════════════════════════════════════════════════════
-- HaiBack｜還袂 — v1.1.0 Migration: Add tags column
-- Run this once in your Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════

alter table public.hb_records
  add column if not exists tags jsonb not null default '[]';
