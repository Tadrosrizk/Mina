-- Friday Push — الجزء 1: الجداول (أجهزة الإشعارات + الإشعارات + نتائج التسليم). كل أمر في سطر واحد. شغّل الأوامر بالترتيب.

create table if not exists public.friday_push_tokens ( id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, token text not null, platform text not null default 'android' check (platform in ('android','ios','web')), device_label text not null default '', is_active boolean not null default true, failure_count integer not null default 0, last_error text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), last_seen_at timestamptz not null default now(), constraint friday_push_token_unique unique (token) );

create index if not exists friday_push_tokens_user_idx on public.friday_push_tokens (user_id) where is_active;

create table if not exists public.friday_notifications ( id uuid primary key default gen_random_uuid(), title text not null check (char_length(title) between 1 and 100), body text not null check (char_length(body) between 1 and 500), audience text not null check (audience in ('all','servants','admins','classes','users')), class_ids uuid[] not null default '{}', user_ids uuid[] not null default '{}', screen text not null default 'inbox', created_by uuid references auth.users(id) on delete set null, scheduled_for timestamptz, status text not null default 'queued' check (status in ('scheduled','queued','sending','sent','partial','failed','no_recipients','cancelled')), recipients_count integer not null default 0, sent_count integer not null default 0, failed_count integer not null default 0, no_device_count integer not null default 0, error text, created_at timestamptz not null default now(), sent_at timestamptz );

create index if not exists friday_notifications_due_idx on public.friday_notifications (scheduled_for) where status = 'scheduled';

create index if not exists friday_notifications_created_idx on public.friday_notifications (created_at desc);

create table if not exists public.friday_notification_deliveries ( id uuid primary key default gen_random_uuid(), notification_id uuid not null references public.friday_notifications(id) on delete cascade, user_id uuid not null references auth.users(id) on delete cascade, token_id uuid references public.friday_push_tokens(id) on delete set null, status text not null check (status in ('sent_to_provider','failed','invalid_token','no_device')), provider_message_id text, error_code text, error_message text, created_at timestamptz not null default now() );

create index if not exists friday_deliveries_notif_idx on public.friday_notification_deliveries (notification_id);

create index if not exists friday_deliveries_user_idx on public.friday_notification_deliveries (user_id, created_at desc);

alter table public.friday_push_tokens enable row level security;

alter table public.friday_notifications enable row level security;

alter table public.friday_notification_deliveries enable row level security;

revoke all on table public.friday_push_tokens from anon, authenticated;

revoke all on table public.friday_notifications from anon, authenticated;

revoke all on table public.friday_notification_deliveries from anon, authenticated;
