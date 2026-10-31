// Request handling with injected dependencies, so the whole security path (JWT -> admin -> validation -> limits -> AI -> verification) is tested in Node.
// This function SAVES NOTHING. It returns verified questions + the rejected ones; the app stores them through friday_bc_save_generated(), which always writes 'pending_review'.
// deno-lint-ignore-file no-explicit-any
import { LIMITS, validateInput, buildGenerateRequest, parseGenerated, checkCandidate, findDuplicates, buildVerifyRequest, parseVerdicts, judgeVerdict, mapAiError, dupKey, type Accepted, type Rejected } from './logic.ts';
import { BOOKS, SECTIONS } from './canon.ts';

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (status: number, obj: unknown) => new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
export const MAX_BODY_BYTES = 64 * 1024;
export const DEFAULT_MODEL = 'claude-sonnet-5-5';

export type Deps = {
  getUser: (jwt: string) => Promise<{ id: string } | null>;
  getProfile: (userId: string) => Promise<{ role: string; is_active: boolean } | null>;
  recentUses: (userId: string, sinceIso: string) => Promise<number | null>;           // null = usage table unavailable
  logUse: (userId: string) => Promise<boolean>;
  existingQuestions: () => Promise<string[] | null>;                                 // every question text already in the bank (any status); null = unavailable
  fetch: typeof fetch;
  env: (name: string) => string | undefined;
  now?: () => number;
  timeoutMs?: number;
};

async function callAi(d: Deps, apiKey: string, body: unknown, ms: number): Promise<{ ok: true; data: any } | { ok: false; status: number; error: string; timeout?: boolean }> {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), ms);
  let res: Response;
  try {
    res = await d.fetch('https://api.anthropic.com/v1/messages', { method: 'POST', signal: ctl.signal, headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify(body) });
  } catch (e) {
    clearTimeout(timer);
    return (e as Error)?.name === 'AbortError' ? { ok: false, status: 504, error: 'ai_timeout', timeout: true } : { ok: false, status: 502, error: 'ai_unavailable' };
  }
  clearTimeout(timer);
  if (!res.ok) { const m = mapAiError(res.status); return { ok: false, status: m.status, error: m.error }; }
  try { return { ok: true, data: await res.json() }; } catch (_) { return { ok: false, status: 502, error: 'ai_failed' }; }
}

export async function handle(req: Request, d: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply(405, { ok: false, error: 'method_not_allowed' });

  // 1) who is calling? (checked on EVERY request, before anything else is read or revealed)
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return reply(401, { ok: false, error: 'unauthorized' });
  const user = await d.getUser(jwt);
  if (!user) return reply(401, { ok: false, error: 'unauthorized' });
  const prof = await d.getProfile(user.id);
  if (!prof || !prof.is_active || prof.role !== 'admin') return reply(403, { ok: false, error: 'admin_required' });

  // 2) input
  if (Number(req.headers.get('content-length') || 0) > MAX_BODY_BYTES) return reply(413, { ok: false, error: 'request_too_large' });
  let body: any;
  try { const raw = await req.text(); if (raw.length > MAX_BODY_BYTES) return reply(413, { ok: false, error: 'request_too_large' }); body = JSON.parse(raw); } catch (_) { return reply(400, { ok: false, error: 'invalid_json' }); }
  const apiKey = d.env('ANTHROPIC_API_KEY');
  const model = d.env('ANTHROPIC_MODEL') || DEFAULT_MODEL, vModel = d.env('BC_VERIFY_MODEL') || model;

  // 2b) "is generation available?" — never calls the AI, never costs anything
  if (body && body.action === 'status') {
    return reply(200, { ok: true, configured: !!apiKey, model: apiKey ? model : null,
      limits: { max_count: LIMITS.maxCount, per_window: LIMITS.window.max, window_minutes: LIMITS.window.minutes, per_day: LIMITS.perDay },
      books: BOOKS.map(b => ({ name: b.name, testament: b.testament, section: b.section })), sections: SECTIONS });
  }
  const v = validateInput(body);
  if (!v.ok) return reply(400, { ok: false, error: v.error });
  const input = v.value;

  // 3) not configured -> clear refusal (nothing is faked, nothing is logged)
  if (!apiKey) return reply(503, { ok: false, error: 'ai_not_configured' });

  // 4) cost guards: an admin account cannot trigger unlimited AI calls
  const now = (d.now || Date.now)();
  const w = await d.recentUses(user.id, new Date(now - LIMITS.window.minutes * 60_000).toISOString());
  if (w === null) return reply(500, { ok: false, error: 'server_misconfigured' });                      // fail closed
  if (w >= LIMITS.window.max) return reply(429, { ok: false, error: 'rate_limited' });
  const day = await d.recentUses(user.id, new Date(now - 24 * 3600_000).toISOString());
  if (day === null) return reply(500, { ok: false, error: 'server_misconfigured' });
  if (day >= LIMITS.perDay) return reply(429, { ok: false, error: 'daily_limit' });
  const existing = await d.existingQuestions();
  if (existing === null) return reply(500, { ok: false, error: 'server_misconfigured' });               // cannot check duplicates -> do not generate
  if (!(await d.logUse(user.id))) return reply(500, { ok: false, error: 'server_misconfigured' });

  // 5) generate
  const g = await callAi(d, apiKey, buildGenerateRequest(input, model), d.timeoutMs ?? 85_000);
  if (!g.ok) return reply(g.status, { ok: false, error: g.error });
  const parsed = parseGenerated(g.data, input.count);
  if (!parsed.ok) return reply(502, { ok: false, error: parsed.error });

  // 6) local checks (4 choices, one correct, reference exists in the canon + inside the requested scope), then duplicates
  const rejected: Rejected[] = [], passed: Accepted[] = [];
  for (const c of parsed.items) {
    const r = checkCandidate(c, input);
    if (r.item) passed.push(r.item); else rejected.push({ question: c.question.slice(0, 120), reasons: r.reasons });
  }
  const dup = findDuplicates(passed, new Set(existing.map(dupKey)), input.avoid);
  const toVerify: Accepted[] = [];
  passed.forEach((q, k) => { if (dup[k]) rejected.push({ question: q.question.slice(0, 120), reasons: [dup[k]] }); else toVerify.push(q); });

  // 7) independent, blind verification — anything not positively confirmed is rejected
  const accepted: Accepted[] = [];
  if (toVerify.length) {
    const vr = await callAi(d, apiKey, buildVerifyRequest(toVerify, vModel), d.timeoutMs ?? 55_000);
    if (!vr.ok) return reply(vr.status === 500 ? 500 : 502, { ok: false, error: vr.timeout ? 'verify_timeout' : 'verify_failed' });   // never return unverified questions
    const verdicts = parseVerdicts(vr.data, toVerify.length);
    if (!verdicts) return reply(502, { ok: false, error: 'verify_failed' });
    toVerify.forEach((q, k) => {
      const why = judgeVerdict(verdicts.get(k), q.correct);
      if (why) rejected.push({ question: q.question.slice(0, 120), reasons: [why] });
      else accepted.push({ ...q, verifier_note: (verdicts.get(k) as any).gist });
    });
  }
  return reply(200, { ok: true, requested: input.count, questions: accepted, rejected, truncated: parsed.truncated });
}
