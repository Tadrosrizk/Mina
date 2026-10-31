// Browser test of the AI-generation admin screens (headless Chromium, phone-sized viewport, the app's REAL stylesheet + the REAL bible-comp.js / bible-comp-gen.js).
// The backend is a STUB that follows the contract of friday-bc-generate-questions and supabase-bible-comp-5-generate.sql — it checks what the client sends and how it renders
// the replies; it does NOT run the Edge Function or the SQL.   Run: NODE_PATH=<dir containing playwright> node --test tests/bible-gen-ui.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');

const here = path.dirname(fileURLToPath(import.meta.url)), www = path.join(here, '..', 'www');
const SHOTS = process.env.SHOTS_DIR; if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const html = fs.readFileSync(path.join(www, 'index.html')).toString('utf8');
const scripts = [...html.matchAll(/<script[^>]*>[\s\S]*?<\/script>/g)].map(m => [m.index, m.index + m[0].length]);
const css = [...html.matchAll(/<style[^>]*>[\s\S]*?<\/style>/g)].filter(m => !scripts.some(([a, b]) => m.index > a && m.index < b)).map(m => m[0]).join('\n');

const STUBS = `
  window.__rpc = []; window.__ai = { calls: [], status: null, queue: [] };
  window.__db = { rows: [], n: 0, failSave: false, bank: ['سؤال قديم موجود في البنك بالفعل'] };
  window.isAdminUser = () => window.__admin !== false; window.hapticTick = () => {};
  window.escapeHtml = s => (s||'').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const norm = s => String(s||'').replace(/[\\s\\p{P}\\p{S}]+/gu, '').toLowerCase();
  function handle(name, a){
    const db = window.__db; window.__rpc.push({ name, args: JSON.parse(JSON.stringify(a || {})) });
    if(name === 'friday_bc_list') return [];
    if(name === 'friday_bc_save_generated'){
      if(db.failSave) return { __error: 'fetch failed' };
      const saved = [], rejected = [];
      a.p_rows.forEach((r, k) => { const why = [];
        if(!Array.isArray(r.opts) || r.opts.length !== 4) why.push('need_four_options_one_correct');
        if(![1,2,3,4].includes(r.correct)) why.push('need_four_options_one_correct');
        if(!/\\d+\\s*[:.]\\s*\\d+/.test(r.reference || '')) why.push('ref_required');
        if(db.bank.concat(db.rows.map(x => x.question)).some(q => norm(q) === norm(r.question))) why.push('duplicate_question');
        if(why.length) rejected.push({ i:k+1, reasons:why });
        else { const id = 'g' + (++db.n); db.rows.push({ id, batch:a.p_batch, question:r.question, opts:r.opts, correct:r.correct, reference:r.reference, explanation:r.explanation, category:r.category, difficulty:r.difficulty, status:'pending_review', ai_verified:!!r.verified, note:r.note || '' }); saved.push({ i:k+1, id }); } });
      return { ok:true, saved, rejected };
    }
    if(name === 'friday_bc_batch_list') return { ok:true, items: db.rows.filter(x => x.batch === a.p_batch).map(x => ({ id:x.id, question:x.question, opts:x.opts, correct:x.correct, reference:x.reference, explanation:x.explanation, category:x.category, difficulty:x.difficulty, status:x.status, ai_verified:x.ai_verified, note:x.note })) };
    if(name === 'friday_bc_review_questions'){ let n = 0; a.p_ids.forEach(id => { const x = db.rows.find(r => r.id === id); if(!x) return;
        if(a.p_action === 'approve' && ['pending_review','retired'].includes(x.status)){ x.status = 'approved'; n++; }
        if(a.p_action === 'reject' && ['pending_review','approved'].includes(x.status)){ x.status = 'retired'; n++; } }); return { ok:true, changed:n }; }
    if(name === 'friday_bc_update_question'){ const x = db.rows.find(r => r.id === a.p_id); if(!x) return { ok:false, error:'not_found' };
      Object.assign(x, { question:a.p_question, opts:a.p_opts, correct:a.p_correct, reference:a.p_ref, explanation:a.p_expl, status:'pending_review', ai_verified:false }); return { ok:true, status:'pending_review' }; }
    return { ok:false, error:'server' };
  }
  const fnErr = code => ({ data:null, error:{ message:'Edge Function returned a non-2xx status code', context:{ json: async () => ({ ok:false, error:code }) } } });
  window.supabaseClient = {
    functions: { invoke: async (name, o) => { window.__ai.calls.push({ name, body:o.body });
      if(o.body.action === 'status'){ const s = window.__ai.status; if(s === 'throw') throw new Error('Failed to send a request to the Edge Function'); return { data:s, error:null }; }
      const r = window.__ai.queue.shift(); if(r === 'throw') throw new Error('Failed to send a request to the Edge Function'); if(r && r.err) return fnErr(r.err); return { data:r, error:null }; } },
    rpc: async (name, a) => { const d = handle(name, a); return d && d.__error ? { data:null, error:{ message:d.__error } } : { data:d, error:null }; } };
`;
const BOOKS = [['تكوين','old','law'],['خروج','old','law'],['إشعياء','old','prophets'],['متى','new','gospels'],['يوحنا','new','gospels'],['رومية','new','epistles']].map(([name, testament, section]) => ({ name, testament, section }));
const SECTIONS = [{ id:'law', label:'الشريعة (التوراة)', testament:'old' }, { id:'prophets', label:'الأنبياء', testament:'old' }, { id:'gospels', label:'الأناجيل', testament:'new' }, { id:'epistles', label:'الرسائل', testament:'new' }];
const STATUS_ON = { ok:true, configured:true, model:'m', limits:{ max_count:20, per_window:6, window_minutes:10, per_day:40 }, books:BOOKS, sections:SECTIONS };
const q = (n, o = {}) => ({ question:`ما اسم الشخص رقم ${n} في الآية؟`, choices:[`أ${n}`, `ب${n}`, `ج${n}`, `د${n}`], correct:2, explanation:`الآية تذكر الشخص رقم ${n}.`, reference:`يوحنا ${n}:${n + 1}`, category:'شخصيات', difficulty:'medium', verifier_note:`الآية رقم ${n} تذكر ذلك`, ...o });

