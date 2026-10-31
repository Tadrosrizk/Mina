// Supabase Edge Function: friday-bc-pdf-questions
// Admin-only. Receives a PDF (base64) from the app, asks Claude to write multiple-choice questions from it, and returns them as rows.
// It saves NOTHING: the app runs the rows through the same validation / duplicate check / preview as the Excel import, and they are stored as 'pending_review'.
// Secrets (never in the app/APK): ANTHROPIC_API_KEY  (optional: ANTHROPIC_MODEL).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handle } from './handler.ts';

Deno.serve((req: Request) => {
  const url = Deno.env.get('SUPABASE_URL'), key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return new Response(JSON.stringify({ ok: false, error: 'server_misconfigured' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  const admin = createClient(url, key, { auth: { persistSession: false } });
  return handle(req, {
    getUser: async (jwt) => { const { data, error } = await admin.auth.getUser(jwt); return error || !data?.user ? null : { id: data.user.id }; },
    getProfile: async (id) => { const { data } = await admin.from('friday_profiles').select('role, is_active').eq('user_id', id).maybeSingle(); return data || null; },
    recentUses: async (id, since) => { const { count, error } = await admin.from('friday_bc_ai_usage').select('id', { count: 'exact', head: true }).eq('user_id', id).gte('created_at', since); return error ? null : (count || 0); },
    logUse: async (id) => { const { error } = await admin.from('friday_bc_ai_usage').insert({ user_id: id }); return !error; },
    fetch, env: (n) => Deno.env.get(n),
  });
});
