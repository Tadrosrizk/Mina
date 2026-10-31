-- Friday الملف الشخصي — الجزء 1 (أعمدة). شغّله الأول. اضغط في مساحة فاضية عشان ماتبقاش فيه نص متحدد قبل Run.
-- ==== PART A: columns ====
alter table public.friday_profiles add column if not exists gender text;
alter table public.friday_profiles add column if not exists avatar_path text;
alter table public.friday_profiles add column if not exists avatar_updated_at timestamptz;
alter table public.friday_profiles drop constraint if exists friday_profiles_gender_check;
alter table public.friday_profiles add constraint friday_profiles_gender_check check (gender is null or gender in ('male','female'));
alter table public.friday_profiles drop constraint if exists friday_profiles_avatar_path_check;
alter table public.friday_profiles add constraint friday_profiles_avatar_path_check check (avatar_path is null or avatar_path = 'avatars/' || user_id::text || '.jpg');