let browser, page;
test.before(async () => {
  browser = await chromium.launch();
  page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ar-EG' })).newPage();
  page.on('pageerror', e => { throw e; });
  page.on('dialog', d => d.accept());
  await page.setContent('<!doctype html><html lang="ar" dir="rtl" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' + css + '</head><body></body></html>');
  await page.addScriptTag({ content: STUBS });
  await page.addScriptTag({ path: path.join(www, 'bible-comp.js') });
  await page.addScriptTag({ path: path.join(www, 'bible-comp-gen.js') });
});
test.after(async () => { await browser?.close(); });

const reset = async (status = STATUS_ON, queue = []) => page.evaluate(([st, qu]) => {
  document.getElementById('bcModal')?.remove(); window.__admin = true; window.__rpc = []; window.__ai.calls = []; window.__ai.status = st; window.__ai.queue = qu;
  window.__db.rows = []; window.__db.n = 0; window.__db.failSave = false; window._bcGenState.sel = {}; window._bcGenState.last = null; window._bcGenState.busy = false;
  window._bcGenState.cfg = { topic:'', testament:'any', scope:'', category:'شخصيات', difficulty:'medium', count:5 };
}, [status, queue]);
const txt = () => page.locator('#bcModal').innerText();
const shot = async n => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, n + '.png') }); };
const rpcs = name => page.evaluate(n => window.__rpc.filter(c => c.name === n), name);
const aiCalls = () => page.evaluate(() => window.__ai.calls);
const noHScroll = async () => assert.ok(await page.evaluate(() => { const m = document.querySelector('#bcModal .modal'); return m.scrollWidth <= m.clientWidth + 1 && document.documentElement.scrollWidth <= window.innerWidth + 1; }), 'no horizontal scroll on a 390px phone');
const fill = async (topic, extra = {}) => { await page.fill('#bcGTopic', topic); if (extra.count !== undefined) await page.fill('#bcGN', String(extra.count)); if (extra.diff) await page.selectOption('#bcGDiff', extra.diff); if (extra.test) await page.selectOption('#bcGTest', extra.test); if (extra.scope) await page.selectOption('#bcGScope', extra.scope); if (extra.cat !== undefined) await page.fill('#bcGCat', extra.cat); };

