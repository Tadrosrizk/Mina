-- Friday Coins — الحضور التلقائي، الجزء الأول (أعمدة وقيود وقيم). شغّله بعد COINS-2.
-- ==== PART 1: columns + constraints ====

alter table public.friday_points_log add column if not exists attendance_date date;

alter table public.friday_points_log drop constraint if exists friday_points_log_reason_check;
alter table public.friday_points_log add constraint friday_points_log_reason_check check (
  reason in ('Liturgy','Service','Behavior','Interaction','Previous Balance','Correction','Attendance','Attendance Reversal'));

alter table public.friday_points_log drop constraint if exists friday_points_amount_rule;
alter table public.friday_points_log add constraint friday_points_amount_rule check (
     (reason in ('Liturgy','Service','Behavior','Interaction') and amount between 1 and 1000 and evaluation_week is not null)
  or (reason = 'Previous Balance' and amount between 0 and 1000000)
  or (reason = 'Correction' and amount <> 0 and abs(amount) <= 1000000 and char_length(btrim(notes)) >= 3)
  or (reason = 'Attendance' and amount between 1 and 1000 and attendance_date is not null)
  or (reason = 'Attendance Reversal' and amount between -1000 and -1 and attendance_date is not null and corrects_id is not null));

create index if not exists friday_points_attendance_idx on public.friday_points_log (child_id, attendance_date) where attendance_date is not null;

alter table public.friday_coin_values drop constraint if exists friday_coin_values_reason_check;
alter table public.friday_coin_values add constraint friday_coin_values_reason_check check (reason in ('Liturgy','Service','Behavior','Interaction','Attendance'));
alter table public.friday_coin_values drop constraint if exists friday_coin_values_amount_check;
alter table public.friday_coin_values add constraint friday_coin_values_amount_check check (
  (reason = 'Attendance' and amount between 0 and 1000) or (reason <> 'Attendance' and amount between 1 and 1000));
insert into public.friday_coin_values (reason, amount) values ('Attendance', 1) on conflict (reason) do nothing;
-- every item is worth ONE coin by default. Values nobody has changed yet (updated_by is null) are moved from the old
-- 10/10/5/5 seed to 1; anything an admin already saved is left alone. (Editable any time from the app.)
update public.friday_coin_values set amount = 1, updated_at = now()
where reason in ('Liturgy','Service','Behavior','Interaction') and updated_by is null and amount in (10, 5);
