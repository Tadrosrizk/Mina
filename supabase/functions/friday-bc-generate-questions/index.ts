// Supabase Edge Function: friday-bc-generate-questions
// Admin-only. Writes Arabic multiple-choice Bible questions on a topic with the Claude API, checks every reference against the 66-book canon,
// rejects duplicates, then has a SECOND blind AI call verify each cited verse. It saves NOTHING: the app saves the verified questions as 'pending_review'.
// Secrets (never in the app/APK):  ANTHROPIC_API_KEY (required, billed per use)   optional: ANTHROPIC_MODEL, BC_VERIFY_MODEL
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
    existingQuestions: async () => {
      const out: string[] = [];
      for (let from = 0; from < 20000; from += 1000) {
        const { data, error } = await admin.from('friday_bc_questions').select('question').order('created_at').range(from, from + 999);
        if (error) return null;
        for (const r of data || []) out.push(r.question);
        if (!data || data.length < 1000) break;
      }
      return out;
    },
    fetch, env: (n) => Deno.env.get(n),
  });
});
