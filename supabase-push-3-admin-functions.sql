-- Friday Push — الجزء 3: دوال الأدمن فقط (السجل، التفاصيل، الإلغاء، ملخص الأجهزة).

create or replace function public.friday_admin_notifications(p_limit integer default 30) returns jsonb language plpgsql security definer set search_path = '' as $$ begin if not public.friday_is_admin() then return jsonb_build_object('ok', false, 'error', 'admin_required'); end if; return jsonb_build_object('ok', true, 'items', coalesce(( select jsonb_agg(jsonb_build_object('id', q.id, 'title', q.title, 'body', q.body, 'audience', q.audience, 'status', q.status, 'scheduled_for', q.scheduled_for, 'created_at', q.created_at, 'sent_at', q.sent_at, 'recipients_count', q.recipients_count, 'sent_count', q.sent_count, 'failed_count', q.failed_count, 'no_device_count', q.no_device_count, 'error', q.error) order by q.created_at desc) from (select * from public.friday_notifications order by created_at desc limit greatest(1, least(coalesce(p_limit, 30), 100))) q ), '[]'::jsonb)); end $$;

create or replace function public.friday_admin_notification_deliveries(p_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $$ begin if not public.friday_is_admin() then return jsonb_build_object('ok', false, 'error', 'admin_required'); end if; return jsonb_build_object('ok', true, 'items', coalesce(( select jsonb_agg(jsonb_build_object('user_id', d.user_id, 'name', coalesce(p.display_name, ''), 'status', d.status, 'error_code', d.error_code, 'error_message', d.error_message) order by p.display_name) from public.friday_notification_deliveries d left join public.friday_profiles p on p.user_id = d.user_id where d.notification_id = p_id ), '[]'::jsonb)); end $$;

create or replace function public.friday_admin_cancel_notification(p_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $$ declare n integer; begin if not public.friday_is_admin() then return jsonb_build_object('ok', false, 'error', 'admin_required'); end if; update public.friday_notifications set status = 'cancelled' where id = p_id and status = 'scheduled'; get diagnostics n = row_count; return jsonb_build_object('ok', n > 0, 'error', case when n > 0 then null else 'not_cancellable' end); end $$;

create or replace function public.friday_admin_push_overview() returns jsonb language plpgsql security definer set search_path = '' as $$ begin if not public.friday_is_admin() then return jsonb_build_object('ok', false, 'error', 'admin_required'); end if; return jsonb_build_object('ok', true, 'users_total', (select count(*) from public.friday_profiles where is_active), 'users_with_device', (select count(distinct t.user_id) from public.friday_push_tokens t join public.friday_profiles p on p.user_id = t.user_id and p.is_active where t.is_active)); end $$;

revoke all on function public.friday_admin_notifications(integer) from public, anon;

revoke all on function public.friday_admin_notification_deliveries(uuid) from public, anon;

revoke all on function public.friday_admin_cancel_notification(uuid) from public, anon;

revoke all on function public.friday_admin_push_overview() from public, anon;

grant execute on function public.friday_admin_notifications(integer) to authenticated;

grant execute on function public.friday_admin_notification_deliveries(uuid) to authenticated;

grant execute on function public.friday_admin_cancel_notification(uuid) to authenticated;

grant execute on function public.friday_admin_push_overview() to authenticated;
