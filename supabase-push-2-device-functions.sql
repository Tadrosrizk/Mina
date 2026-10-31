-- Friday Push — الجزء 2: دوال تسجيل جهاز المستخدم وصندوق الإشعارات الواردة (لأي مستخدم مسجّل دخول).

create or replace function public.friday_register_push_token(p_token text, p_platform text default 'android', p_label text default '') returns jsonb language plpgsql security definer set search_path = '' as $$ declare me uuid := auth.uid(); t text := btrim(coalesce(p_token, '')); begin if me is null then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if; if not exists (select 1 from public.friday_profiles where user_id = me and is_active) then return jsonb_build_object('ok', false, 'error', 'profile_not_found'); end if; if char_length(t) < 20 or char_length(t) > 4096 then return jsonb_build_object('ok', false, 'error', 'invalid_token'); end if; if p_platform is null or p_platform not in ('android','ios','web') then return jsonb_build_object('ok', false, 'error', 'invalid_platform'); end if; insert into public.friday_push_tokens (user_id, token, platform, device_label) values (me, t, p_platform, left(coalesce(p_label, ''), 80)) on conflict (token) do update set user_id = me, platform = excluded.platform, device_label = excluded.device_label, is_active = true, failure_count = 0, last_error = null, updated_at = now(), last_seen_at = now(); update public.friday_push_tokens set is_active = false, updated_at = now() where user_id = me and is_active and id not in (select id from public.friday_push_tokens where user_id = me and is_active order by last_seen_at desc limit 5); return jsonb_build_object('ok', true); end $$;

create or replace function public.friday_unregister_push_token(p_token text) returns jsonb language plpgsql security definer set search_path = '' as $$ declare me uuid := auth.uid(); begin if me is null then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if; update public.friday_push_tokens set is_active = false, updated_at = now() where token = btrim(coalesce(p_token, '')) and user_id = me; return jsonb_build_object('ok', true); end $$;

create or replace function public.friday_my_notifications(p_limit integer default 30) returns jsonb language plpgsql security definer set search_path = '' as $$ declare me uuid := auth.uid(); begin if me is null then return '[]'::jsonb; end if; return coalesce(( select jsonb_agg(jsonb_build_object('id', q.id, 'title', q.title, 'body', q.body, 'created_at', q.created_at) order by q.created_at desc) from ( select n.id, n.title, n.body, n.created_at from public.friday_notifications n where n.status in ('sent','partial','failed') and exists (select 1 from public.friday_notification_deliveries d where d.notification_id = n.id and d.user_id = me) order by n.created_at desc limit greatest(1, least(coalesce(p_limit, 30), 100)) ) q ), '[]'::jsonb); end $$;

revoke all on function public.friday_register_push_token(text, text, text) from public, anon;

revoke all on function public.friday_unregister_push_token(text) from public, anon;

revoke all on function public.friday_my_notifications(integer) from public, anon;

grant execute on function public.friday_register_push_token(text, text, text) to authenticated;

grant execute on function public.friday_unregister_push_token(text) to authenticated;

grant execute on function public.friday_my_notifications(integer) to authenticated;
