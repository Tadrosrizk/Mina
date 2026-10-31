-- Friday Coins — الجزء الأول (جداول). شغّله الأول، وبعده الجزء التاني. تأكد إن مفيش نص متحدد قبل Run.
-- ==== PART 1: columns + tables (no functions here) ====

alter table public.friday_classes add column if not exists is_points_enabled boolean not null default false;

create table if not exists public.friday_coin_values (
  reason text primary key check (reason in ('Liturgy','Service','Behavior','Interaction')),
  amount integer not null check (amount between 1 and 1000),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.friday_coin_values (reason, amount)
values ('Liturgy', 10), ('Service', 10), ('Behavior', 5), ('Interaction', 5)
on conflict (reason) do nothing;

create table if not exists public.friday_points_log (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references public.friday_children(id) on delete restrict,
  class_id uuid not null references public.friday_classes(id) on delete restrict,
  servant_id uuid references auth.users(id) on delete set null,
  amount integer not null,
  reason text not null check (reason in ('Liturgy','Service','Behavior','Interaction','Previous Balance','Correction')),
  evaluation_week date,
  notes text not null default '',
  corrects_id uuid references public.friday_points_log(id) on delete restrict,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  constraint friday_points_idem unique (idempotency_key),
  constraint friday_points_week_is_friday check (evaluation_week is null or extract(dow from evaluation_week) = 5),
  constraint friday_points_amount_rule check (
       (reason in ('Liturgy','Service','Behavior','Interaction') and amount between 1 and 1000 and evaluation_week is not null)
    or (reason = 'Previous Balance' and amount between 0 and 1000000)
    or (reason = 'Correction' and amount <> 0 and abs(amount) <= 1000000 and char_length(btrim(notes)) >= 3)
  )
);
create unique index if not exists friday_points_one_per_week
  on public.friday_points_log (child_id, reason, evaluation_week)
  where reason in ('Liturgy','Service','Behavior','Interaction');
create unique index if not exists friday_points_one_previous
  on public.friday_points_log (child_id) where reason = 'Previous Balance';
create index if not exists friday_points_child_idx on public.friday_points_log (child_id);
create index if not exists friday_points_class_week_idx on public.friday_points_log (class_id, evaluation_week);
create index if not exists friday_points_created_idx on public.friday_points_log (created_at desc);

create table if not exists public.friday_coin_audit (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  class_id uuid references public.friday_classes(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.friday_coin_values enable row level security;
alter table public.friday_points_log enable row level security;
alter table public.friday_coin_audit enable row level security;
