-- Friday Push — الجزء 6: حالة "اتقرأ" لكل مستلم + عدّاد غير المقروء (الإشعارات داخل التطبيق). شغّله بعد الأجزاء 1–3.
-- آمن: بيضيف عمود واحد ودوال. الإشعارات القديمة بتتعلّم "مقروءة" مرة واحدة بس عند إضافة العمود عشان ما تظهرش كلها غير مقروءة.

do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'friday_notification_deliveries' and column_name = 'read_at') then
    alter table public.friday_notification_deliveries add column read_at timestamptz;
    update public.friday_notification_deliveries set read_at = now() where read_at is null;
  end if;
end $$;

create index if not exists friday_deliveries_unread_idx on public.friday_notification_deliveries (user_id) where read_at is null;

-- صندوق الوارد: إشعار واحد لكل رسالة (حتى لو للمستخدم أكتر من جهاز) + حالة القراءة
create or replace function public.friday_my_notifications(p_limit integer default 30)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if me is null then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', q.id, 'title', q.title, 'body', q.body, 'created_at', q.created_at, 'read', q.is_read) order by q.created_at desc)
    from (
      select n.id, n.title, n.body, n.created_at, bool_and(d.read_at is not null) as is_read
      from public.friday_notifications n
      join public.friday_notification_deliveries d on d.notification_id = n.id and d.user_id = me
      where n.status in ('sent','partial','failed')
      group by n.id, n.title, n.body, n.created_at
      order by n.created_at desc
      limit greatest(1, least(coalesce(p_limit, 30), 100))
    ) q), '[]'::jsonb);
end $$;

create or replace function public.friday_my_unread_count()
returns integer language plpgsql stable security definer set search_path = '' as $$
declare me uuid := auth.uid(); c integer;
begin
  if me is null then return 0; end if;
  select count(distinct d.notification_id) into c
  from public.friday_notification_deliveries d join public.friday_notifications n on n.id = d.notification_id
  where d.user_id = me and d.read_at is null and n.status in ('sent','partial','failed');
  return coalesce(c, 0);
end $$;

-- p_ids = null => كل إشعارات المستخدم نفسه. بيعدّل صفوف المستخدم نفسه بس.
create or replace function public.friday_mark_notifications_read(p_ids uuid[] default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); n integer;
begin
  if me is null then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;
  update public.friday_notification_deliveries set read_at = now()
  where user_id = me and read_at is null and (p_ids is null or notification_id = any(p_ids));
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'marked', n);
end $$;

-- الأدمن: تفاصيل التسليم + مين قرأ
create or replace function public.friday_admin_notification_deliveries(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public.friday_is_admin() then return jsonb_build_object('ok', false, 'error', 'admin_required'); end if;
  return jsonb_build_object('ok', true, 'items', coalesce((
    select jsonb_agg(jsonb_build_object('user_id', d.user_id, 'name', coalesce(p.display_name, ''), 'status', d.status, 'error_code', d.error_code, 'error_message', d.error_message, 'read_at', d.read_at) order by p.display_name)
    from public.friday_notification_deliveries d left join public.friday_profiles p on p.user_id = d.user_id where d.notification_id = p_id), '[]'::jsonb));
end $$;

revoke all on function public.friday_my_notifications(integer) from public, anon;
revoke all on function public.friday_my_unread_count() from public, anon;
revoke all on function public.friday_mark_notifications_read(uuid[]) from public, anon;
revoke all on function public.friday_admin_notification_deliveries(uuid) from public, anon;
grant execute on function public.friday_my_notifications(integer) to authenticated;
grant execute on function public.friday_my_unread_count() to authenticated;
grant execute on function public.friday_mark_notifications_read(uuid[]) to authenticated;
grant execute on function public.friday_admin_notification_deliveries(uuid) to authenticated;
