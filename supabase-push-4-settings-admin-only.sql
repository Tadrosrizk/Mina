-- Friday Push — الجزء 4 (اختياري لكن موصى به): جدول الإعدادات يتقرأ لأي مستخدم مسجّل ويتكتب للأدمن بس. شغّل أول سطر (التشخيص) الأول وشوف السياسات الحالية.

select policyname, cmd, roles, qual, with_check from pg_policies where schemaname = 'public' and tablename = 'friday_app_settings';

alter table public.friday_app_settings enable row level security;

do $$ declare r record; begin for r in select policyname from pg_policies where schemaname = 'public' and tablename = 'friday_app_settings' loop execute format('drop policy %I on public.friday_app_settings', r.policyname); end loop; end $$;

create policy friday_settings_read on public.friday_app_settings for select to authenticated using (true);

create policy friday_settings_admin_write on public.friday_app_settings for all to authenticated using (public.friday_is_admin()) with check (public.friday_is_admin());
