-- Bible Competition — AI question generation (Part 6). Run ONCE in the Supabase SQL Editor, AFTER files 1, 2, 3 and 4. Safe to re-run.
-- Additive only: new columns on friday_bc_questions (existing rows get safe defaults) + new functions. No row is updated, deleted or overwritten.
--   * generated questions are saved ONLY through friday_bc_save_generated(), which ALWAYS writes status 'pending_review' — no code path here approves anything
--   * each row is validated again here (4 different choices, one correct, reference + explanation + category + difficulty required, duplicate vs the WHOLE bank and inside the batch)
--   * a trigger clears "ai_verified" when the text/choices/answer/reference of a generated question are edited (the AI check no longer describes the edited text)
--   * the Edge Function (friday-bc-generate-questions) never writes to the database

alter table public.friday_bc_questions add column if not exists ai_generated boolean not null default false;
alter table public.friday_bc_questions add column if not exists ai_verified boolean not null default false;
alter table public.friday_bc_questions add column if not exists gen_batch uuid;
alter table public.friday_bc_questions add column if not exists ai_note text not null default '';
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.friday_bc_questions'::regclass and conname = 'friday_bc_q_ai_note_len') then
    alter table public.friday_bc_questions add constraint friday_bc_q_ai_note_len check (char_length(ai_note) <= 300); end if;
end $$;
create index if not exists friday_bc_questions_batch_idx on public.friday_bc_questions (gen_batch) where gen_batch is not null;

create or replace function public.friday_bc_clear_ai_verified() returns trigger language plpgsql set search_path = '' as $$
begin
  if old.ai_verified and (new.question is distinct from old.question or new.opt1 is distinct from old.opt1 or new.opt2 is distinct from old.opt2 or new.opt3 is distinct from old.opt3
      or new.opt4 is distinct from old.opt4 or new.correct is distinct from old.correct or new.reference is distinct from old.reference) then
    new.ai_verified := false;
  end if;
  return new;
end $$;
drop trigger if exists friday_bc_clear_ai_verified_trg on public.friday_bc_questions;
create trigger friday_bc_clear_ai_verified_trg before update on public.friday_bc_questions for each row execute function public.friday_bc_clear_ai_verified();

