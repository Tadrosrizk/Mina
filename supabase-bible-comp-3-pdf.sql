-- Bible Competition — PDF → questions (Part 5). Run ONCE in the Supabase SQL Editor (after the two earlier bible-comp files). Safe to re-run.
-- Only a usage log used by the Edge Function to rate-limit AI calls per admin. Nothing existing is touched.
create table if not exists public.friday_bc_ai_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now());
create index if not exists friday_bc_ai_usage_user_idx on public.friday_bc_ai_usage (user_id, created_at desc);
alter table public.friday_bc_ai_usage enable row level security;
revoke all on table public.friday_bc_ai_usage from public, anon, authenticated;   -- only the Edge Function (service role) reads/writes it
