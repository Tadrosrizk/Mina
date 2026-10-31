-- Bible Competition System — additive only (new tables/functions; nothing existing is touched). Run once in Supabase SQL Editor.
create table if not exists public.friday_bc_questions (
  id uuid primary key default gen_random_uuid(),
  question text not null check (char_length(btrim(question)) between 3 and 400),
  opt1 text not null check (char_length(btrim(opt1)) between 1 and 200),
  opt2 text not null check (char_length(btrim(opt2)) between 1 and 200),
  opt3 text not null check (char_length(btrim(opt3)) between 1 and 200),
  opt4 text not null check (char_length(btrim(opt4)) between 1 and 200),
  correct smallint not null check (correct between 1 and 4),   -- exactly four choices, exactly one correct
  reference text not null default '' check (char_length(reference) <= 120),
  status text not null default 'approved' check (status in ('approved','retired')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint friday_bc_distinct_opts check (lower(btrim(opt1)) <> lower(btrim(opt2)) and lower(btrim(opt1)) <> lower(btrim(opt3)) and lower(btrim(opt1)) <> lower(btrim(opt4))
    and lower(btrim(opt2)) <> lower(btrim(opt3)) and lower(btrim(opt2)) <> lower(btrim(opt4)) and lower(btrim(opt3)) <> lower(btrim(opt4))));
create table if not exists public.friday_bc_competitions (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 2 and 80),
  code text not null unique,
  status text not null default 'pending_review' check (status in ('pending_review','published','live','finished','cancelled')),
  seconds_per_question integer not null default 20 check (seconds_per_question between 10 and 120),
  started_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now());
create table if not exists public.friday_bc_comp_questions (
  competition_id uuid not null references public.friday_bc_competitions(id) on delete cascade,
  pos integer not null check (pos >= 1),
  question_id uuid not null references public.friday_bc_questions(id) on delete restrict,
  primary key (competition_id, pos));
create table if not exists public.friday_bc_participants (
  competition_id uuid not null references public.friday_bc_competitions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null default '',
  joined_at timestamptz not null default now(),
  primary key (competition_id, user_id));
create table if not exists public.friday_bc_answers (
  competition_id uuid not null, user_id uuid not null, pos integer not null,
  choice smallint not null check (choice between 1 and 4),
  is_correct boolean not null, points integer not null default 0, answered_at timestamptz not null default now(),
  primary key (competition_id, user_id, pos),
  foreign key (competition_id, user_id) references public.friday_bc_participants(competition_id, user_id) on delete cascade);
create index if not exists friday_bc_answers_comp_idx on public.friday_bc_answers (competition_id, user_id);
create index if not exists friday_bc_comp_status_idx on public.friday_bc_competitions (status, created_at desc);

-- every table is closed: all access goes through the functions below (answer keys never reach a client)
alter table public.friday_bc_questions enable row level security;
alter table public.friday_bc_competitions enable row level security;
alter table public.friday_bc_comp_questions enable row level security;
alter table public.friday_bc_participants enable row level security;
alter table public.friday_bc_answers enable row level security;
revoke all on table public.friday_bc_questions, public.friday_bc_competitions, public.friday_bc_comp_questions, public.friday_bc_participants, public.friday_bc_answers from public, anon, authenticated;

