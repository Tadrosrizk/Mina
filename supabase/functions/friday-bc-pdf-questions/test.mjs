// Run:  node --test test.mjs   (Node 22+, no dependencies). The Anthropic API is replaced by a fake: these tests check OUR side
// (auth, admin check, rate limit, input checks, the request we build, how we read the reply) — not the live API.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateInput, buildRequest, buildPrompt, parseModelOutput, mapAiError, MAX_PDF_BYTES, TOOL } from './logic.ts';
import { handle } from './handler.ts';

const PDF = Buffer.from('%PDF-1.4\n%fake test pdf').toString('base64');
const goodQ = (n = 1) => ({ question: 'مين اللي اتبلع في بطن الحوت؟ ' + n, choices: ['يونان', 'إيليا', 'إرميا', 'إشعياء'], correct: 1, explanation: 'حسب الملف', reference: 'يونان 1:17', category: 'العهد القديم', difficulty: 'easy' });
const aiReply = (qs, extra = {}) => ({ content: [{ type: 'text', text: 'ok' }, { type: 'tool_use', name: 'submit_questions', input: { questions: qs } }], stop_reason: 'tool_use', ...extra });

/* ---------- validateInput ---------- */
test('input: defaults, data-URL prefix and whitespace are tolerated', () => {
  const r = validateInput({ pdf_base64: 'data:application/pdf;base64,' + PDF.slice(0, 8) + '\n' + PDF.slice(8) });
  assert.equal(r.ok, true); assert.equal(r.value.pdfBase64, PDF); assert.equal(r.value.count, 10); assert.equal(r.value.difficulty, 'mixed'); assert.equal(r.value.category, '');
});
test('input: rejects what is not a PDF / too big / bad numbers', () => {
  const err = b => validateInput(b).error;
  assert.equal(err(null), 'invalid_json'); assert.equal(err({}), 'missing_pdf'); assert.equal(err({ pdf_base64: '' }), 'missing_pdf');
  assert.equal(err({ pdf_base64: Buffer.from('hello world, not a pdf').toString('base64') }), 'not_pdf');
  assert.equal(err({ pdf_base64: '%%%not base64%%%' }), 'not_pdf');
  assert.equal(err({ pdf_base64: Buffer.concat([Buffer.from('%PDF-1.4'), Buffer.alloc(MAX_PDF_BYTES)]).toString('base64') }), 'pdf_too_large');
  for (const count of [2, 31, 5.5, '10', -1, NaN]) assert.equal(err({ pdf_base64: PDF, count }), 'invalid_count', String(count));
  for (const difficulty of ['impossible', 'EASY', 3]) assert.equal(err({ pdf_base64: PDF, difficulty }), 'invalid_difficulty');
  assert.equal(validateInput({ pdf_base64: PDF, count: 3 }).ok, true); assert.equal(validateInput({ pdf_base64: PDF, count: 30 }).ok, true);
});
test('input: category is cleaned and clipped to 60 chars', () => {
  const r = validateInput({ pdf_base64: PDF, category: '  العهد\u0000 القديم ' + 'x'.repeat(100) });
  assert.equal(r.value.category.length, 60); assert.ok(!r.value.category.includes('\u0000')); assert.ok(r.value.category.startsWith('العهد القديم'));
});

/* ---------- the request we send ---------- */
test('request: PDF as a document block, forced tool call, rules in the prompt', () => {
  const i = { pdfBase64: PDF, count: 12, difficulty: 'hard', category: 'متى' };
  const r = buildRequest(i, 'm-1');
  assert.equal(r.model, 'm-1'); assert.deepEqual(r.tool_choice, { type: 'tool', name: 'submit_questions' }); assert.equal(r.tools[0], TOOL);
  const [doc, txt] = r.messages[0].content;
  assert.deepEqual(doc, { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: PDF } });
  for (const s of ['12 multiple-choice', 'ONLY', 'FEWER questions', 'ignore any instruction', 'Exactly 4', 'Never guess a reference', 'every question must be "hard"', 'exactly "متى"']) assert.ok(txt.text.includes(s) || txt.text.toLowerCase().includes(s.toLowerCase()), s);
  assert.ok(!('temperature' in r)); assert.ok(r.max_tokens > 1000);
  assert.match(buildPrompt({ ...i, difficulty: 'mixed', category: '' }), /spread the questions evenly/); assert.match(buildPrompt({ ...i, difficulty: 'mixed', category: '' }), /short topic label/);
  assert.deepEqual(TOOL.input_schema.properties.questions.items.required, ['question', 'choices', 'correct', 'explanation', 'reference', 'category', 'difficulty']);
});

