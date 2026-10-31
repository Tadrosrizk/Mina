-- Friday Coins — الحضور التلقائي، الجزء التاني (دوال + trigger). شغّله بعد COINS-3.
-- ==== PART 2: functions + trigger ====

create or replace function public.friday_coins_sync_attendance(p_child uuid, p_class uuid, p_date date, p_present boolean, p_actor uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare enabled boolean; val int; net int; awards int; last_id uuid;
begin
  select is_points_enabled into enabled from public.friday_classes where id = p_class;
  if not coalesce(enabled, false) then return; end if;
  select coalesce(sum(amount), 0), count(*) filter (where reason = 'Attendance') into net, awards
  from public.friday_points_log where child_id = p_child and attendance_date = p_date and reason in ('Attendance', 'Attendance Reversal');
  if p_present and net = 0 then
    select amount into val from public.friday_coin_values where reason = 'Attendance';
    if coalesce(val, 0) <= 0 then return; end if;
    insert into public.friday_points_log (child_id, class_id, servant_id, amount, reason, evaluation_week, attendance_date, notes, idempotency_key)
    values (p_child, p_class, p_actor, val, 'Attendance', public.friday_coin_week(p_date), p_date, '', 'att:' || p_child || ':' || p_date || ':' || (awards + 1))
    on conflict do nothing;
  elsif not p_present and net > 0 then
    select id into last_id from public.friday_points_log where child_id = p_child and attendance_date = p_date and reason = 'Attendance' order by created_at desc, id desc limit 1;
    insert into public.friday_points_log (child_id, class_id, servant_id, amount, reason, evaluation_week, attendance_date, notes, corrects_id, idempotency_key)
    values (p_child, p_class, p_actor, -net, 'Attendance Reversal', public.friday_coin_week(p_date), p_date, '', last_id, 'attrev:' || p_child || ':' || p_date || ':' || awards)
    on conflict do nothing;
  end if;
end $$;

create or replace function public.friday_coins_attendance_trg() returns trigger
language plpgsql security definer set search_path = '' as $$
declare d date; r record;
begin
  if tg_op = 'DELETE' then r := old; else r := new; end if;
  begin
    select session_date into d from public.friday_attendance_sessions where id = r.session_id;
    if d is not null then
      perform public.friday_coins_sync_attendance(r.child_id, r.class_id, d, tg_op <> 'DELETE' and r.status = 'present', coalesce(auth.uid(), r.marked_by));
    end if;
  exception when others then
    raise warning 'friday coins attendance sync skipped: %', sqlerrm;     -- attendance must never fail because of Coins
  end;
  return null;
end $$;

drop trigger if exists friday_coins_attendance_trigger on public.friday_attendance_records;
create trigger friday_coins_attendance_trigger after insert or update of status or delete on public.friday_attendance_records
  for each row execute function public.friday_coins_attendance_trg();

-- admin: values now include the optional 'Attendance' (0 = off). The four weekly criteria stay mandatory (1..1000).
create or replace function public.friday_admin_set_coin_values(p_values jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare k text; v jsonb; old jsonb; lo int;
begin
  if not public.friday_is_admin() then return jsonb_build_object('ok', false, 'error', 'admin_required'); end if;
  if p_values is null or jsonb_typeof(p_values) <> 'object' then return jsonb_build_object('ok', false, 'error', 'invalid_arguments'); end if;
  foreach k in array array['Liturgy','Service','Behavior','Interaction','Attendance'] loop
    v := p_values -> k;
    if v is null and k = 'Attendance' then continue; end if;
    lo := 1; if k = 'Attendance' then lo := 0; end if;
    if v is null or jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric <> trunc((v #>> '{}')::numeric)
       or (v #>> '{}')::numeric < lo or (v #>> '{}')::numeric > 1000 then
      return jsonb_build_object('ok', false, 'error', 'invalid_value', 'field', k);
    end if;
  end loop;
  select jsonb_object_agg(reason, amount) into old from public.friday_coin_values;
  foreach k in array array['Liturgy','Service','Behavior','Interaction','Attendance'] loop
    if p_values ? k then
      update public.friday_coin_values set amount = (p_values ->> k)::int, updated_by = auth.uid(), updated_at = now() where reason = k;
    end if;
  end loop;
  insert into public.friday_coin_audit (actor_id, action, details)
  values (auth.uid(), 'coin_values_changed', jsonb_build_object('from', old, 'to', p_values));
  return jsonb_build_object('ok', true);
end $$;

-- admin: give the automatic coin for attendance that was ALREADY recorded (from a date on). Safe to repeat (never double).
create or replace function public.friday_admin_coins_backfill_attendance(p_class uuid, p_from date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r record; before_n int; after_n int; enabled boolean;
begin
  if not public.friday_is_admin() then return jsonb_build_object('ok', false, 'error', 'admin_required'); end if;
  if p_class is null or p_from is null then return jsonb_build_object('ok', false, 'error', 'invalid_arguments'); end if;
  select is_points_enabled into enabled from public.friday_classes where id = p_class;
  if enabled is null then return jsonb_build_object('ok', false, 'error', 'class_not_found'); end if;
  if not enabled then return jsonb_build_object('ok', false, 'error', 'coins_disabled'); end if;
  select count(*) into before_n from public.friday_points_log where class_id = p_class and reason = 'Attendance';
  for r in select rec.child_id, rec.class_id, s.session_date as d from public.friday_attendance_records rec
           join public.friday_attendance_sessions s on s.id = rec.session_id
           where rec.class_id = p_class and rec.status = 'present' and s.session_date >= p_from loop
    perform public.friday_coins_sync_attendance(r.child_id, r.class_id, r.d, true, auth.uid());
  end loop;
  select count(*) into after_n from public.friday_points_log where class_id = p_class and reason = 'Attendance';
  insert into public.friday_coin_audit (actor_id, action, class_id, details)
  values (auth.uid(), 'attendance_backfill', p_class, jsonb_build_object('from', p_from, 'created', after_n - before_n));
  return jsonb_build_object('ok', true, 'created', after_n - before_n);
end $$;

revoke all on function public.friday_coins_sync_attendance(uuid, uuid, date, boolean, uuid) from public;
revoke all on function public.friday_coins_attendance_trg() from public;
revoke all on function public.friday_admin_set_coin_values(jsonb) from public;
revoke all on function public.friday_admin_coins_backfill_attendance(uuid, date) from public;
grant execute on function public.friday_admin_set_coin_values(jsonb) to authenticated;
grant execute on function public.friday_admin_coins_backfill_attendance(uuid, date) to authenticated;
