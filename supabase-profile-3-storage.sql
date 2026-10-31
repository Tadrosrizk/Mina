-- Friday الملف الشخصي — الجزء 3 (صلاحيات تخزين الصور). شغّله بعد الجزء 2.
-- ==== PART C: storage policies (avatars/<user id>.jpg inside the private friday-photos bucket) ====
drop policy if exists friday_avatars_select on storage.objects;
drop policy if exists friday_avatars_insert on storage.objects;
drop policy if exists friday_avatars_update on storage.objects;
drop policy if exists friday_avatars_delete on storage.objects;
create policy friday_avatars_select on storage.objects for select to authenticated
  using (bucket_id = 'friday-photos' and public.friday_avatar_owner(name) is not null);   -- servants see each other's avatars (no private data)
create policy friday_avatars_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'friday-photos' and public.friday_avatar_owner(name) is not null
              and (public.friday_avatar_owner(name) = auth.uid() or public.friday_is_admin()));
create policy friday_avatars_update on storage.objects for update to authenticated
  using (bucket_id = 'friday-photos' and public.friday_avatar_owner(name) is not null
         and (public.friday_avatar_owner(name) = auth.uid() or public.friday_is_admin()))
  with check (bucket_id = 'friday-photos' and public.friday_avatar_owner(name) is not null
         and (public.friday_avatar_owner(name) = auth.uid() or public.friday_is_admin()));
create policy friday_avatars_delete on storage.objects for delete to authenticated
  using (bucket_id = 'friday-photos' and public.friday_avatar_owner(name) is not null
         and (public.friday_avatar_owner(name) = auth.uid() or public.friday_is_admin()));
