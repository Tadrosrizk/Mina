-- Bible Competition — Question bank management (Phase 1 completion). Run ONCE in the Supabase SQL Editor, AFTER files 1, 2 and 3. Safe to re-run.
-- Touches ONLY friday_bc_* functions. No table, no row and no column of the app (children, classes, servants, coins, attendance) is touched.
--   * manual questions now go through review: friday_bc_add_question saves 'pending_review' (was: 'approved')
--   * friday_bc_bank_list    : search + filter + paging over the whole bank (admin only)
--   * friday_bc_update_question : edit a question; an edited question goes back to 'pending_review'
--   * friday_bc_review_questions : approve now also accepts rejected ('retired') ones; reject now also accepts approved ones
--   * friday_bc_set_status   : publish/start refuse a competition that contains a question that is no longer approved
--   * add/update refuse a question whose text already exists in the bank (same duplicate key as the Excel import)

-- one shared validator, so add and edit can never disagree about what a valid question is. Returns an error code, or NULL when valid.
create or replace function public.friday_bc_check_question(p_question text, p_opts text[], p_correct integer, p_ref text, p_expl text, p_cat text, p_diff text, p_self uuid)
returns text language plpgsql stable set search_path = '' as $$
declare i int; j int;
begin
  if p_opts is null or coalesce(array_length(p_opts, 1), 0) <> 4 or p_correct is null or p_correct not between 1 and 4 then return 'need_four_options_one_correct'; end if;
  if p_question is null or char_length(btrim(p_question)) not between 3 and 400 then return 'invalid_question'; end if;
  for i in 1..4 loop
    if p_opts[i] is null or char_length(btrim(p_opts[i])) not between 1 and 200 then return 'invalid_or_duplicate_options'; end if;
  end loop;
  for i in 1..3 loop for j in (i + 1)..4 loop
    if lower(btrim(p_opts[i])) = lower(btrim(p_opts[j])) then return 'invalid_or_duplicate_options'; end if;
  end loop; end loop;
  if char_length(coalesce(p_ref, '')) > 120 then return 'invalid_text'; end if;
  if char_length(coalesce(p_expl, '')) > 500 then return 'invalid_text'; end if;
  if char_length(coalesce(p_cat, '')) > 60 then return 'invalid_text'; end if;
  if p_diff is not null and btrim(p_diff) <> '' and lower(btrim(p_diff)) not in ('easy', 'medium', 'hard') then return 'invalid_text'; end if;
  if exists (select 1 from public.friday_bc_questions q where public.friday_bc_norm(q.question) = public.friday_bc_norm(p_question) and (p_self is null or q.id <> p_self)) then return 'duplicate_question'; end if;
  return null;
end $$;

