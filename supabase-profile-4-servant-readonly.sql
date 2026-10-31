-- Friday الملف الشخصي — الجزء 4: الخادم يشوف ملفه فقط، والتعديل للمسؤول بس (على السيرفر، مش بس في الشاشة).
-- آمن: بيستبدل دالتين ويعيد إنشاء سياسات صور الحسابات. مفيش حذف أو تعديل لأي بيانات موجودة. اشتغل بعد الأجزاء 1–3.

-- 1) تعديل الاسم/النوع من الحساب نفسه: للمسؤول فقط (الخادم بيرجعله admin_required)
create or replace function public.friday_update_my_profile(p_display_name text, p_gender text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); nm text;
begin
  if me is null then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;
  if not public.friday_is_admin() then return jsonb_build_object('ok', false, 'error', 'admin_required'); end if;
  if p_display_name is not null then
    nm := btrim(regexp_replace(p_display_name, '\s+', ' ', 'g'));
    if char_length(nm) < 2 or char_length(nm) > 60 then return jsonb_build_object('ok', false, 'error', 'invalid_name'); end if;
  end if;
  if p_gender is not null and p_gender not in ('male','female') then return jsonb_build_object('ok', false, 'error', 'invalid_gender'); end if;
  update public.friday_profiles set display_name = coalesce(nm, display_name), gender = coalesce(p_gender, gender), updated_at = now() where user_id = me;
  return jsonb_build_object('ok', true);
end $$;

-- 2) ربط/فك الصورة الشخصية من الحساب نفسه: للمسؤول فقط
create or replace function public.friday_set_my_avatar(p_set boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); pth text;
begin
  if me is null then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;
  if not public.friday_is_admin() then return jsonb_build_object('ok', false, 'error', 'admin_required'); end if;
  if coalesce(p_set, false) then
    pth := 'avatars/' || me::text || '.jpg';
    if not exists (select 1 from storage.objects where bucket_id = 'friday-photos' and name = pth) then return jsonb_build_object('ok', false, 'error', 'file_missing'); end if;
    update public.friday_profiles set avatar_path = pth, avatar_updated_at = now(), updated_at = now() where user_id = me;
  else
    update public.friday_profiles set avatar_path = null, avatar_updated_at = now(), updated_at = now() where user_id = me;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- 3) رفع/تعديل/حذف ملفات الصور الشخصية: للمسؤول فقط. القراءة تفضل زي ما هي (كل خادم يشوف الصور).
drop policy if exists friday_avatars_insert on storage.objects;
drop policy if exists friday_avatars_update on storage.objects;
drop policy if exists friday_avatars_delete on storage.objects;
create policy friday_avatars_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'friday-photos' and public.friday_avatar_owner(name) is not null and public.friday_is_admin());
create policy friday_avatars_update on storage.objects for update to authenticated
  using (bucket_id = 'friday-photos' and public.friday_avatar_owner(name) is not null and public.friday_is_admin())
  with check (bucket_id = 'friday-photos' and public.friday_avatar_owner(name) is not null and public.friday_is_admin());
create policy friday_avatars_delete on storage.objects for delete to authenticated
  using (bucket_id = 'friday-photos' and public.friday_avatar_owner(name) is not null and public.friday_is_admin());

-- 4) تأكيد: مفيش UPDATE مباشر على جدول الملفات الشخصية لغير المسؤول (للفحص — شغّله لوحده وشوف النتيجة)
-- select policyname, cmd, roles, qual from pg_policies where schemaname = 'public' and tablename = 'friday_profiles';
