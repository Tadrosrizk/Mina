-- نشاط الخدام (آخر دخول + مدة الاستخدام) — للأدمن بس
-- شغّل كل جزء لوحده في Supabase SQL Editor (الجزء 1 ثم 2 ثم 3)

-- ===== الجزء 1: الجدول =====
create table if not exists public.friday_user_activity (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_login_at timestamptz,
  last_seen_at timestamptz,
  last_session_seconds integer not null default 0,
  total_seconds bigint not null default 0,
  sessions_count integer not null default 0
);
alter table public.friday_user_activity enable row level security;

-- ===== الجزء 2: تسجيل النشاط =====
create or replace function public.friday_activity_ping(p_kind text, p_seconds integer default 0)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_sec integer := least(greatest(coalesce(p_seconds, 0), 0), 300);
begin
  if v_uid is null then
    return;
  end if;
  if p_kind = 'start' then
    insert into public.friday_user_activity as a (user_id, last_login_at, last_seen_at, last_session_seconds, total_seconds, sessions_count)
    values (v_uid, now(), now(), 0, 0, 1)
    on conflict (user_id) do update
      set last_login_at = now(), last_seen_at = now(), last_session_seconds = 0, sessions_count = a.sessions_count + 1;
  else
    insert into public.friday_user_activity as a (user_id, last_login_at, last_seen_at, last_session_seconds, total_seconds, sessions_count)
    values (v_uid, now(), now(), v_sec, v_sec, 1)
    on conflict (user_id) do update
      set last_seen_at = now(), last_session_seconds = a.last_session_seconds + v_sec, total_seconds = a.total_seconds + v_sec;
  end if;
end;
$$;
grant execute on function public.friday_activity_ping(text, integer) to authenticated;

-- ===== الجزء 3: قراءة النشاط (للأدمن بس) =====
create or replace function public.friday_admin_activity()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.friday_profiles me
    where me.user_id = auth.uid() and me.role::text = 'admin' and me.is_active
  ) then
    raise exception 'admin_required';
  end if;
  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'user_id', p.user_id,
        'display_name', p.display_name,
        'email', p.email,
        'role', p.role::text,
        'is_active', p.is_active,
        'last_login_at', a.last_login_at,
        'last_seen_at', a.last_seen_at,
        'last_session_seconds', coalesce(a.last_session_seconds, 0),
        'total_seconds', coalesce(a.total_seconds, 0),
        'sessions_count', coalesce(a.sessions_count, 0)
      )
      order by a.last_login_at desc nulls last, p.display_name
    )
    from public.friday_profiles p
    left join public.friday_user_activity a on a.user_id = p.user_id
  ), '[]'::jsonb);
end;
$$;
grant execute on function public.friday_admin_activity() to authenticated;
