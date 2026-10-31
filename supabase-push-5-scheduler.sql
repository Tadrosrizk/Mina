-- Friday Push — الجزء 5 (اختياري): إرسال الإشعارات المجدولة. غيّر PROJECT_REF لمعرّف مشروعك و CRON_SECRET لنفس القيمة اللي حطيتها في أسرار الدالة. ما ترفعش الملف ده على GitHub بعد ما تحط السر فيه.

create extension if not exists pg_cron;

create extension if not exists pg_net;

select cron.schedule('friday-dispatch-notifications', '* * * * *', $job$ select net.http_post(url := 'https://PROJECT_REF.supabase.co/functions/v1/friday-send-notification', headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', 'CRON_SECRET'), body := '{"action":"dispatch_due"}'::jsonb) $job$);