test('menu: the AI button is in the admin menu and NOT shown to non-admins', async () => {
  await reset(); await page.evaluate(() => bcOpen()); await page.waitForSelector('#bcBody button');
  assert.match(await txt(), /توليد بالذكاء الاصطناعي/);
  await reset(); await page.evaluate(() => { window.__admin = false; bcOpen(); }); await page.waitForSelector('#bcBody button');
  assert.doesNotMatch(await txt(), /توليد بالذكاء الاصطناعي/);
});
test('UNAVAILABLE: no key on the server -> clearly marked unavailable, no form, no generate button, no AI call, nothing faked', async () => {
  await reset({ ...STATUS_ON, configured:false, model:null });
  await page.evaluate(() => bcGenAIForm()); await page.waitForSelector('#bcGBody .cn-row');
  const t = await txt(); assert.match(t, /غير متاح حاليًا/); assert.match(t, /ANTHROPIC_API_KEY/); assert.match(t, /مدفوع/);
  assert.equal(await page.locator('#bcGTopic').count(), 0); assert.doesNotMatch(t, /توليد الأسئلة/);
  const calls = await aiCalls(); assert.equal(calls.length, 1); assert.equal(calls[0].body.action, 'status'); assert.equal((await rpcs('friday_bc_save_generated')).length, 0);
  await shot('gen-unavailable'); await noHScroll();
});
test('UNAVAILABLE: function not deployed / offline -> an honest error, not a form', async () => {
  await reset('throw'); await page.evaluate(() => bcGenAIForm()); await page.waitForSelector('#bcGBody .cn-row');
  assert.match(await txt(), /مفيش اتصال بالنت/); assert.equal(await page.locator('#bcGTopic').count(), 0);
});
test('SETTINGS form: every setting is there; Arabic + multiple-choice are fixed; cost + limits are shown; scope list follows the testament', async () => {
  await reset(); await page.evaluate(() => bcGenAIForm()); await page.waitForSelector('#bcGTopic');
  for (const id of ['bcGTopic', 'bcGTest', 'bcGScope', 'bcGCat', 'bcGDiff', 'bcGN']) assert.equal(await page.locator('#' + id).count(), 1, id);
  const t = await txt(); assert.match(t, /اللغة: العربية/); assert.match(t, /اختيار من متعدد/); assert.match(t, /مدفوع/); assert.match(t, /6 طلبات كل 10 دقايق/); assert.match(t, /40 في اليوم/); assert.match(t, /قيد المراجعة/);
  assert.deepEqual(await page.$$eval('#bcGDiff option', o => o.map(x => x.value)), ['easy', 'medium', 'hard']);
  assert.equal(await page.inputValue('#bcGN'), '5'); assert.equal(await page.getAttribute('#bcGN', 'max'), '20');
  const names = async () => page.$$eval('#bcGScope option', o => o.map(x => x.textContent));
  assert.ok((await names()).includes('متى') && (await names()).includes('تكوين'));
  await page.selectOption('#bcGTest', 'old'); let n = await names(); assert.ok(n.includes('تكوين') && !n.includes('متى') && !n.includes('الأناجيل'));
  await page.selectOption('#bcGTest', 'new'); n = await names(); assert.ok(n.includes('متى') && n.includes('الأناجيل') && !n.includes('تكوين'));
  await shot('gen-form'); await noHScroll();
});
test('VALIDATION: nothing is sent when settings are incomplete; declining the cost prompt sends nothing', async () => {
  await reset(); await page.evaluate(() => bcGenAIForm()); await page.waitForSelector('#bcGTopic');
  await page.click('text=✨ توليد الأسئلة'); assert.match(await page.locator('#bcGNote').innerText(), /اكتب موضوع أو اختار سفر/);
  await fill('موضوع', { count: 0 }); await page.click('text=✨ توليد الأسئلة'); assert.match(await page.locator('#bcGNote').innerText(), /من 1 إلى 20/);
  await fill('موضوع', { count: 21 }); await page.click('text=✨ توليد الأسئلة'); assert.match(await page.locator('#bcGNote').innerText(), /من 1 إلى 20/);
  await fill('موضوع', { count: 3, cat: '' }); await page.click('text=✨ توليد الأسئلة'); assert.match(await page.locator('#bcGNote').innerText(), /اكتب التصنيف/);
  assert.equal((await aiCalls()).filter(c => c.body.action === 'generate').length, 0);
  page.removeAllListeners('dialog'); page.once('dialog', d => d.dismiss());
  await fill('موضوع', { count: 3, cat: 'شخصيات' }); await page.click('text=✨ توليد الأسئلة'); await page.waitForTimeout(150);
  assert.equal((await aiCalls()).filter(c => c.body.action === 'generate').length, 0, 'declined -> no paid call'); page.on('dialog', d => d.accept());
});
test('GENERATE: exact request sent (settings, Arabic, mcq); verified questions saved ONLY as pending; rejected ones listed with reasons; nothing approved', async () => {
  await reset(STATUS_ON, [{ ok:true, requested:4, truncated:false, questions:[q(1), q(2), q(3)], rejected:[{ question:'سؤال بمرجع مخترع', reasons:['ref_chapter_range'] }, { question:'سؤال مكرر', reasons:['dup_bank'] }] }]);
  await page.evaluate(() => bcGenAIForm()); await page.waitForSelector('#bcGTopic');
  await fill('معجزات الرب يسوع', { count: 4, diff: 'hard', test: 'new', scope: 's:gospels', cat: 'معجزات' }); await page.click('text=✨ توليد الأسئلة');
  await page.waitForSelector('#bcGRev .cn-row');
  const gen = (await aiCalls()).find(c => c.body.action === 'generate').body;
  assert.deepEqual(gen, { action:'generate', topic:'معجزات الرب يسوع', testament:'new', category:'معجزات', difficulty:'hard', count:4, language:'ar', format:'mcq', section:'gospels' });
  const save = (await rpcs('friday_bc_save_generated')); assert.equal(save.length, 1); assert.equal(save[0].args.p_rows.length, 3);
  assert.ok(save[0].args.p_rows.every(r => r.opts.length === 4 && [1, 2, 3, 4].includes(r.correct) && /\d+:\d+/.test(r.reference) && r.explanation && r.category && r.difficulty));
  assert.equal((await rpcs('friday_bc_review_questions')).length, 0, 'the client never approves/rejects on its own');
  assert.equal(await page.evaluate(() => window.__db.rows.every(r => r.status === 'pending_review')), true);
  const t = await txt(); assert.match(t, /مراجعة الأسئلة المولّدة/); assert.equal((t.match(/⏳ قيد المراجعة/g) || []).length, 3); assert.doesNotMatch(t, /✅ معتمد/);
  assert.match(t, /المطلوب: 4/); assert.match(t, /اتحفظ: 3/); assert.match(t, /اترفض: 2/); assert.match(t, /رقم الأصحاح مش موجود في السفر/); assert.match(t, /موجود بالفعل في البنك/);
  assert.match(t, /الفحص الآلي مش بديل عن مراجعتك/); assert.match(t, /الآية حسب المراجِع الآلي/); assert.match(t, /يوحنا 1:2/); assert.match(t, /اتفحص آليًا/);
  await shot('gen-review'); await noHScroll();
});
test('book + testament scope is sent as "book"', async () => {
  await reset(STATUS_ON, [{ ok:true, requested:2, questions:[q(1)], rejected:[] }]); await page.evaluate(() => bcGenAIForm()); await page.waitForSelector('#bcGTopic');
  await fill('', { count: 2, test: 'old', scope: 'b:تكوين' }); await page.click('text=✨ توليد الأسئلة'); await page.waitForSelector('#bcGRev .cn-row');
  const g = (await aiCalls()).find(c => c.body.action === 'generate').body; assert.equal(g.book, 'تكوين'); assert.equal(g.testament, 'old'); assert.ok(!('section' in g));
});
test('EDIT: opens with the current values; saving keeps «قيد المراجعة» and marks the AI check as no longer applying; invalid edits are not sent', async () => {
  await reset(STATUS_ON, [{ ok:true, requested:2, questions:[q(1), q(2)], rejected:[] }]); await page.evaluate(() => bcGenAIForm()); await page.waitForSelector('#bcGTopic');
  await fill('x', { count: 2 }); await page.click('text=✨ توليد الأسئلة'); await page.waitForSelector('#bcGRev .cn-row');
  await page.locator('text=✏️ تعديل').first().click(); await page.waitForSelector('#bcGEQ');
  assert.equal(await page.inputValue('#bcGEO1'), 'ب1'); assert.equal(await page.inputValue('#bcGER'), 'يوحنا 1:2'); assert.equal(await page.isChecked('input[name=bcGEC][value="2"]'), true);
  await page.fill('#bcGEO0', ''); await page.click('text=حفظ التعديل'); assert.match(await page.locator('#bcMsg').innerText(), /املأ السؤال/); assert.equal((await rpcs('friday_bc_update_question')).length, 0);
  await page.fill('#bcGEO0', 'أ1 معدّل'); await page.fill('#bcGEQ', 'سؤال بعد التعديل؟'); await page.check('input[name=bcGEC][value="3"]'); await page.click('text=حفظ التعديل');
  await page.waitForSelector('#bcGRev .cn-row'); const up = (await rpcs('friday_bc_update_question'))[0].args;
  assert.equal(up.p_question, 'سؤال بعد التعديل؟'); assert.deepEqual(up.p_opts, ['أ1 معدّل', 'ب1', 'ج1', 'د1']); assert.equal(up.p_correct, 3); assert.equal(up.p_cat, 'شخصيات');
  const t = await txt(); assert.match(t, /سؤال بعد التعديل؟/); assert.match(t, /اتعدّل/); assert.equal((t.match(/⏳ قيد المراجعة/g) || []).length, 2); assert.equal((await rpcs('friday_bc_review_questions')).length, 0);
  await shot('gen-edit-done');
});
test('REGENERATE one: asks for ONE replacement (avoiding every question in the batch), saves it FIRST, only then rejects the old one', async () => {
  await reset(STATUS_ON, [{ ok:true, requested:2, questions:[q(1), q(2)], rejected:[] }, { ok:true, requested:1, questions:[q(7)], rejected:[] }]);
  await page.evaluate(() => bcGenAIForm()); await page.waitForSelector('#bcGTopic'); await fill('x', { count: 2 }); await page.click('text=✨ توليد الأسئلة'); await page.waitForSelector('#bcGRev .cn-row');
  await page.locator('text=🔄 سؤال بديل').first().click(); await page.waitForFunction(() => /رقم 7/.test(document.getElementById('bcModal').innerText));
  const g = (await aiCalls()).filter(c => c.body.action === 'generate'); assert.equal(g.length, 2); assert.equal(g[1].body.count, 1); assert.deepEqual(g[1].body.avoid, ['ما اسم الشخص رقم 1 في الآية؟', 'ما اسم الشخص رقم 2 في الآية؟']);
  const order = await page.evaluate(() => window.__rpc.map(c => c.name).filter(n => /save_generated|review_questions/.test(n))); assert.deepEqual(order, ['friday_bc_save_generated', 'friday_bc_save_generated', 'friday_bc_review_questions']);
  const rv = (await rpcs('friday_bc_review_questions'))[0].args; assert.equal(rv.p_action, 'reject'); assert.equal(rv.p_ids.length, 1);
  const st = await page.evaluate(() => window.__db.rows.map(r => r.status)); assert.deepEqual(st, ['retired', 'pending_review', 'pending_review']);
  assert.equal(await page.evaluate(() => window.__db.rows.filter(r => r.status === 'approved').length), 0);
});
test('REGENERATE fails (verifier rejects the replacement / AI error / duplicate on save) -> the OLD question is left untouched', async () => {
  for (const reply of [{ ok:true, requested:1, questions:[], rejected:[{ question:'x', reasons:['verify_mismatch'] }] }, { err:'ai_busy' }, 'throw', { ok:true, requested:1, questions:[q(1)], rejected:[] }]) {
    await reset(STATUS_ON, [{ ok:true, requested:1, questions:[q(1)], rejected:[] }, reply]);
    await page.evaluate(() => bcGenAIForm()); await page.waitForSelector('#bcGTopic'); await fill('x', { count: 1 }); await page.click('text=✨ توليد الأسئلة'); await page.waitForSelector('#bcGRev .cn-row');
    await page.locator('text=🔄 سؤال بديل').first().click(); await page.waitForFunction(() => /[؟ا-ي]/.test(document.getElementById('bcMsg').innerText) && document.getElementById('bcMsg').innerText.length > 3);
    assert.equal((await rpcs('friday_bc_review_questions')).length, 0, JSON.stringify(reply)); assert.deepEqual(await page.evaluate(() => window.__db.rows.map(r => r.status)), ['pending_review']);
  }
  assert.match(await page.locator('#bcMsg').innerText(), /السؤال القديم زي ما هو|البديل اترفض/);
});
test('APPROVE one / REJECT one: only on an explicit tap, one call each; decided questions lose their buttons', async () => {
  await reset(STATUS_ON, [{ ok:true, requested:3, questions:[q(1), q(2), q(3)], rejected:[] }]);
  await page.evaluate(() => bcGenAIForm()); await page.waitForSelector('#bcGTopic'); await fill('x', { count: 3 }); await page.click('text=✨ توليد الأسئلة'); await page.waitForSelector('#bcGRev .cn-row');
  await page.locator('text=✅ اعتماد').first().click(); await page.waitForFunction(() => /✅ معتمد/.test(document.getElementById('bcModal').innerText));
  await page.locator('text=🗑 رفض').first().click(); await page.waitForFunction(() => /🗑 مرفوض/.test(document.getElementById('bcModal').innerText));
  const calls = await rpcs('friday_bc_review_questions'); assert.deepEqual(calls.map(c => c.args.p_action), ['approve', 'reject']);
  assert.deepEqual(await page.evaluate(() => window.__db.rows.map(r => r.status)), ['approved', 'retired', 'pending_review']);
  const t = await txt(); assert.equal((t.match(/✅ اعتماد/g) || []).length - (t.match(/✅ اعتماد المحدد/g) || []).length, 1, 'only the still-pending question keeps its approve button');
});
test('BULK approve: select some -> approve selected only, with a confirmation; nothing selected -> nothing sent', async () => {
  await reset(STATUS_ON, [{ ok:true, requested:4, questions:[q(1), q(2), q(3), q(4)], rejected:[] }]);
  await page.evaluate(() => bcGenAIForm()); await page.waitForSelector('#bcGTopic'); await fill('x', { count: 4 }); await page.click('text=✨ توليد الأسئلة'); await page.waitForSelector('#bcGRev .cn-row');
  await page.click('text=اعتماد المحدد (0)'); assert.match(await page.locator('#bcMsg').innerText(), /حدّد سؤال واحد على الأقل/); assert.equal((await rpcs('friday_bc_review_questions')).length, 0);
  await page.check('#bcGSel0'); await page.check('#bcGSel2'); assert.match(await txt(), /اعتماد المحدد \(2\)/);
  let confirmText = ''; page.removeAllListeners('dialog'); page.once('dialog', d => { confirmText = d.message(); d.accept(); });
  await page.click('text=اعتماد المحدد (2)'); await page.waitForFunction(() => /اتعتمد 2 سؤال/.test(document.getElementById('bcMsg').innerText)); page.on('dialog', d => d.accept());
  assert.match(confirmText, /اعتماد 2 سؤال/); assert.match(confirmText, /راجعتها/);
  const rv = (await rpcs('friday_bc_review_questions'))[0].args; assert.equal(rv.p_action, 'approve'); assert.equal(rv.p_ids.length, 2);
  assert.deepEqual(await page.evaluate(() => window.__db.rows.map(r => r.status)), ['approved', 'pending_review', 'approved', 'pending_review']);
  await page.click('text=☑️ تحديد الكل'); assert.match(await txt(), /اعتماد المحدد \(2\)/);
  await page.click('text=إلغاء التحديد'); assert.match(await txt(), /اعتماد المحدد \(0\)/);
});
test('FAILURES: every error is shown in Arabic, nothing is saved, no review screen for a failed run', async () => {
  const cases = [[{ err:'verify_failed' }, /فشل التحقق الآلي/], [{ err:'verify_timeout' }, /التحقق الآلي أخد وقت طويل/], [{ err:'rate_limited' }, /وصلت للحد المسموح/], [{ err:'daily_limit' }, /للحد اليومي/], [{ err:'ai_busy' }, /مشغولة/],
    [{ err:'ai_quota' }, /رصيد/], [{ err:'ai_not_configured' }, /غير مفعّلة/], [{ err:'ai_timeout' }, /وقت أطول/], [{ err:'unauthorized' }, /سجّل دخول/], [{ err:'admin_required' }, /للمسؤول فقط/], ['throw', /مفيش اتصال بالنت/]];
  for (const [reply, re] of cases) {
    await reset(STATUS_ON, [reply]); await page.evaluate(() => bcGenAIForm()); await page.waitForSelector('#bcGTopic'); await fill('x', { count: 2 }); await page.click('text=✨ توليد الأسئلة');
    await page.waitForFunction(() => document.getElementById('bcGNote').innerText.length > 3 && !/جارِ/.test(document.getElementById('bcGNote').innerText));
    assert.match(await page.locator('#bcGNote').innerText(), re, JSON.stringify(reply)); assert.equal((await rpcs('friday_bc_save_generated')).length, 0); assert.equal(await page.locator('#bcGRev').count(), 0);
    assert.equal(await page.locator('button:has-text("توليد الأسئلة")').isDisabled(), false, 'the button is usable again');
  }
});
test('ALL REJECTED: zero verified questions -> nothing saved, the reasons are shown', async () => {
  await reset(STATUS_ON, [{ ok:true, requested:2, questions:[], rejected:[{ question:'آية غير موجودة', reasons:['ref_unknown_book'] }, { question:'مش متأكد منها', reasons:['verify_ref_not_found'] }] }]);
  await page.evaluate(() => bcGenAIForm()); await page.waitForSelector('#bcGTopic'); await fill('x', { count: 2 }); await page.click('text=✨ توليد الأسئلة'); await page.waitForSelector('#bcGRev');
  assert.equal((await rpcs('friday_bc_save_generated')).length, 0); const t = await txt();
  assert.match(t, /مفيش أسئلة اتحفظت/); assert.match(t, /السفر في المرجع مش موجود/); assert.match(t, /المراجِع ما لقاش المرجع/); assert.match(t, /اتحفظ: 0/);
});
test('DATABASE refuses some rows (duplicate / missing reference) -> they are listed as rejected, the rest are kept pending', async () => {
  await reset(STATUS_ON, [{ ok:true, requested:3, questions:[q(1), q(2, { question:'سؤال قديم موجود في البنك بالفعل' }), q(3, { reference:'' })], rejected:[] }]);
  await page.evaluate(() => bcGenAIForm()); await page.waitForSelector('#bcGTopic'); await fill('x', { count: 3 }); await page.click('text=✨ توليد الأسئلة'); await page.waitForSelector('#bcGRev .cn-row');
  const t = await txt(); assert.match(t, /اتحفظ: 1/); assert.match(t, /اترفض: 2/); assert.match(t, /المرجع مطلوب/); assert.equal((t.match(/⏳ قيد المراجعة/g) || []).length, 1);
});
test('DATABASE unreachable while saving -> clear error, no review screen, the user is told nothing was saved', async () => {
  await reset(STATUS_ON, [{ ok:true, requested:1, questions:[q(1)], rejected:[] }]); await page.evaluate(() => { window.__db.failSave = true; });
  await page.evaluate(() => bcGenAIForm()); await page.waitForSelector('#bcGTopic'); await fill('x', { count: 1 }); await page.click('text=✨ توليد الأسئلة');
  await page.waitForFunction(() => /ماتحفظش أي سؤال/.test(document.getElementById('bcGNote').innerText)); assert.equal(await page.locator('#bcGRev').count(), 0);
});
test('LAYOUT: very long unbroken text never widens the phone screen (review + rejected lists)', async () => {
  const long = 'ا'.repeat(380);
  await reset(STATUS_ON, [{ ok:true, requested:1, questions:[q(1, { question:long, choices:['ب'.repeat(190), 'ج'.repeat(190), 'د'.repeat(190), 'ه'.repeat(190)], explanation:'و'.repeat(300), verifier_note:'ز'.repeat(280) })], rejected:[{ question:'س'.repeat(120), reasons:['verify_unsupported'] }] }]);
  await page.evaluate(() => bcGenAIForm()); await page.waitForSelector('#bcGTopic'); await fill('x', { count: 1 }); await page.click('text=✨ توليد الأسئلة'); await page.waitForSelector('#bcGRev .cn-row');
  await noHScroll(); await shot('gen-long');
});
test('SAFETY: HTML in generated text is escaped, never executed', async () => {
  await reset(STATUS_ON, [{ ok:true, requested:1, questions:[q(1, { question:'<img src=x onerror="window.__pwned=1"> سؤال', explanation:'<script>window.__pwned=1</script>شرح', verifier_note:'<b onmouseover=1>x</b>' })], rejected:[{ question:'<i>x</i>', reasons:['dup_bank'] }] }]);
  await page.evaluate(() => { window.__pwned = 0; bcGenAIForm(); }); await page.waitForSelector('#bcGTopic'); await fill('x', { count: 1 }); await page.click('text=✨ توليد الأسئلة'); await page.waitForSelector('#bcGRev .cn-row');
  assert.equal(await page.evaluate(() => window.__pwned), 0); assert.equal(await page.locator('#bcModal img, #bcModal script, #bcModal b[onmouseover]').count(), 0); assert.match(await txt(), /<img src=x/);
});