create or replace function public.friday_bc_add_question(p_question text, p_opts text[], p_correct integer, p_ref text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public.friday_is_admin() then return jsonb_build_object('ok', false, 'error', 'admin_required'); end if;
  if p_opts is null or coalesce(array_length(p_opts, 1), 0) <> 4 or p_correct is null or p_correct not between 1 and 4 then
    return jsonb_build_object('ok', false, 'error', 'need_four_options_one_correct'); end if;
  begin
    insert into public.friday_bc_questions (question, opt1, opt2, opt3, opt4, correct, reference, created_by)
    values (btrim(p_question), btrim(p_opts[1]), btrim(p_opts[2]), btrim(p_opts[3]), btrim(p_opts[4]), p_correct, left(coalesce(p_ref, ''), 120), auth.uid());
  exception when check_violation then return jsonb_build_object('ok', false, 'error', 'invalid_or_duplicate_options'); end;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.friday_bc_generate(p_title text, p_count integer, p_secs integer default 20)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare cid uuid; c text; n int; alpha text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; tries int := 0;
begin
  if not public.friday_is_admin() then return jsonb_build_object('ok', false, 'error', 'admin_required'); end if;
  if p_count is null or p_count not between 3 and 50 then return jsonb_build_object('ok', false, 'error', 'invalid_count'); end if;
  select count(*) into n from public.friday_bc_questions where status = 'approved';
  if n < p_count then return jsonb_build_object('ok', false, 'error', 'not_enough_questions', 'available', n); end if;
  loop
    c := ''; for i in 1..6 loop c := c || substr(alpha, 1 + floor(random() * length(alpha))::int, 1); end loop;
    exit when not exists (select 1 from public.friday_bc_competitions where code = c);
    tries := tries + 1; if tries > 20 then return jsonb_build_object('ok', false, 'error', 'code_failed'); end if;
  end loop;
  insert into public.friday_bc_competitions (title, code, seconds_per_question, created_by)
  values (btrim(p_title), c, least(greatest(coalesce(p_secs, 20), 10), 120), auth.uid()) returning id into cid;
  insert into public.friday_bc_comp_questions (competition_id, pos, question_id)
  select cid, row_number() over (order by random()), id from (select id from public.friday_bc_questions where status = 'approved' order by random() limit p_count) q;
  return jsonb_build_object('ok', true, 'id', cid);
end $$;

-- admin review screen: the full questions WITH the correct answer
create or replace function public.friday_bc_review(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.friday_is_admin() then return jsonb_build_object('ok', false, 'error', 'admin_required'); end if;
  return jsonb_build_object('ok', true, 'items', coalesce((select jsonb_agg(jsonb_build_object('pos', cq.pos, 'question', q.question, 'opts', jsonb_build_array(q.opt1, q.opt2, q.opt3, q.opt4), 'correct', q.correct) order by cq.pos)
    from public.friday_bc_comp_questions cq join public.friday_bc_questions q on q.id = cq.question_id where cq.competition_id = p_id), '[]'::jsonb));
end $$;

create or replace function public.friday_bc_set_status(p_id uuid, p_action text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if not public.friday_is_admin() then return jsonb_build_object('ok', false, 'error', 'admin_required'); end if;
  if p_action = 'publish' then update public.friday_bc_competitions set status = 'published' where id = p_id and status = 'pending_review';
  elsif p_action = 'start' then update public.friday_bc_competitions set status = 'live', started_at = now() where id = p_id and status = 'published';
  elsif p_action = 'cancel' then update public.friday_bc_competitions set status = 'cancelled' where id = p_id and status in ('pending_review','published','live');
  else return jsonb_build_object('ok', false, 'error', 'invalid_action'); end if;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', n > 0, 'error', case when n > 0 then null else 'not_allowed_now' end);
end $$;

create or replace function public.friday_bc_list() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare adm boolean := public.friday_is_admin();
begin
  if auth.uid() is null or not public.friday_is_active_user() then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title, 'status', c.status, 'code', case when adm then c.code else null end,
      'seconds', c.seconds_per_question, 'questions', (select count(*) from public.friday_bc_comp_questions x where x.competition_id = c.id),
      'players', (select count(*) from public.friday_bc_participants p where p.competition_id = c.id),
      'joined', exists (select 1 from public.friday_bc_participants p where p.competition_id = c.id and p.user_id = auth.uid())) order by c.created_at desc)
    from (select * from public.friday_bc_competitions where (adm and status <> 'cancelled') or status in ('published','live','finished') order by created_at desc limit 30) c), '[]'::jsonb);
end $$;

