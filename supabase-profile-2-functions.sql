-- Friday الملف الشخصي — الجزء 2 (دوال). شغّله بعد الجزء 1.
-- ==== PART B: functions ====
create or replace function public.friday_avatar_owner(p_name text)
returns uuid language plpgsql immutable set search_path = '' as $$
begin
  if p_name !~ '^avatars/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$' then return null; end if;
  return substr(p_name, 9, 36)::uuid;
exception when others then return null; end $$;

-- a servant edits ONLY own display name, and gender only while it is still unset (the admin can change it later).
create or replace function public.friday_update_my_profile(p_display_name text, p_gender text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); nm text; cur text;
begin
  if me is null then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;
  select gender into cur from public.friday_profiles where user_id = me and is_active;
  if not found then return jsonb_build_object('ok', false, 'error', 'profile_not_found'); end if;
  if p_display_name is not null then
    nm := btrim(regexp_replace(p_display_name, '\s+', ' ', 'g'));
    if char_length(nm) < 2 or char_length(nm) > 60 then return jsonb_build_object('ok', false, 'error', 'invalid_name'); end if;
  end if;
  if p_gender is not null then
    if p_gender not in ('male','female') then return jsonb_build_object('ok', false, 'error', 'invalid_gender'); end if;
    if cur is not null and cur <> p_gender then return jsonb_build_object('ok', false, 'error', 'gender_locked'); end if;
  end if;
  update public.friday_profiles set display_name = coalesce(nm, display_name), gender = coalesce(gender, p_gender), updated_at = now()
  where user_id = me;
  return jsonb_build_object('ok', true);
end $$;

-- after the image was uploaded to avatars/<me>.jpg, link it (or unlink with p_set=false).
create or replace function public.friday_set_my_avatar(p_set boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); pth text;
begin
  if me is null then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;
  if not exists (select 1 from public.friday_profiles where user_id = me and is_active) then return jsonb_build_object('ok', false, 'error', 'profile_not_found'); end if;
  if coalesce(p_set, false) then
    pth := 'avatars/' || me::text || '.jpg';
    if not exists (select 1 from storage.objects where bucket_id = 'friday-photos' and name = pth) then
      return jsonb_build_object('ok', false, 'error', 'file_missing'); end if;
    update public.friday_profiles set avatar_path = pth, avatar_updated_at = now(), updated_at = now() where user_id = me;
  else
    update public.friday_profiles set avatar_path = null, avatar_updated_at = now(), updated_at = now() where user_id = me;
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.friday_admin_update_profile(p_user uuid, p_display_name text, p_gender text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare nm text;
begin
  if not public.friday_is_admin() then return jsonb_build_object('ok', false, 'error', 'admin_required'); end if;
  if not exists (select 1 from public.friday_profiles where user_id = p_user) then return jsonb_build_object('ok', false, 'error', 'profile_not_found'); end if;
  if p_display_name is not null then
    nm := btrim(regexp_replace(p_display_name, '\s+', ' ', 'g'));
    if char_length(nm) < 2 or char_length(nm) > 60 then return jsonb_build_object('ok', false, 'error', 'invalid_name'); end if;
  end if;
  if p_gender is not null and p_gender not in ('male','female','none') then return jsonb_build_object('ok', false, 'error', 'invalid_gender'); end if;
  update public.friday_profiles set display_name = coalesce(nm, display_name),
    gender = case when p_gender is null then gender when p_gender = 'none' then null else p_gender end, updated_at = now()
  where user_id = p_user;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.friday_admin_set_avatar(p_user uuid, p_set boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare pth text;
begin
  if not public.friday_is_admin() then return jsonb_build_object('ok', false, 'error', 'admin_required'); end if;
  if not exists (select 1 from public.friday_profiles where user_id = p_user) then return jsonb_build_object('ok', false, 'error', 'profile_not_found'); end if;
  if coalesce(p_set, false) then
    pth := 'avatars/' || p_user::text || '.jpg';
    if not exists (select 1 from storage.objects where bucket_id = 'friday-photos' and name = pth) then
      return jsonb_build_object('ok', false, 'error', 'file_missing'); end if;
    update public.friday_profiles set avatar_path = pth, avatar_updated_at = now(), updated_at = now() where user_id = p_user;
  else
    update public.friday_profiles set avatar_path = null, avatar_updated_at = now(), updated_at = now() where user_id = p_user;
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.friday_admin_list_profiles()
returns table (user_id uuid, display_name text, email text, role text, gender text, avatar_path text, avatar_updated_at timestamptz,
               is_active boolean, created_at timestamptz, classes jsonb)
language plpgsql security definer set search_path = '' as $$
begin
  if not public.friday_is_admin() then raise exception 'admin_required' using errcode = '42501'; end if;
  return query
    select p.user_id, p.display_name, u.email::text, p.role, p.gender, p.avatar_path, p.avatar_updated_at, p.is_active, p.created_at,
      coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.name)
                from public.friday_class_servants cs join public.friday_classes c on c.id = cs.class_id
                where cs.servant_user_id = p.user_id), '[]'::jsonb)
    from public.friday_profiles p left join auth.users u on u.id = p.user_id
    order by p.created_at;
end $$;

-- the servant's own classes (read-only on the profile page)
create or replace function public.friday_my_profile_classes()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.name), '[]'::jsonb)
  from public.friday_class_servants cs join public.friday_classes c on c.id = cs.class_id
  where cs.servant_user_id = auth.uid() $$;

revoke all on function public.friday_avatar_owner(text) from public;
revoke all on function public.friday_update_my_profile(text, text) from public;
revoke all on function public.friday_set_my_avatar(boolean) from public;
revoke all on function public.friday_admin_update_profile(uuid, text, text) from public;
revoke all on function public.friday_admin_set_avatar(uuid, boolean) from public;
revoke all on function public.friday_admin_list_profiles() from public;
revoke all on function public.friday_my_profile_classes() from public;
grant execute on function public.friday_avatar_owner(text) to authenticated;
grant execute on function public.friday_update_my_profile(text, text) to authenticated;
grant execute on function public.friday_set_my_avatar(boolean) to authenticated;
grant execute on function public.friday_admin_update_profile(uuid, text, text) to authenticated;
grant execute on function public.friday_admin_set_avatar(uuid, boolean) to authenticated;
grant execute on function public.friday_admin_list_profiles() to authenticated;
grant execute on function public.friday_my_profile_classes() to authenticated;

