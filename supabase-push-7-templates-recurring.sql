-- Friday Push — الجزء 7: قوالب الإشعارات + الإشعارات المتكررة (للأدمن فقط). شغّله بعد الأجزاء 1–3. كل أمر في سطر واحد. الإرسال المتكرر محتاج الجزء 5 (pg_cron + الجدولة) شغّال.

create table if not exists public.friday_notification_templates ( id uuid primary key default gen_random_uuid(), name text not null check (char_length(name) between 1 and 60), title text not null check (char_length(title) between 1 and 100), body text not null check (char_length(body) between 1 and 500), created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now() );

create table if not exists public.friday_notification_rules ( id uuid primary key default gen_random_uuid(), title text not null check (char_length(title) between 1 and 100), body text not null check (char_length(body) between 1 and 500), audience text not null check (audience in ('all','servants','admins','classes','users')), class_ids uuid[] not null default '{}', user_ids uuid[] not null default '{}', days integer[] not null check (cardinality(days) between 1 and 7), time_of_day time not null, is_active boolean not null default true, last_run_date date, created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now() );

alter table public.friday_notification_templates enable row level security;

alter table public.friday_notification_rules enable row level security;

revoke all on table public.friday_notification_templates from anon, authenticated;

revoke all on table public.friday_notification_rules from anon, authenticated;

create or replace function public.friday_admin_templates() returns jsonb language plpgsql security definer set search_path = '' as $$ begin if not public.friday_is_admin() then return jsonb_build_object('ok', false, 'error', 'admin_required'); end if; return jsonb_build_object('ok', true, 'items', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'title', t.title, 'body', t.body) order by t.created_at) from public.friday_notification_templates t), '[]'::jsonb)); end $$;

create or replace function public.friday_admin_save_template(p_name text, p_title text, p_body text) returns jsonb language plpgsql security definer set search_path = '' as $$ declare v uuid; begin if not public.friday_is_admin() then return jsonb_build_object('ok', false, 'error', 'admin_required'); end if; if coalesce(trim(p_name), '') = '' or coalesce(trim(p_title), '') = '' or coalesce(trim(p_body), '') = '' then return jsonb_build_object('ok', false, 'error', 'invalid'); end if; insert into public.friday_notification_templates (name, title, body, created_by) values (left(trim(p_name), 60), left(trim(p_title), 100), left(trim(p_body), 500), auth.uid()) returning id into v; return jsonb_build_object('ok', true, 'id', v); end $$;

create or replace function public.friday_admin_delete_template(p_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $$ begin if not public.friday_is_admin() then return jsonb_build_object('ok', false, 'error', 'admin_required'); end if; delete from public.friday_notification_templates where id = p_id; return jsonb_build_object('ok', true); end $$;

create or replace function public.friday_admin_rules() returns jsonb language plpgsql security definer set search_path = '' as $$ begin if not public.friday_is_admin() then return jsonb_build_object('ok', false, 'error', 'admin_required'); end if; return jsonb_build_object('ok', true, 'items', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'title', r.title, 'body', r.body, 'audience', r.audience, 'class_ids', r.class_ids, 'user_ids', r.user_ids, 'days', r.days, 'time', to_char(r.time_of_day, 'HH24:MI'), 'is_active', r.is_active, 'last_run_date', r.last_run_date) order by r.created_at) from public.friday_notification_rules r), '[]'::jsonb)); end $$;