-- p_rows = [{question, opts:[4], correct:1-4, reference, explanation, category, difficulty, note}], max 30. Each row on its own: valid ones are inserted, the rest are reported.
-- Returns {ok, saved:[{i, id}], rejected:[{i, reasons:[..]}]} where i is the 1-based position in p_rows.
create or replace function public.friday_bc_save_generated(p_batch uuid, p_rows jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r jsonb; i int := 0; saved jsonb := '[]'::jsonb; rej jsonb := '[]'::jsonb; e text; why text[]; nid uuid;
  q text; o text[]; ci int; refx text; ex text; cat text; dif text; nq text; batch text[] := '{}';
begin
  if not public.friday_is_admin() then return jsonb_build_object('ok', false, 'error', 'admin_required'); end if;
  if p_batch is null then return jsonb_build_object('ok', false, 'error', 'invalid_payload'); end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then return jsonb_build_object('ok', false, 'error', 'invalid_payload'); end if;
  if jsonb_array_length(p_rows) = 0 or jsonb_array_length(p_rows) > 30 then return jsonb_build_object('ok', false, 'error', 'invalid_row_count'); end if;
  perform pg_advisory_xact_lock(hashtext('friday_bc_import'));            -- the same lock as the Excel import: two admins can't both insert the same question

  for r in select value from jsonb_array_elements(p_rows) loop
    i := i + 1; why := '{}';
    q := btrim(coalesce(r ->> 'question', '')); refx := btrim(coalesce(r ->> 'reference', '')); ex := btrim(coalesce(r ->> 'explanation', ''));
    cat := btrim(coalesce(r ->> 'category', '')); dif := lower(btrim(coalesce(r ->> 'difficulty', '')));
    if (case when jsonb_typeof(r -> 'opts') = 'array' then jsonb_array_length(r -> 'opts') else -1 end) <> 4 then why := array_append(why, 'need_four_options_one_correct'); o := null;
    else o := array[btrim(coalesce(r -> 'opts' ->> 0, '')), btrim(coalesce(r -> 'opts' ->> 1, '')), btrim(coalesce(r -> 'opts' ->> 2, '')), btrim(coalesce(r -> 'opts' ->> 3, ''))]; end if;
    if coalesce(r ->> 'correct', '') ~ '^[1-4]$' then ci := (r ->> 'correct')::int; else ci := null; why := array_append(why, 'need_four_options_one_correct'); end if;
    if refx !~ '[0-9٠-٩]+\s*[:：.]\s*[0-9٠-٩]+' then why := array_append(why, 'ref_required'); end if;     -- a verse reference (chapter:verse) is mandatory for generated questions
    if char_length(ex) < 5 then why := array_append(why, 'expl_required'); end if;
    if cat = '' then why := array_append(why, 'cat_required'); end if;
    if dif not in ('easy', 'medium', 'hard') then why := array_append(why, 'diff_required'); end if;
    if cardinality(why) = 0 then
      e := public.friday_bc_check_question(q, o, ci, refx, ex, cat, dif, null);        -- shared validator: lengths, four different options, duplicate vs the whole bank
      if e is not null then why := array_append(why, e); end if;
    end if;
    if cardinality(why) = 0 then
      nq := public.friday_bc_norm(q);
      if nq = any(batch) then why := array_append(why, 'duplicate_question'); end if;
    end if;
    if cardinality(why) = 0 then
      begin
        insert into public.friday_bc_questions (question, opt1, opt2, opt3, opt4, correct, reference, explanation, category, difficulty, status, created_by, created_at, ai_generated, ai_verified, gen_batch, ai_note)
        values (q, o[1], o[2], o[3], o[4], ci, refx, ex, cat, dif, 'pending_review', auth.uid(), clock_timestamp(), true,
                coalesce((r ->> 'verified') = 'true', false), p_batch, left(btrim(coalesce(r ->> 'note', '')), 300))
        returning id into nid;
        saved := saved || jsonb_build_array(jsonb_build_object('i', i, 'id', nid)); batch := array_append(batch, nq);
      exception when check_violation then why := array_append(why, 'invalid_or_duplicate_options'); end;
    end if;
    if cardinality(why) > 0 then rej := rej || jsonb_build_array(jsonb_build_object('i', i, 'reasons', to_jsonb(why))); end if;
  end loop;
  return jsonb_build_object('ok', true, 'saved', saved, 'rejected', rej);
end $$;

-- review screen of ONE generation batch (admin only), with answers, current status and the verifier's note
create or replace function public.friday_bc_batch_list(p_batch uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.friday_is_admin() then return jsonb_build_object('ok', false, 'error', 'admin_required'); end if;
  if p_batch is null then return jsonb_build_object('ok', false, 'error', 'invalid_payload'); end if;
  return jsonb_build_object('ok', true, 'items', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'question', q.question, 'opts', jsonb_build_array(q.opt1, q.opt2, q.opt3, q.opt4),
      'correct', q.correct, 'reference', q.reference, 'explanation', q.explanation, 'category', q.category, 'difficulty', q.difficulty, 'status', q.status,
      'ai_verified', q.ai_verified, 'note', q.ai_note) order by q.created_at, q.id)
    from public.friday_bc_questions q where q.gen_batch = p_batch), '[]'::jsonb));
end $$;

revoke all on function public.friday_bc_clear_ai_verified() from public, anon, authenticated;
do $$ declare f text; begin
  foreach f in array array['friday_bc_save_generated(uuid,jsonb)', 'friday_bc_batch_list(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop; end $$;
