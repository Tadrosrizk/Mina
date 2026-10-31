-- Friday Coins — الجزء التاني (دوال + صلاحيات + View). شغّله بعد الجزء الأول.
-- ==== PART 2: functions, triggers, policies, view ====

create or replace function public.friday_coin_today() returns date
language sql stable set search_path = '' as $$ select (now() at time zone 'Africa/Cairo')::date $$;

-- the Friday that ENDS the Saturday→Friday week containing p_date
create or replace function public.friday_coin_week(p_date date) returns date
language sql immutable set search_path = '' as $$
  select p_date + ((5 - extract(dow from p_date)::int + 7) % 7)
$$;

-- may the caller see Coins data of this child?  admin: always.  servant: only if the child's CURRENT class has Coins enabled.
create or replace function public.friday_coins_visible(p_child uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.friday_is_admin() or exists (
    select 1 from public.friday_children c
    join public.friday_classes cl on cl.id = c.class_id
    where c.id = p_child and cl.is_points_enabled and public.friday_can_access_class(cl.id))
$$;
revoke all on function public.friday_coin_today() from public;
revoke all on function public.friday_coin_week(date) from public;
revoke all on function public.friday_coins_visible(uuid) from public;
grant execute on function public.friday_coin_today() to authenticated;
grant execute on function public.friday_coin_week(date) to authenticated;
grant execute on function public.friday_coins_visible(uuid) to authenticated;

-- ---- the ledger is append-only: no update, no delete, no truncate (not even for admins) ----
create or replace function public.friday_points_log_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    -- the ONLY allowed change: the FK "on delete set null" when an auth user is removed (servant_id -> null)
    if new.servant_id is null and old.servant_id is not null
       and (to_jsonb(new) - 'servant_id') = (to_jsonb(old) - 'servant_id') then
      return new;
    end if;
    raise exception 'friday_points_log is append-only (update refused)' using errcode = '42501';
  end if;
  raise exception 'friday_points_log is append-only (% refused)', lower(tg_op) using errcode = '42501';
end $$;
drop trigger if exists friday_points_log_guard_row on public.friday_points_log;
create trigger friday_points_log_guard_row before update or delete on public.friday_points_log
  for each row execute function public.friday_points_log_guard();
drop trigger if exists friday_points_log_guard_trunc on public.friday_points_log;
create trigger friday_points_log_guard_trunc before truncate on public.friday_points_log
  for each statement execute function public.friday_points_log_guard();

-- ---- table privileges + RLS: read-only for signed-in users; every write goes through the functions below ----
revoke all on table public.friday_points_log from public, anon, authenticated;
revoke all on table public.friday_coin_values from public, anon, authenticated;
revoke all on table public.friday_coin_audit from public, anon, authenticated;
grant select on table public.friday_points_log to authenticated;
grant select on table public.friday_coin_values to authenticated;
grant select on table public.friday_coin_audit to authenticated;

drop policy if exists friday_points_select on public.friday_points_log;
create policy friday_points_select on public.friday_points_log
  for select to authenticated using (public.friday_coins_visible(child_id));
drop policy if exists friday_coin_values_select on public.friday_coin_values;
create policy friday_coin_values_select on public.friday_coin_values
  for select to authenticated using (public.friday_is_active_user());
drop policy if exists friday_coin_audit_select on public.friday_coin_audit;
create policy friday_coin_audit_select on public.friday_coin_audit
  for select to authenticated using (public.friday_is_admin());

-- ---- balances: the view is the SUM of the ledger (security_invoker => the caller's own RLS applies) ----
create or replace view public.friday_student_coins_balance with (security_invoker = true) as
select c.id as child_id,
       c.class_id,
       cl.is_points_enabled,
       coalesce(sum(l.amount), 0)::bigint as total_coins,
       count(l.id)::int as transactions_count,
       max(l.created_at) as last_transaction_at
from public.friday_children c
join public.friday_classes cl on cl.id = c.class_id
left join public.friday_points_log l on l.child_id = c.id
where cl.is_points_enabled or public.friday_is_admin()
group by c.id, c.class_id, cl.is_points_enabled;
revoke all on public.friday_student_coins_balance from public, anon;
grant select on public.friday_student_coins_balance to authenticated;

-- ---- admin: turn Coins on/off for ONE class (history and balances are never touched) ----
create or replace function public.friday_set_class_coins(p_class uuid, p_enabled boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare old_val boolean;
begin
  if not public.friday_is_admin() then return jsonb_build_object('ok', false, 'error', 'admin_required'); end if;
  if p_class is null or p_enabled is null then return jsonb_build_object('ok', false, 'error', 'invalid_arguments'); end if;
  select is_points_enabled into old_val from public.friday_classes where id = p_class for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'class_not_found'); end if;
  if old_val is distinct from p_enabled then
    update public.friday_classes set is_points_enabled = p_enabled where id = p_class;
    insert into public.friday_coin_audit (actor_id, action, class_id, details)
    values (auth.uid(), 'class_coins_toggle', p_class, jsonb_build_object('from', old_val, 'to', p_enabled));
  end if;
  return jsonb_build_object('ok', true, 'is_points_enabled', p_enabled, 'changed', old_val is distinct from p_enabled);
end $$;

-- ---- admin: scoring values (apply to FUTURE evaluations only; recorded transactions are never changed) ----
create or replace function public.friday_admin_set_coin_values(p_values jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare k text; v jsonb; old jsonb;
begin
  if not public.friday_is_admin() then return jsonb_build_object('ok', false, 'error', 'admin_required'); end if;
  if p_values is null or jsonb_typeof(p_values) <> 'object' then return jsonb_build_object('ok', false, 'error', 'invalid_arguments'); end if;
  foreach k in array array['Liturgy','Service','Behavior','Interaction'] loop
    v := p_values -> k;
    if v is null or jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric <> trunc((v #>> '{}')::numeric)
       or (v #>> '{}')::numeric < 1 or (v #>> '{}')::numeric > 1000 then
      return jsonb_build_object('ok', false, 'error', 'invalid_value', 'field', k);
    end if;
  end loop;
  select jsonb_object_agg(reason, amount) into old from public.friday_coin_values;
  foreach k in array array['Liturgy','Service','Behavior','Interaction'] loop
    update public.friday_coin_values set amount = (p_values ->> k)::int, updated_by = auth.uid(), updated_at = now() where reason = k;
  end loop;
  insert into public.friday_coin_audit (actor_id, action, details)
  values (auth.uid(), 'coin_values_changed', jsonb_build_object('from', old, 'to', p_values));
  return jsonb_build_object('ok', true);
end $$;

-- ---- servant: weekly evaluation. One atomic call; amounts come from friday_coin_values (never from the client) ----
-- p_items = [{"child_id": "...", "reasons": ["Liturgy","Behavior", ...]}, ...]
create or replace function public.friday_coins_submit_evaluation(p_class uuid, p_week date, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid(); w date; enabled boolean; vals jsonb;
  it jsonb; rs text; cid uuid; amt int; n_items int := 0; total int := 0; created int := 0; got int;
  skipped jsonb := '[]'::jsonb; bad_child uuid;
begin
  if uid is null then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;
  if p_class is null or p_week is null or jsonb_typeof(coalesce(p_items, 'null'::jsonb)) <> 'array'
     or jsonb_array_length(p_items) > 500 then
    return jsonb_build_object('ok', false, 'error', 'invalid_arguments');
  end if;
  if not public.friday_can_access_class(p_class) then return jsonb_build_object('ok', false, 'error', 'denied'); end if;
  select is_points_enabled into enabled from public.friday_classes where id = p_class and is_active for share;
  if not found then return jsonb_build_object('ok', false, 'error', 'class_not_found'); end if;
  if not enabled then return jsonb_build_object('ok', false, 'error', 'coins_disabled'); end if;
  w := public.friday_coin_week(p_week);
  if w > public.friday_coin_week(public.friday_coin_today()) then return jsonb_build_object('ok', false, 'error', 'future_week'); end if;
  select jsonb_object_agg(reason, amount) into vals from public.friday_coin_values;

  -- pass 1: validate EVERYTHING before writing anything
  for it in select * from jsonb_array_elements(p_items) loop
    begin cid := nullif(it ->> 'child_id', '')::uuid; exception when others then cid := null; end;
    if cid is null or jsonb_typeof(coalesce(it -> 'reasons', 'null'::jsonb)) <> 'array'
       or not exists (select 1 from public.friday_children c where c.id = cid and c.class_id = p_class and c.is_active) then
      return jsonb_build_object('ok', false, 'error', 'invalid_child');
    end if;
    for rs in select jsonb_array_elements_text(it -> 'reasons') loop
      if rs not in ('Liturgy','Service','Behavior','Interaction') then return jsonb_build_object('ok', false, 'error', 'invalid_reason'); end if;
      total := total + 1;
    end loop;
  end loop;
  if total = 0 then return jsonb_build_object('ok', false, 'error', 'nothing_selected'); end if;

  -- pass 2: insert; a duplicate (same child + criterion + week) is skipped, never doubled
  for it in select * from jsonb_array_elements(p_items) loop
    cid := (it ->> 'child_id')::uuid;
    for rs in select distinct jsonb_array_elements_text(it -> 'reasons') loop
      amt := (vals ->> rs)::int;
      insert into public.friday_points_log (child_id, class_id, servant_id, amount, reason, evaluation_week, idempotency_key)
      values (cid, p_class, uid, amt, rs, w, 'eval:' || p_class || ':' || w || ':' || cid || ':' || rs)
      on conflict do nothing;
      get diagnostics got = row_count;
      if got = 1 then created := created + 1;
      else skipped := skipped || jsonb_build_array(jsonb_build_object('child_id', cid, 'reason', rs)); end if;
    end loop;
  end loop;
  return jsonb_build_object('ok', true, 'week', w, 'created', created, 'skipped', jsonb_array_length(skipped), 'skipped_items', skipped);
end $$;

-- ---- servant: the old paper balance, recorded ONCE per child ----
create or replace function public.friday_coins_previous_balance(p_child uuid, p_amount numeric, p_notes text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); cls uuid; enabled boolean; act boolean; got int;
begin
  if uid is null then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;
  if p_child is null or p_amount is null or p_amount <> trunc(p_amount) or p_amount < 0 or p_amount > 1000000 then
    return jsonb_build_object('ok', false, 'error', 'invalid_amount');
  end if;
  select c.class_id, c.is_active into cls, act from public.friday_children c where c.id = p_child;
  if cls is null or not act then return jsonb_build_object('ok', false, 'error', 'child_not_found'); end if;
  if not public.friday_can_access_class(cls) then return jsonb_build_object('ok', false, 'error', 'denied'); end if;
  select is_points_enabled into enabled from public.friday_classes where id = cls for share;
  if not enabled then return jsonb_build_object('ok', false, 'error', 'coins_disabled'); end if;
  insert into public.friday_points_log (child_id, class_id, servant_id, amount, reason, notes, idempotency_key)
  values (p_child, cls, uid, p_amount::int, 'Previous Balance', left(coalesce(p_notes, ''), 500), 'prev:' || p_child)
  on conflict do nothing;
  get diagnostics got = row_count;
  if got = 0 then return jsonb_build_object('ok', false, 'error', 'already_entered'); end if;
  return jsonb_build_object('ok', true, 'amount', p_amount::int);
end $$;

-- ---- admin: correction = a NEW compensating transaction (the original is kept); p_key makes retries safe ----
create or replace function public.friday_admin_coins_correct(p_child uuid, p_amount integer, p_notes text, p_corrects uuid, p_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); cls uuid; bal bigint; got int;
begin
  if not public.friday_is_admin() then return jsonb_build_object('ok', false, 'error', 'admin_required'); end if;
  if p_child is null or p_amount is null or p_amount = 0 or abs(p_amount) > 1000000 then return jsonb_build_object('ok', false, 'error', 'invalid_amount'); end if;
  if p_notes is null or char_length(btrim(p_notes)) < 3 then return jsonb_build_object('ok', false, 'error', 'notes_required'); end if;
  if p_key is null or char_length(btrim(p_key)) < 8 or char_length(p_key) > 80 then return jsonb_build_object('ok', false, 'error', 'invalid_key'); end if;
  select class_id into cls from public.friday_children where id = p_child for update;
  if cls is null then return jsonb_build_object('ok', false, 'error', 'child_not_found'); end if;
  if p_corrects is not null and not exists (select 1 from public.friday_points_log where id = p_corrects and child_id = p_child) then
    return jsonb_build_object('ok', false, 'error', 'invalid_original');
  end if;
  select coalesce(sum(amount), 0) into bal from public.friday_points_log where child_id = p_child;
  if bal + p_amount < 0 then return jsonb_build_object('ok', false, 'error', 'would_go_negative', 'balance', bal); end if;
  insert into public.friday_points_log (child_id, class_id, servant_id, amount, reason, notes, corrects_id, idempotency_key)
  values (p_child, cls, uid, p_amount, 'Correction', left(btrim(p_notes), 500), p_corrects, 'corr:' || btrim(p_key))
  on conflict do nothing;
  get diagnostics got = row_count;
  return jsonb_build_object('ok', true, 'duplicate', got = 0, 'balance', bal + case when got = 1 then p_amount else 0 end);
end $$;

-- ---- admin: transaction history with names (newest first; p_before = pagination cursor) ----
create or replace function public.friday_admin_coins_history(p_class uuid default null, p_child uuid default null,
                                                              p_limit integer default 100, p_before timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.friday_is_admin() then raise exception 'admin_required' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(x order by (x ->> 'created_at') desc) from (
      select jsonb_build_object(
        'id', l.id, 'child_id', l.child_id, 'student_name', c.full_name, 'class_id', l.class_id, 'class_name', cl.name,
        'amount', l.amount, 'reason', l.reason, 'evaluation_week', l.evaluation_week, 'notes', l.notes,
        'corrects_id', l.corrects_id, 'servant_id', l.servant_id, 'servant_name', coalesce(p.display_name, p.email, ''),
        'created_at', l.created_at) as x
      from public.friday_points_log l
      join public.friday_children c on c.id = l.child_id
      join public.friday_classes cl on cl.id = l.class_id
      left join public.friday_profiles p on p.user_id = l.servant_id
      where (p_class is null or l.class_id = p_class) and (p_child is null or l.child_id = p_child)
        and (p_before is null or l.created_at < p_before)
      order by l.created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500)
    ) s), '[]'::jsonb);
end $$;

revoke all on function public.friday_set_class_coins(uuid, boolean) from public;
revoke all on function public.friday_admin_set_coin_values(jsonb) from public;
revoke all on function public.friday_coins_submit_evaluation(uuid, date, jsonb) from public;
revoke all on function public.friday_coins_previous_balance(uuid, numeric, text) from public;
revoke all on function public.friday_admin_coins_correct(uuid, integer, text, uuid, text) from public;
revoke all on function public.friday_admin_coins_history(uuid, uuid, integer, timestamptz) from public;
revoke all on function public.friday_points_log_guard() from public;
grant execute on function public.friday_set_class_coins(uuid, boolean) to authenticated;
grant execute on function public.friday_admin_set_coin_values(jsonb) to authenticated;
grant execute on function public.friday_coins_submit_evaluation(uuid, date, jsonb) to authenticated;
grant execute on function public.friday_coins_previous_balance(uuid, numeric, text) to authenticated;
grant execute on function public.friday_admin_coins_correct(uuid, integer, text, uuid, text) to authenticated;
grant execute on function public.friday_admin_coins_history(uuid, uuid, integer, timestamptz) to authenticated;