create or replace function public.friday_admin_save_rule(p_title text, p_body text, p_audience text, p_class_ids uuid[], p_user_ids uuid[], p_days integer[], p_time text) returns jsonb language plpgsql security definer set search_path = '' as $$ declare v uuid; t time; begin if not public.friday_is_admin() then return jsonb_build_object('ok', false, 'error', 'admin_required'); end if; if coalesce(trim(p_title), '') = '' or coalesce(trim(p_body), '') = '' then return jsonb_build_object('ok', false, 'error', 'invalid'); end if; if p_audience not in ('all','servants','admins','classes','users') then return jsonb_build_object('ok', false, 'error', 'invalid_audience'); end if; if p_audience = 'classes' and coalesce(cardinality(p_class_ids), 0) = 0 then return jsonb_build_object('ok', false, 'error', 'classes_required'); end if; if p_audience = 'users' and coalesce(cardinality(p_user_ids), 0) = 0 then return jsonb_build_object('ok', false, 'error', 'users_required'); end if; if coalesce(cardinality(p_days), 0) = 0 or exists (select 1 from unnest(p_days) d where d < 0 or d > 6) then return jsonb_build_object('ok', false, 'error', 'invalid_days'); end if; begin t := p_time::time; exception when others then return jsonb_build_object('ok', false, 'error', 'invalid_time'); end; insert into public.friday_notification_rules (title, body, audience, class_ids, user_ids, days, time_of_day, created_by) values (left(trim(p_title), 100), left(trim(p_body), 500), p_audience, case when p_audience = 'classes' then p_class_ids else '{}' end, case when p_audience = 'users' then p_user_ids else '{}' end, p_days, t, auth.uid()) returning id into v; return jsonb_build_object('ok', true, 'id', v); end $$;

create or replace function public.friday_admin_set_rule_active(p_id uuid, p_active boolean) returns jsonb language plpgsql security definer set search_path = '' as $$ begin if not public.friday_is_admin() then return jsonb_build_object('ok', false, 'error', 'admin_required'); end if; update public.friday_notification_rules set is_active = coalesce(p_active, false) where id = p_id; return jsonb_build_object('ok', true); end $$;

create or replace function public.friday_admin_delete_rule(p_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $$ begin if not public.friday_is_admin() then return jsonb_build_object('ok', false, 'error', 'admin_required'); end if; delete from public.friday_notification_rules where id = p_id; return jsonb_build_object('ok', true); end $$;

create or replace function public.friday_materialize_recurring() returns integer language plpgsql security definer set search_path = '' as $$ declare r record; n integer := 0; nowc timestamp := (now() at time zone 'Africa/Cairo'); today date := (now() at time zone 'Africa/Cairo')::date; begin for r in select * from public.friday_notification_rules where is_active and extract(dow from nowc)::int = any(days) and (last_run_date is null or last_run_date < today) and nowc::time >= time_of_day and nowc::time < time_of_day + interval '3 hours' for update skip locked loop insert into public.friday_notifications (title, body, audience, class_ids, user_ids, screen, created_by, scheduled_for, status) values (r.title, r.body, r.audience, r.class_ids, r.user_ids, 'inbox', r.created_by, now(), 'scheduled'); update public.friday_notification_rules set last_run_date = today where id = r.id; n := n + 1; end loop; return n; end $$;

revoke all on function public.friday_admin_templates() from public, anon;

revoke all on function public.friday_admin_save_template(text, text, text) from public, anon;

revoke all on function public.friday_admin_delete_template(uuid) from public, anon;

revoke all on function public.friday_admin_rules() from public, anon;

revoke all on function public.friday_admin_save_rule(text, text, text, uuid[], uuid[], integer[], text) from public, anon;

revoke all on function public.friday_admin_set_rule_active(uuid, boolean) from public, anon;

revoke all on function public.friday_admin_delete_rule(uuid) from public, anon;

revoke all on function public.friday_materialize_recurring() from public, anon, authenticated;

grant execute on function public.friday_admin_templates() to authenticated;

grant execute on function public.friday_admin_save_template(text, text, text) to authenticated;

grant execute on function public.friday_admin_delete_template(uuid) to authenticated;

grant execute on function public.friday_admin_rules() to authenticated;

grant execute on function public.friday_admin_save_rule(text, text, text, uuid[], uuid[], integer[], text) to authenticated;

grant execute on function public.friday_admin_set_rule_active(uuid, boolean) to authenticated;

grant execute on function public.friday_admin_delete_rule(uuid) to authenticated;

-- تشغيل المتكرر كل دقيقة (بعدها الجزء 5 بيرسل المجدول). محتاج pg_cron.
create extension if not exists pg_cron;

select cron.schedule('friday-materialize-recurring', '* * * * *', $job$ select public.friday_materialize_recurring() $job$);
