-- Bible Competition — Excel question import (Part 4).
-- Run ONCE in the Supabase SQL Editor, AFTER supabase-bible-comp-1.sql. Safe to re-run.
-- Additive: new columns + new functions. No existing row is updated, deleted or overwritten.
--   * friday_bc_questions gets: explanation, category, difficulty, and a new status 'pending_review'
--   * imported questions are ALWAYS saved as 'pending_review' (friday_bc_generate only draws 'approved', so they never reach a competition unreviewed)
--   * the server re-validates every row itself — it never trusts the app's preview

alter table public.friday_bc_questions add column if not exists explanation text not null default '';
alter table public.friday_bc_questions add column if not exists category text not null default '';
alter table public.friday_bc_questions add column if not exists difficulty text;   -- NULL for questions added before this feature

do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.friday_bc_questions'::regclass and conname = 'friday_bc_q_explanation_len') then
    alter table public.friday_bc_questions add constraint friday_bc_q_explanation_len check (char_length(explanation) <= 500); end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.friday_bc_questions'::regclass and conname = 'friday_bc_q_category_len') then
    alter table public.friday_bc_questions add constraint friday_bc_q_category_len check (char_length(category) <= 60); end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.friday_bc_questions'::regclass and conname = 'friday_bc_q_difficulty_values') then
    alter table public.friday_bc_questions add constraint friday_bc_q_difficulty_values check (difficulty is null or difficulty in ('easy', 'medium', 'hard')); end if;
end $$;

-- allow the new status (drops whatever CHECK currently guards "status", then re-adds it with 'pending_review' included)
do $$ declare c text; begin
  for c in select conname from pg_constraint where conrelid = 'public.friday_bc_questions'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%status%' loop
    execute format('alter table public.friday_bc_questions drop constraint %I', c);
  end loop;
  alter table public.friday_bc_questions add constraint friday_bc_questions_status_check check (status in ('approved', 'retired', 'pending_review'));
end $$;

-- Duplicate key for a question: Arabic diacritics/tatweel dropped, alef/ya variants unified, spaces + punctuation + invisible marks removed, lower-cased.
-- (www/bible-comp-import.js normText() does the same; if the two ever differ slightly, THIS function decides.)
create or replace function public.friday_bc_norm(t text) returns text language sql immutable set search_path = '' as $$
  select lower(regexp_replace(
    translate(coalesce(t, ''),
      U&'\0623\0625\0622\0649\064B\064C\064D\064E\064F\0650\0651\0652\0670\0640\061F\060C\061B\00AB\00BB\201C\201D\2018\2019\2026\00A0\200B\200E\200F\FEFF',
      U&'\0627\0627\0627\064A'),
    '[[:space:][:punct:]]+', '', 'g'))
$$;

-- preview step: which of these question texts already exist in the bank (ANY status, retired included)? Returns indexes + status only, never answers.
create or replace function public.friday_bc_find_duplicates(p_questions text[]) returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.friday_is_admin() then return jsonb_build_object('ok', false, 'error', 'admin_required'); end if;
  if p_questions is null or coalesce(array_length(p_questions, 1), 0) > 500 then return jsonb_build_object('ok', false, 'error', 'too_many_rows'); end if;
  return jsonb_build_object('ok', true, 'items', coalesce((
    select jsonb_agg(jsonb_build_object('i', t.i, 'status', b.status) order by t.i)
    from unnest(p_questions) with ordinality as t(txt, i)
    join (select distinct on (x.n) x.n, x.status
            from (select public.friday_bc_norm(question) as n, status, created_at from public.friday_bc_questions) x
           order by x.n, x.created_at) b on b.n = public.friday_bc_norm(t.txt)
    where public.friday_bc_norm(t.txt) <> ''), '[]'::jsonb));
end $$;