create or replace function public.friday_bc_join(p_code text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare cid uuid; nm text;
begin
  if auth.uid() is null or not public.friday_is_active_user() then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;
  select id into cid from public.friday_bc_competitions where code = upper(btrim(coalesce(p_code, ''))) and status in ('published','live');
  if cid is null then return jsonb_build_object('ok', false, 'error', 'code_not_found'); end if;
  select coalesce(display_name, '') into nm from public.friday_profiles where user_id = auth.uid();
  insert into public.friday_bc_participants (competition_id, user_id, display_name) values (cid, auth.uid(), left(nm, 60)) on conflict do nothing;
  return jsonb_build_object('ok', true, 'id', cid);
end $$;
create or replace function public.friday_bc_join_id(p_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare c text;
begin
  select code into c from public.friday_bc_competitions where id = p_id and status in ('published','live');
  if c is null then return jsonb_build_object('ok', false, 'error', 'code_not_found'); end if;
  return public.friday_bc_join(c);
end $$;

-- the ONE source of truth for "what is on screen now": computed from the server clock, so every player is in sync.
-- each question takes <seconds> to answer + 4 s of reveal.
create or replace function public.friday_bc_current(p_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare c record; total int; el numeric; slot int; idx int; t numeric; q record; ph text;
begin
  if auth.uid() is null or not (public.friday_is_admin() or exists (select 1 from public.friday_bc_participants where competition_id = p_id and user_id = auth.uid())) then
    return jsonb_build_object('ok', false, 'error', 'not_joined'); end if;
  select * into c from public.friday_bc_competitions where id = p_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if c.status in ('published','pending_review') then return jsonb_build_object('ok', true, 'phase', 'lobby', 'status', c.status, 'players', (select count(*) from public.friday_bc_participants where competition_id = p_id)); end if;
  if c.status = 'cancelled' then return jsonb_build_object('ok', true, 'phase', 'cancelled'); end if;
  select count(*) into total from public.friday_bc_comp_questions where competition_id = p_id;
  el := extract(epoch from (now() - c.started_at)); slot := c.seconds_per_question + 4;
  idx := floor(el / slot)::int + 1; t := el - (idx - 1) * slot;
  if c.status = 'finished' or idx > total then
    update public.friday_bc_competitions set status = 'finished' where id = p_id and status = 'live';
    return jsonb_build_object('ok', true, 'phase', 'finished'); end if;
  select q2.question, q2.opt1, q2.opt2, q2.opt3, q2.opt4, q2.correct, q2.reference into q from public.friday_bc_comp_questions cq join public.friday_bc_questions q2 on q2.id = cq.question_id where cq.competition_id = p_id and cq.pos = idx;
  ph := case when t < c.seconds_per_question then 'question' else 'reveal' end;
  return jsonb_build_object('ok', true, 'phase', ph, 'pos', idx, 'total', total, 'seconds_total', c.seconds_per_question,
    'seconds_left', greatest(case when ph = 'question' then c.seconds_per_question - t else slot - t end, 0),
    'question', q.question, 'opts', jsonb_build_array(q.opt1, q.opt2, q.opt3, q.opt4),
    'correct', case when ph = 'reveal' then q.correct else null end, 'reference', case when ph = 'reveal' then q.reference else null end,
    'my_choice', (select choice from public.friday_bc_answers where competition_id = p_id and user_id = auth.uid() and pos = idx));
end $$;

create or replace function public.friday_bc_answer(p_id uuid, p_choice integer) returns jsonb language plpgsql security definer set search_path = '' as $$
declare cur jsonb; idx int; secs int; left_s numeric; corr smallint; ok boolean; pts int; got int;
begin
  if p_choice is null or p_choice not between 1 and 4 then return jsonb_build_object('ok', false, 'error', 'invalid_choice'); end if;
  cur := public.friday_bc_current(p_id);
  if (cur ->> 'ok') <> 'true' or cur ->> 'phase' <> 'question' then return jsonb_build_object('ok', false, 'error', 'not_open'); end if;
  if not exists (select 1 from public.friday_bc_participants where competition_id = p_id and user_id = auth.uid()) then return jsonb_build_object('ok', false, 'error', 'not_joined'); end if;
  idx := (cur ->> 'pos')::int; secs := (cur ->> 'seconds_total')::int; left_s := (cur ->> 'seconds_left')::numeric;
  select q.correct into corr from public.friday_bc_comp_questions cq join public.friday_bc_questions q on q.id = cq.question_id where cq.competition_id = p_id and cq.pos = idx;
  ok := (p_choice = corr); pts := case when ok then 100 + round(50 * left_s / secs)::int else 0 end;
  insert into public.friday_bc_answers (competition_id, user_id, pos, choice, is_correct, points) values (p_id, auth.uid(), idx, p_choice, ok, pts) on conflict do nothing;
  get diagnostics got = row_count;
  if got = 0 then return jsonb_build_object('ok', false, 'error', 'already_answered'); end if;
  return jsonb_build_object('ok', true);   -- correctness is only shown at reveal
end $$;

create or replace function public.friday_bc_leaderboard(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not (public.friday_is_admin() or exists (select 1 from public.friday_bc_participants where competition_id = p_id and user_id = auth.uid())) then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(x order by (x ->> 'score')::int desc, (x ->> 'name')) from (
    select jsonb_build_object('user_id', p.user_id, 'name', p.display_name, 'score', coalesce(sum(a.points), 0)::int, 'correct', count(a.pos) filter (where a.is_correct)) as x
    from public.friday_bc_participants p left join public.friday_bc_answers a on a.competition_id = p.competition_id and a.user_id = p.user_id
    where p.competition_id = p_id group by p.user_id, p.display_name limit 100) s), '[]'::jsonb);
end $$;

do $$ declare f text; begin
  foreach f in array array['friday_bc_add_question(text,text[],integer,text)','friday_bc_generate(text,integer,integer)','friday_bc_review(uuid)','friday_bc_set_status(uuid,text)','friday_bc_list()','friday_bc_join(text)','friday_bc_join_id(uuid)','friday_bc_current(uuid)','friday_bc_answer(uuid,integer)','friday_bc_leaderboard(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop; end $$;
