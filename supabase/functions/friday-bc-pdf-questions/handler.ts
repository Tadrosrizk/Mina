// Request handling with injected dependencies, so the whole security path (JWT -> admin -> rate limit -> validation -> AI call) is tested in Node.
// deno-lint-ignore-file no-explicit-any
import { validateInput, buildRequest, parseModelOutput, mapAiError, MAX_PDF_BYTES, RATE_LIMIT } from './logic.ts';

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (status: number, obj: unknown) => new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

export type Deps = {
  getUser: (jwt: string) => Promise<{ id: string } | null>;
  getProfile: (userId: string) => Promise<{ role: string; is_active: boolean } | null>;
  recentUses: (userId: string, sinceIso: string) => Promise<number | null>;     // null = usage table unavailable
  logUse: (userId: string) => Promise<boolean>;
  fetch: typeof fetch;
  env: (name: string) => string | undefined;
  now?: () => number;
  timeoutMs?: number;
};

export async function handle(req: Request, d: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply(405, { ok: false, error: 'method_not_allowed' });

  // 1) who is calling? (checked on EVERY request, before anything else is revealed or read)
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return reply(401, { ok: false, error: 'unauthorized' });
  const user = await d.getUser(jwt);
  if (!user) return reply(401, { ok: false, error: 'unauthorized' });
  const prof = await d.getProfile(user.id);
  if (!prof || !prof.is_active || prof.role !== 'admin') return reply(403, { ok: false, error: 'admin_required' });

  // 2) input
  if (Number(req.headers.get('content-length') || 0) > Math.ceil(MAX_PDF_BYTES * 4 / 3) + 8192) return reply(413, { ok: false, error: 'pdf_too_large' });
  let body: any;
  try { body = await req.json(); } catch (_) { return reply(400, { ok: false, error: 'invalid_json' }); }
  const v = validateInput(body);
  if (!v.ok) return reply(v.error === 'pdf_too_large' ? 413 : 400, { ok: false, error: v.error });

  // 3) cost guard: an admin account cannot trigger unlimited AI calls
  const apiKey = d.env('ANTHROPIC_API_KEY');
  if (!apiKey) return reply(500, { ok: false, error: 'ai_not_configured' });
  const now = (d.now || Date.now)();
  const used = await d.recentUses(user.id, new Date(now - RATE_LIMIT.windowMinutes * 60_000).toISOString());
  if (used === null) return reply(500, { ok: false, error: 'server_misconfigured' });          // fail closed
  if (used >= RATE_LIMIT.max) return reply(429, { ok: false, error: 'rate_limited' });
  if (!(await d.logUse(user.id))) return reply(500, { ok: false, error: 'server_misconfigured' });

  // 4) the AI call
  const model = d.env('ANTHROPIC_MODEL') || 'claude-sonnet-5-5';
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), d.timeoutMs ?? 110_000);
  let res: Response;
  try {
    res = await d.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: ctl.signal,
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(buildRequest(v.value, model)),
    });
  } catch (e) {
    clearTimeout(timer);
    return (e as Error)?.name === 'AbortError' ? reply(504, { ok: false, error: 'ai_timeout' }) : reply(502, { ok: false, error: 'ai_unavailable' });
  }
  clearTimeout(timer);
  if (!res.ok) { const m = mapAiError(res.status); return reply(m.status, { ok: false, error: m.error }); }
  let data: any;
  try { data = await res.json(); } catch (_) { return reply(502, { ok: false, error: 'ai_failed' }); }
  const out = parseModelOutput(data, v.value.count);
  if (!out.ok) return reply(502, { ok: false, error: out.error });
  return reply(200, { ok: true, questions: out.questions, truncated: out.truncated });
}