-- same signature as before (the app keeps working); the only change: the question starts as 'pending_review'
create or replace function public.friday_bc_add_question(p_question text, p_opts text[], p_correct integer, p_ref text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare e text; nid uuid;
begin
  if not public.friday_is_admin() then return jsonb_build_object('ok', false, 'error', 'admin_required'); end if;
  e := public.friday_bc_check_question(p_question, p_opts, p_correct, left(coalesce(p_ref, ''), 120), '', '', null, null);
  if e is not null then return jsonb_build_object('ok', false, 'error', e); end if;
  begin
    insert into public.friday_bc_questions (question, opt1, opt2, opt3, opt4, correct, reference, status, created_by)
    values (btrim(p_question), btrim(p_opts[1]), btrim(p_opts[2]), btrim(p_opts[3]), btrim(p_opts[4]), p_correct, left(coalesce(p_ref, ''), 120), 'pending_review', auth.uid())
    returning id into nid;
  exception when check_violation then return jsonb_build_object('ok', false, 'error', 'invalid_or_duplicate_options'); end;
  return jsonb_build_object('ok', true, 'id', nid, 'status', 'pending_review');
end $$;

create or replace function public.friday_bc_update_question(p_id uuid, p_question text, p_opts text[], p_correct integer, p_ref text default '', p_expl text default '', p_cat text default '', p_diff text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare e text; d text; n int;
begin
  if not public.friday_is_admin() then return jsonb_build_object('ok', false, 'error', 'admin_required'); end if;
  if p_id is null or not exists (select 1 from public.friday_bc_questions where id = p_id) then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  -- a question that sits in a competition (any that is not cancelled) is frozen: editing it would silently change a quiz people are playing or have played
  if exists (select 1 from public.friday_bc_comp_questions cq join public.friday_bc_competitions c on c.id = cq.competition_id where cq.question_id = p_id and c.status <> 'cancelled') then
    return jsonb_build_object('ok', false, 'error', 'in_use'); end if;
  d := lower(btrim(coalesce(p_diff, '')));
  e := public.friday_bc_check_question(p_question, p_opts, p_correct, p_ref, p_expl, p_cat, d, p_id);
  if e is not null then return jsonb_build_object('ok', false, 'error', e); end if;
  begin
    update public.friday_bc_questions set question = btrim(p_question), opt1 = btrim(p_opts[1]), opt2 = btrim(p_opts[2]), opt3 = btrim(p_opts[3]), opt4 = btrim(p_opts[4]),
      correct = p_correct, reference = btrim(coalesce(p_ref, '')), explanation = btrim(coalesce(p_expl, '')), category = btrim(coalesce(p_cat, '')),
      difficulty = nullif(d, ''), status = 'pending_review'                      -- every edit needs a fresh approval
    where id = p_id;
  exception when check_violation then return jsonb_build_object('ok', false, 'error', 'invalid_or_duplicate_options'); end;
  return jsonb_build_object('ok', true, 'status', 'pending_review');
end $$;

-- search / filter / paging. Search matches question, the four choices, reference, category and explanation. LIKE wildcards typed by the admin are escaped.
create or replace function public.friday_bc_bank_list(p_search text default '', p_status text default 'all', p_category text default '', p_difficulty text default '', p_limit integer default 20, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare s text := btrim(coalesce(p_search, '')); pat text; lim int := least(greatest(coalesce(p_limit, 20), 1), 50); off int := greatest(coalesce(p_offset, 0), 0); tot int;
begin
  if not public.friday_is_admin() then return jsonb_build_object('ok', false, 'error', 'admin_required'); end if;
  if coalesce(p_status, 'all') not in ('all', 'approved', 'pending_review', 'retired') then return jsonb_build_object('ok', false, 'error', 'invalid_filter'); end if;
  if coalesce(p_difficulty, '') not in ('', 'easy', 'medium', 'hard', 'none') then return jsonb_build_object('ok', false, 'error', 'invalid_filter'); end if;
  if char_length(s) > 100 then s := left(s, 100); end if;
  pat := '%' || replace(replace(replace(s, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  select count(*) into tot from public.friday_bc_questions q
   where (coalesce(p_status, 'all') = 'all' or q.status = p_status)
     and (coalesce(p_category, '') = '' or q.category = p_category)
     and (coalesce(p_difficulty, '') = '' or (p_difficulty = 'none' and q.difficulty is null) or q.difficulty = p_difficulty)
     and (s = '' or q.question ilike pat or q.opt1 ilike pat or q.opt2 ilike pat or q.opt3 ilike pat or q.opt4 ilike pat or q.reference ilike pat or q.category ilike pat or q.explanation ilike pat);
  return jsonb_build_object('ok', true, 'total', tot,
    'counts', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (select status, count(*) n from public.friday_bc_questions group by status) c),
    'categories', (select coalesce(jsonb_agg(category order by category), '[]'::jsonb) from (select distinct category from public.friday_bc_questions where category <> '') c),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'question', x.question, 'opts', jsonb_build_array(x.opt1, x.opt2, x.opt3, x.opt4), 'correct', x.correct,
        'reference', x.reference, 'explanation', x.explanation, 'category', x.category, 'difficulty', x.difficulty, 'status', x.status,
        'in_use', exists (select 1 from public.friday_bc_comp_questions cq join public.friday_bc_competitions c on c.id = cq.competition_id where cq.question_id = x.id and c.status <> 'cancelled')) order by x.created_at desc, x.id)
      from (select * from public.friday_bc_questions q
             where (coalesce(p_status, 'all') = 'all' or q.status = p_status)
               and (coalesce(p_category, '') = '' or q.category = p_category)
               and (coalesce(p_difficulty, '') = '' or (p_difficulty = 'none' and q.difficulty is null) or q.difficulty = p_difficulty)
               and (s = '' or q.question ilike pat or q.opt1 ilike pat or q.opt2 ilike pat or q.opt3 ilike pat or q.opt4 ilike pat or q.reference ilike pat or q.category ilike pat or q.explanation ilike pat)
             order by q.created_at desc, q.id limit lim offset off) x), '[]'::jsonb));
end $$;

-- approve: pending -> approved, rejected -> approved.   reject: pending -> retired, approved -> retired.   (a row already in the target state is simply not counted)
create or replace function public.friday_bc_review_questions(p_ids uuid[], p_action text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if not public.friday_is_admin() then return jsonb_build_object('ok', false, 'error', 'admin_required'); end if;
  if p_action not in ('approve', 'reject') or p_action is null then return jsonb_build_object('ok', false, 'error', 'invalid_action'); end if;
  if p_ids is null or coalesce(array_length(p_ids, 1), 0) = 0 or array_length(p_ids, 1) > 100 then return jsonb_build_object('ok', false, 'error', 'invalid_row_count'); end if;
  if p_action = 'approve' then update public.friday_bc_questions set status = 'approved' where id = any(p_ids) and status in ('pending_review', 'retired');
  else update public.friday_bc_questions set status = 'retired' where id = any(p_ids) and status in ('pending_review', 'approved'); end if;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'changed', n);
end $$;

-- publish / start now re-check that EVERY question in the competition is still approved
create or replace function public.friday_bc_set_status(p_id uuid, p_action text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if not public.friday_is_admin() then return jsonb_build_object('ok', false, 'error', 'admin_required'); end if;
  if p_action in ('publish', 'start') and exists (select 1 from public.friday_bc_comp_questions cq join public.friday_bc_questions q on q.id = cq.question_id where cq.competition_id = p_id and q.status <> 'approved') then
    return jsonb_build_object('ok', false, 'error', 'has_unapproved_questions'); end if;
  if p_action = 'publish' then update public.friday_bc_competitions set status = 'published' where id = p_id and status = 'pending_review';
  elsif p_action = 'start' then update public.friday_bc_competitions set status = 'live', started_at = now() where id = p_id and status = 'published';
  elsif p_action = 'cancel' then update public.friday_bc_competitions set status = 'cancelled' where id = p_id and status in ('pending_review','published','live');
  else return jsonb_build_object('ok', false, 'error', 'invalid_action'); end if;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', n > 0, 'error', case when n > 0 then null else 'not_allowed_now' end);
end $$;

revoke all on function public.friday_bc_check_question(text, text[], integer, text, text, text, text, uuid) from public, anon, authenticated;
do $$ declare f text; begin
  foreach f in array array['friday_bc_add_question(text,text[],integer,text)', 'friday_bc_update_question(uuid,text,text[],integer,text,text,text,text)', 'friday_bc_bank_list(text,text,text,text,integer,integer)',
                           'friday_bc_review_questions(uuid[],text)', 'friday_bc_set_status(uuid,text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop; end $$;
