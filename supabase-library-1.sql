-- Friday مكتبتي — قاعدة البيانات والتخزين. الأدمن يرفع ويعدّل ويمسح، والخدام النشطين يشوفوا وينزّلوا بس. شغّله مرة واحدة في Supabase ← SQL Editor.

create table if not exists public.friday_library_folders ( id uuid primary key default gen_random_uuid(), parent_id uuid references public.friday_library_folders(id) on delete cascade, name text not null check (char_length(name) between 1 and 80), created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now() );

create table if not exists public.friday_library_items ( id uuid primary key default gen_random_uuid(), folder_id uuid references public.friday_library_folders(id) on delete cascade, title text not null check (char_length(title) between 1 and 150), description text not null default '' check (char_length(description) <= 500), storage_path text not null unique, file_name text not null default '', mime text not null default '', size bigint not null default 0, created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now() );

create index if not exists friday_library_items_folder_idx on public.friday_library_items (folder_id, created_at desc);

create index if not exists friday_library_folders_parent_idx on public.friday_library_folders (parent_id);

create or replace function public.friday_library_reader() returns boolean language sql stable security definer set search_path = '' as $$ select exists (select 1 from public.friday_profiles p where p.user_id = auth.uid() and p.is_active) $$;

revoke all on function public.friday_library_reader() from public, anon;

grant execute on function public.friday_library_reader() to authenticated;

alter table public.friday_library_folders enable row level security;

alter table public.friday_library_items enable row level security;

revoke all on table public.friday_library_folders from anon, authenticated;

revoke all on table public.friday_library_items from anon, authenticated;

grant select, insert, update, delete on table public.friday_library_folders to authenticated;

grant select, insert, update, delete on table public.friday_library_items to authenticated;

drop policy if exists friday_lib_folders_select on public.friday_library_folders;

drop policy if exists friday_lib_folders_write on public.friday_library_folders;

drop policy if exists friday_lib_items_select on public.friday_library_items;

drop policy if exists friday_lib_items_write on public.friday_library_items;

create policy friday_lib_folders_select on public.friday_library_folders for select to authenticated using (public.friday_library_reader());

create policy friday_lib_folders_write on public.friday_library_folders for all to authenticated using (public.friday_is_admin()) with check (public.friday_is_admin());

create policy friday_lib_items_select on public.friday_library_items for select to authenticated using (public.friday_library_reader());

create policy friday_lib_items_write on public.friday_library_items for all to authenticated using (public.friday_is_admin()) with check (public.friday_is_admin());

insert into storage.buckets (id, name, public, file_size_limit) values ('friday-library', 'friday-library', false, 52428800) on conflict (id) do update set public = false, file_size_limit = 52428800;

drop policy if exists friday_library_obj_select on storage.objects;

drop policy if exists friday_library_obj_insert on storage.objects;

drop policy if exists friday_library_obj_update on storage.objects;

drop policy if exists friday_library_obj_delete on storage.objects;

create policy friday_library_obj_select on storage.objects for select to authenticated using (bucket_id = 'friday-library' and public.friday_library_reader());

create policy friday_library_obj_insert on storage.objects for insert to authenticated with check (bucket_id = 'friday-library' and public.friday_is_admin());

create policy friday_library_obj_update on storage.objects for update to authenticated using (bucket_id = 'friday-library' and public.friday_is_admin()) with check (bucket_id = 'friday-library' and public.friday_is_admin());

create policy friday_library_obj_delete on storage.objects for delete to authenticated using (bucket_id = 'friday-library' and public.friday_is_admin());