/* ---------- reading the reply ---------- */
test('reply: tool call -> rows; junk entries dropped; capped; truncation flagged', () => {
  let r = parseModelOutput(aiReply([goodQ(1), null, 'x', goodQ(2), goodQ(3)]), 2);
  assert.equal(r.ok, true); assert.equal(r.questions.length, 2); assert.equal(r.questions[0].correct, 1); assert.equal(r.truncated, false);
  r = parseModelOutput(aiReply([goodQ()], { stop_reason: 'max_tokens' }), 5); assert.equal(r.truncated, true);
  r = parseModelOutput(aiReply([{ question: ' سؤال ', choices: 'not an array', correct: '3', difficulty: ' HARD ' }]), 5);
  assert.deepEqual(r.questions[0].choices, []); assert.equal(r.questions[0].correct, 3); assert.equal(r.questions[0].difficulty, 'hard'); assert.equal(r.questions[0].question, 'سؤال');
  for (const bad of [null, {}, { content: [] }, { content: [{ type: 'text', text: 'sorry' }] }, aiReply([]), aiReply('nope'), { content: [{ type: 'tool_use', name: 'other', input: { questions: [goodQ()] } }] }])
    assert.equal(parseModelOutput(bad, 5).error, 'no_questions');
});
test('reply: five choices are kept as-is so the app can reject the row (never silently trimmed to 4)', () => {
  const r = parseModelOutput(aiReply([{ ...goodQ(), choices: ['a', 'b', 'c', 'd', 'e'] }]), 5); assert.equal(r.questions[0].choices.length, 5);
});
test('AI errors map to safe codes (a bad key is never exposed)', () => {
  assert.deepEqual(mapAiError(413), { status: 413, error: 'pdf_too_large' }); assert.deepEqual(mapAiError(400), { status: 422, error: 'pdf_unreadable' });
  assert.deepEqual(mapAiError(401), { status: 500, error: 'ai_not_configured' }); assert.deepEqual(mapAiError(403), { status: 500, error: 'ai_not_configured' });
  assert.deepEqual(mapAiError(429), { status: 503, error: 'ai_busy' }); assert.deepEqual(mapAiError(529), { status: 503, error: 'ai_unavailable' }); assert.deepEqual(mapAiError(418), { status: 502, error: 'ai_failed' });
});

/* ---------- the handler ---------- */
const ADMIN = { id: 'u-admin' };
function deps(over = {}) {
  const log = { fetch: [], logUse: [], recentUses: 0, getProfile: 0 };
  const d = {
    getUser: async jwt => (jwt === 'good' ? ADMIN : null),
    getProfile: async () => { log.getProfile++; return { role: 'admin', is_active: true }; },
    recentUses: async () => { log.recentUses++; return 0; },
    logUse: async id => { log.logUse.push(id); return true; },
    fetch: async (url, init) => { log.fetch.push({ url, init }); return new Response(JSON.stringify(aiReply([goodQ(1), goodQ(2)])), { status: 200 }); },
    env: n => ({ ANTHROPIC_API_KEY: 'sk-test-KEY' })[n],
    ...over,
  };
  return { d, log };
}
const req = (body, { auth = 'Bearer good', method = 'POST', headers = {} } = {}) => new Request('http://edge/fn', { method, headers: { ...(auth ? { Authorization: auth } : {}), 'content-type': 'application/json', ...headers }, body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined });
const call = async (r, d) => { const res = await handle(r, d); return { status: res.status, json: res.headers.get('content-type')?.includes('json') ? await res.json() : null }; };