-- the import. p_rows = [{row, question, opts:[4], correct:1-4, reference, explanation, category, difficulty}], max 500.
-- Each row is validated on its own: valid rows are inserted as 'pending_review', invalid/duplicate rows are skipped and reported. INSERT only — never UPDATE/DELETE/overwrite.
create or replace function public.friday_bc_import_questions(p_rows jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r jsonb; rn int; n_ok int := 0; rej jsonb := '[]'::jsonb; why text[];
  q text; o text[]; ci int; refx text; ex text; cat text; dif text; nq text;
  known text[]; batch text[] := '{}'; i int; j int; labels text[] := array['A', 'B', 'C', 'D'];
begin
  if not public.friday_is_admin() then return jsonb_build_object('ok', false, 'error', 'admin_required'); end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then return jsonb_build_object('ok', false, 'error', 'invalid_payload'); end if;
  if jsonb_array_length(p_rows) = 0 or jsonb_array_length(p_rows) > 500 then return jsonb_build_object('ok', false, 'error', 'invalid_row_count'); end if;
  perform pg_advisory_xact_lock(hashtext('friday_bc_import'));            -- two admins importing at once can't both insert the same question
  select coalesce(array_agg(public.friday_bc_norm(question)), '{}') into known from public.friday_bc_questions;

  for r in select value from jsonb_array_elements(p_rows) loop
    why := '{}';
    rn := coalesce(nullif(left(regexp_replace(coalesce(r ->> 'row', ''), '[^0-9]', '', 'g'), 9), '')::int, 0);
    q := btrim(coalesce(r ->> 'question', ''));
    refx := btrim(coalesce(r ->> 'reference', ''));
    ex := btrim(coalesce(r ->> 'explanation', ''));
    cat := btrim(coalesce(r ->> 'category', ''));
    dif := lower(btrim(coalesce(r ->> 'difficulty', '')));

    if q = '' then why := array_append(why, 'q_missing'); elsif char_length(q) < 3 then why := array_append(why, 'q_short'); elsif char_length(q) > 400 then why := array_append(why, 'q_long'); end if;

    -- exactly four choices
    if (case when jsonb_typeof(r -> 'opts') = 'array' then jsonb_array_length(r -> 'opts') else -1 end) <> 4 then   -- CASE: never call array_length on a non-array
      why := array_append(why, 'opts_not_four');
    else
      o := array[btrim(coalesce(r -> 'opts' ->> 0, '')), btrim(coalesce(r -> 'opts' ->> 1, '')), btrim(coalesce(r -> 'opts' ->> 2, '')), btrim(coalesce(r -> 'opts' ->> 3, ''))];
      for i in 1..4 loop
        if o[i] = '' then why := array_append(why, 'opt_missing:' || labels[i]); elsif char_length(o[i]) > 200 then why := array_append(why, 'opt_long:' || labels[i]); end if;
      end loop;
      if not (o[1] = '' or o[2] = '' or o[3] = '' or o[4] = '') then
        for i in 1..3 loop for j in (i + 1)..4 loop
          if lower(o[i]) = lower(o[j]) and not ('opts_duplicate' = any(why)) then why := array_append(why, 'opts_duplicate'); end if;
        end loop; end loop;
      end if;
    end if;

    -- exactly one correct answer: a single number 1..4
    if coalesce(r ->> 'correct', '') ~ '^[1-4]$' then ci := (r ->> 'correct')::int; else ci := null; why := array_append(why, 'correct_invalid'); end if;

    if char_length(refx) > 120 then why := array_append(why, 'ref_long'); end if;
    if char_length(ex) > 500 then why := array_append(why, 'expl_long'); end if;
    if cat = '' then why := array_append(why, 'cat_missing'); elsif char_length(cat) > 60 then why := array_append(why, 'cat_long'); end if;
    if dif = '' then why := array_append(why, 'diff_missing'); elsif dif not in ('easy', 'medium', 'hard') then why := array_append(why, 'diff_invalid'); end if;

    -- duplicates: against questions saved earlier in THIS import, then against the whole bank (any status)
    nq := public.friday_bc_norm(q);
    if nq <> '' then
      if nq = any(batch) then why := array_append(why, 'dup_file'); elsif nq = any(known) then why := array_append(why, 'dup_bank'); end if;
    end if;

    if cardinality(why) = 0 then
      begin
        insert into public.friday_bc_questions (question, opt1, opt2, opt3, opt4, correct, reference, explanation, category, difficulty, status, created_by, created_at)
        values (q, o[1], o[2], o[3], o[4], ci, refx, ex, cat, dif, 'pending_review', auth.uid(), clock_timestamp());   -- clock_timestamp: keeps the file's row order for review
        n_ok := n_ok + 1; batch := array_append(batch, nq);
      exception when check_violation then why := array_append(why, 'db_rejected');
      end;
    end if;

    if cardinality(why) > 0 then
      rej := rej || jsonb_build_array(jsonb_build_object('row', rn, 'question', left(q, 80), 'reasons', to_jsonb(why)));
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'imported', n_ok, 'rejected', rej);
end $$;

-- review screen: the pending questions WITH answers (admin only), oldest first = file order
create or replace function public.friday_bc_pending_list(p_limit integer default 30) returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.friday_is_admin() then return jsonb_build_object('ok', false, 'error', 'admin_required'); end if;
  return jsonb_build_object('ok', true,
    'total', (select count(*) from public.friday_bc_questions where status = 'pending_review'),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'question', q.question, 'opts', jsonb_build_array(q.opt1, q.opt2, q.opt3, q.opt4),
        'correct', q.correct, 'reference', q.reference, 'explanation', q.explanation, 'category', q.category, 'difficulty', q.difficulty) order by q.created_at, q.id)
      from (select * from public.friday_bc_questions where status = 'pending_review' order by created_at, id limit least(greatest(coalesce(p_limit, 30), 1), 100)) q), '[]'::jsonb));
end $$;

-- approve (→ 'approved', can be drawn into competitions) or reject (→ 'retired'). Touches ONLY rows that are still 'pending_review'.
create or replace function public.friday_bc_review_questions(p_ids uuid[], p_action text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare st text; n int;
begin
  if not public.friday_is_admin() then return jsonb_build_object('ok', false, 'error', 'admin_required'); end if;
  if p_action = 'approve' then st := 'approved'; elsif p_action = 'reject' then st := 'retired'; else return jsonb_build_object('ok', false, 'error', 'invalid_action'); end if;
  if p_ids is null or coalesce(array_length(p_ids, 1), 0) = 0 or array_length(p_ids, 1) > 100 then return jsonb_build_object('ok', false, 'error', 'invalid_row_count'); end if;
  update public.friday_bc_questions set status = st where id = any(p_ids) and status = 'pending_review';
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'changed', n);
end $$;

revoke all on function public.friday_bc_norm(text) from public, anon, authenticated;
do $$ declare f text; begin
  foreach f in array array['friday_bc_find_duplicates(text[])', 'friday_bc_import_questions(jsonb)', 'friday_bc_pending_list(integer)', 'friday_bc_review_questions(uuid[],text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop; end $$;