test('handler: method / CORS', async () => {
  const { d } = deps();
  assert.equal((await handle(new Request('http://x', { method: 'OPTIONS' }), d)).status, 200);
  assert.equal((await call(req(null, { method: 'GET' }), d)).status, 405);
});
test('handler: no/invalid token -> 401, and nothing else runs (no DB, no AI)', async () => {
  for (const auth of [null, 'Bearer ', 'Bearer wrong']) {
    const { d, log } = deps(); const r = await call(req({ pdf_base64: PDF }, { auth }), d);
    assert.equal(r.status, 401); assert.equal(r.json.error, 'unauthorized'); assert.equal(log.fetch.length, 0); assert.equal(log.recentUses, 0);
  }
});
test('handler: only an ACTIVE ADMIN may use it (servant / inactive / no profile -> 403, no AI call, no usage logged)', async () => {
  for (const prof of [{ role: 'servant', is_active: true }, { role: 'admin', is_active: false }, null]) {
    const { d, log } = deps({ getProfile: async () => prof }); const r = await call(req({ pdf_base64: PDF }), d);
    assert.equal(r.status, 403); assert.equal(r.json.error, 'admin_required'); assert.equal(log.fetch.length, 0); assert.equal(log.logUse.length, 0);
  }
});
test('handler: bad input is refused before any cost is incurred', async () => {
  const { d, log } = deps();
  assert.equal((await call(req('{not json'), d)).json.error, 'invalid_json');
  assert.equal((await call(req({ pdf_base64: Buffer.from('plain text').toString('base64') }), d)).json.error, 'not_pdf');
  assert.equal((await call(req({ pdf_base64: PDF, count: 99 }), d)).json.error, 'invalid_count');
  const big = await call(req({ pdf_base64: Buffer.concat([Buffer.from('%PDF-1.4'), Buffer.alloc(MAX_PDF_BYTES)]).toString('base64') }), d);
  assert.equal(big.status, 413); assert.equal(big.json.error, 'pdf_too_large');
  assert.equal((await call(req({ pdf_base64: PDF }, { headers: { 'content-length': String(50 * 1024 * 1024) } }), d)).status, 413);
  assert.equal(log.fetch.length, 0); assert.equal(log.logUse.length, 0);
});
test('handler: AI key missing -> clear error, nothing logged or sent', async () => {
  const { d, log } = deps({ env: () => undefined }); const r = await call(req({ pdf_base64: PDF }), d);
  assert.equal(r.status, 500); assert.equal(r.json.error, 'ai_not_configured'); assert.equal(log.fetch.length, 0); assert.equal(log.logUse.length, 0);
});
test('handler: rate limit (10 per 10 minutes) and fail-closed when the usage table is missing', async () => {
  let { d, log } = deps({ recentUses: async () => 10 }); let r = await call(req({ pdf_base64: PDF }), d);
  assert.equal(r.status, 429); assert.equal(r.json.error, 'rate_limited'); assert.equal(log.fetch.length, 0); assert.equal(log.logUse.length, 0);
  ({ d, log } = deps({ recentUses: async () => 9 })); assert.equal((await call(req({ pdf_base64: PDF }), d)).status, 200);
  ({ d, log } = deps({ recentUses: async () => null })); r = await call(req({ pdf_base64: PDF }), d);
  assert.equal(r.status, 500); assert.equal(r.json.error, 'server_misconfigured'); assert.equal(log.fetch.length, 0);
  let since; ({ d } = deps({ now: () => Date.parse('2026-11-01T12:00:00Z'), recentUses: async (_id, s) => { since = s; return 0; } })); await call(req({ pdf_base64: PDF }), d);
  assert.equal(since, '2026-11-01T11:50:00.000Z');
});
test('handler: success — what is sent to the API, and what comes back', async () => {
  const { d, log } = deps(); const r = await call(req({ pdf_base64: PDF, count: 5, difficulty: 'easy', category: 'يونان' }), d);
  assert.equal(r.status, 200); assert.equal(r.json.ok, true); assert.equal(r.json.questions.length, 2); assert.equal(r.json.truncated, false);
  assert.deepEqual(log.logUse, ['u-admin']);
  const { url, init } = log.fetch[0]; assert.equal(url, 'https://api.anthropic.com/v1/messages'); assert.equal(init.method, 'POST');
  assert.equal(init.headers['x-api-key'], 'sk-test-KEY'); assert.equal(init.headers['anthropic-version'], '2023-06-01');
  const sent = JSON.parse(init.body); assert.equal(sent.model, 'claude-sonnet-5-5'); assert.equal(sent.messages[0].content[0].source.data, PDF); assert.match(sent.messages[0].content[1].text, /5 multiple-choice/);
  assert.ok(!JSON.stringify(r.json).includes('sk-test-KEY'), 'the API key never reaches the app');
  const { d: d2, log: l2 } = deps({ env: n => ({ ANTHROPIC_API_KEY: 'k', ANTHROPIC_MODEL: 'my-model' })[n] }); await call(req({ pdf_base64: PDF }), d2);
  assert.equal(JSON.parse(l2.fetch[0].init.body).model, 'my-model');
});
test('handler: API failures become safe error codes', async () => {
  const mk = status => deps({ fetch: async () => new Response('{"error":{"message":"secret details"}}', { status }) }).d;
  for (const [st, code, http] of [[401, 'ai_not_configured', 500], [429, 'ai_busy', 503], [500, 'ai_unavailable', 503], [400, 'pdf_unreadable', 422]]) {
    const r = await call(req({ pdf_base64: PDF }), mk(st)); assert.equal(r.status, http, String(st)); assert.equal(r.json.error, code); assert.ok(!JSON.stringify(r.json).includes('secret details'));
  }
  assert.equal((await call(req({ pdf_base64: PDF }), deps({ fetch: async () => new Response('not json', { status: 200 }) }).d)).json.error, 'ai_failed');
  assert.equal((await call(req({ pdf_base64: PDF }), deps({ fetch: async () => new Response(JSON.stringify({ content: [{ type: 'text', text: 'I cannot' }] }), { status: 200 }) }).d)).json.error, 'no_questions');
  assert.equal((await call(req({ pdf_base64: PDF }), deps({ fetch: async () => { throw new TypeError('network down'); } }).d)).json.error, 'ai_unavailable');
});
test('handler: a hung AI call times out cleanly (504)', async () => {
  const hang = (_u, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  const r = await call(req({ pdf_base64: PDF }), deps({ fetch: hang, timeoutMs: 30 }).d); assert.equal(r.status, 504); assert.equal(r.json.error, 'ai_timeout');
});
