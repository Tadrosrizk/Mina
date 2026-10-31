// Browser test of the admin UI (headless Chromium, phone-sized viewport, the app's REAL stylesheet + REAL SheetJS + the two real JS files).
// The backend is a STUB that follows the contract of supabase-bible-comp-2-import.sql — it checks what the client sends and how it renders replies; it does NOT run the SQL.
// Run: NODE_PATH=<dir containing playwright> node --test tests/bible-import-ui.test.mjs      (needs: python3 tests/make_fixtures.py once)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');

const here = path.dirname(fileURLToPath(import.meta.url)), www = path.join(here, '..', 'www'), fx = f => path.join(here, 'fixtures', f);
const SHOTS = process.env.SHOTS_DIR; if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const html = fs.readFileSync(path.join(www, 'index.html')).toString('utf8');
const scripts = [...html.matchAll(/<script[^>]*>[\s\S]*?<\/script>/g)].map(m => [m.index, m.index + m[0].length]);
const css = [...html.matchAll(/<style[^>]*>[\s\S]*?<\/style>/g)].filter(m => !scripts.some(([a, b]) => m.index > a && m.index < b)).map(m => m[0]).join('\n');
const s0 = html.indexOf('/* inlined: libs/xlsx.full.min.js */'), xlsxLib = html.slice(html.indexOf('\n', s0) + 1, html.indexOf('</script>', s0));

const STUBS = `
  window.__calls = []; window.__saved = []; window.__db = { bank: [{ id:'q-existing', question:'في أي مدينة وُلد الرب يسوع؟', status:'approved' }], failDup:false, n:0 };
  window.IS_NATIVE_APP = false; window.hapticTick = () => {}; window.isAdminUser = () => true; window.XLSX_MISSING_MSG = () => 'xlsx missing';
  window.escapeHtml = s => (s||'').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  window.ensureXlsx = async () => typeof XLSX !== 'undefined';
  window.saveWorkbook = async (wb, web, native) => { window.__saved.push({ name: web, sheets: wb.SheetNames, data: Object.fromEntries(wb.SheetNames.map(n => [n, XLSX.utils.sheet_to_json(wb.Sheets[n], { header:1, defval:'' })])) }); };
  const norm = s => window.bcImportLogic.normText(s);
  function handle(name, a){
    const db = window.__db; window.__calls.push({ name, args: JSON.parse(JSON.stringify(a || {})) });
    if(name === 'friday_bc_list') return [];
    if(name === 'friday_bc_find_duplicates'){ if(db.failDup) return { __error:'fetch failed' }; const items = []; a.p_questions.forEach((q, i) => { const h = db.bank.find(b => norm(b.question) === norm(q)); if(h) items.push({ i:i+1, status:h.status }); }); return { ok:true, items }; }
    if(name === 'friday_bc_import_questions'){
      const rejected = []; let ok = 0;
      a.p_rows.forEach(r => { const why = []; if(db.bank.some(b => norm(b.question) === norm(r.question))) why.push('dup_bank'); if(!Array.isArray(r.opts) || r.opts.length !== 4) why.push('opts_not_four'); if(![1,2,3,4].includes(r.correct)) why.push('correct_invalid');
        if(why.length) rejected.push({ row:r.row, question:r.question.slice(0, 80), reasons:why }); else { db.bank.push({ id:'q'+(++db.n), ...r, status:'pending_review' }); ok++; } });
      return { ok:true, imported:ok, rejected };
    }
    if(name === 'friday_bc_pending_list'){ const items = db.bank.filter(b => b.status === 'pending_review').map(b => ({ id:b.id, question:b.question, opts:b.opts, correct:b.correct, reference:b.reference, explanation:b.explanation, category:b.category, difficulty:b.difficulty })); return { ok:true, total:items.length, items }; }
    if(name === 'friday_bc_review_questions'){ let n = 0; a.p_ids.forEach(id => { const b = db.bank.find(x => x.id === id); if(b && b.status === 'pending_review'){ b.status = a.p_action === 'approve' ? 'approved' : 'retired'; n++; } }); return { ok:true, changed:n }; }
    return { ok:false, error:'server' };
  }
  window.__ai = { reply: null, calls: [] };
  const fnErr = code => ({ data:null, error:{ message:'Edge Function returned a non-2xx status code', context:{ json: async () => ({ ok:false, error:code }) } } });
  window.supabaseClient = { functions: { invoke: async (name, o) => { window.__ai.calls.push({ name, body:o.body }); const r = window.__ai.reply;
      if(r === 'throw') throw new Error('Failed to send a request to the Edge Function'); if(r && r.err) return fnErr(r.err); return { data:r, error:null }; } }, rpc: async (name, a) => { const d = handle(name, a); return d && d.__error ? { data:null, error:{ message:d.__error } } : { data:d, error:null }; } };
`;

let browser, page;
test.before(async () => {
  browser = await chromium.launch();
  page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ar-EG' })).newPage();
  page.on('pageerror', e => { throw e; });
  await page.setContent('<!doctype html><html lang="ar" dir="rtl" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' + css + '</head><body></body></html>');
  await page.addScriptTag({ content: STUBS });
  await page.addScriptTag({ content: xlsxLib });
  await page.addScriptTag({ path: path.join(www, 'bible-comp.js') });
  await page.addScriptTag({ path: path.join(www, 'bible-comp-import.js') });
});
test.after(async () => { await browser?.close(); });

const modal = () => page.locator('#bcModal').innerText();
const shot = async n => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, n + '.png') }); };
const calls = n => page.evaluate(n => window.__calls.filter(c => c.name === n), n);

test('admin sees the new buttons; import form explains the rules', async () => {
  await page.evaluate(() => bcOpen());
  await page.waitForSelector('text=استيراد أسئلة');
  assert.match(await modal(), /قيد المراجعة/);
  await page.getByRole('button', { name: /استيراد أسئلة/ }).click();
  const t = await modal();
  assert.match(t, /Question/); assert.match(t, /Correct Answer/); assert.match(t, /500/); assert.match(t, /المكرر بيترفض/);
  await shot('1-form');
});

test('template download: 3 sheets, header row exact, and its Example rows pass our own validation', async () => {
  await page.getByRole('button', { name: /تحميل نموذج/ }).click();
  await page.waitForFunction(() => window.__saved.length === 1);
  const t = await page.evaluate(() => window.__saved[0]);
  assert.equal(t.name, 'bible-questions-template.xlsx'); assert.deepEqual(t.sheets, ['Questions', 'Example', 'Instructions']);
  assert.deepEqual(t.data.Questions, [['Question', 'Choice A', 'Choice B', 'Choice C', 'Choice D', 'Correct Answer', 'Explanation', 'Bible Reference', 'Category', 'Difficulty']]);
  const res = await page.evaluate(d => { const r = bcImportLogic.analyze(d, 0); return { fe: r.fileErrors, ok: r.rows.map(x => x.ok), w: r.rows.map(x => x.warnings) }; }, t.data.Example);
  assert.deepEqual(res.fe, []); assert.deepEqual(res.ok, [true, true]);
});

test('messy file → preview: counts, valid cards, rejected rows with reasons; bank duplicate caught; nothing saved yet', async () => {
  await page.setInputFiles('#bcImpFile', fx('messy.xlsx'));
  await page.waitForSelector('text=معاينة الاستيراد');
  const t = await modal();
  assert.match(t, /16 صف/); assert.match(t, /جاهز: 3/); assert.match(t, /مرفوض: 13/);
  assert.match(t, /الصف 3[\s\S]*موجود بالفعل في بنك الأسئلة \(معتمد\)/);          // row 3 exists in the (stub) bank
  assert.match(t, /الصف 4[\s\S]*الاختيار C فاضي/); assert.match(t, /الصف 5[\s\S]*أكتر من إجابة صحيحة/); assert.match(t, /الصف 6[\s\S]*A أو B أو C أو D/);
  assert.match(t, /الصف 7[\s\S]*مش محددة/); assert.match(t, /الصف 8[\s\S]*الصف 2/); assert.match(t, /الصف 9[\s\S]*اختيارات مكررة/);
  assert.match(t, /هتتستورد \(3\) بحالة «قيد المراجعة»/); assert.match(t, /استيراد 3 سؤال/);
  assert.equal((await page.locator('#bcImpList .cn-row').count()), 3);
  assert.equal((await calls('friday_bc_import_questions')).length, 0, 'nothing is imported before the admin confirms');
  const dup = (await calls('friday_bc_find_duplicates'))[0].args.p_questions; assert.equal(dup.length, 4, 'only schema-valid rows are checked against the bank');
  await shot('2-preview-top');
  await page.locator('#bcModal .modal').evaluate(el => { el.scrollTop = el.scrollHeight; }); await shot('3-preview-bottom');
});

test('rejected rows download: original cells + a reason column, rejected rows only', async () => {
  await page.getByRole('button', { name: /تحميل الصفوف المرفوضة/ }).click();
  await page.waitForFunction(() => window.__saved.length === 2);
  const d = await page.evaluate(() => window.__saved[1]);
  assert.equal(d.name, 'bible-questions-rejected.xlsx');
  const rows = d.data.Questions; assert.equal(rows.length, 1 + 13); assert.equal(rows[0].at(-1), 'Rejection reason / سبب الرفض');
  assert.ok(rows.slice(1).every(r => String(r.at(-1)).length > 3)); assert.match(rows.find(r => r[0] === 'سؤال إجابتين').at(-1), /أكتر من إجابة/);
});

test('import: payload is clean (only valid rows, no status field); a row that became a duplicate meanwhile is rejected by the server and merged into the summary', async () => {
  await page.evaluate(() => window.__db.bank.push({ id: 'q-race', row: 0, question: 'سؤال بحروف عربية للإجابة', opts: ['أ', 'ب', 'ج', 'د'], correct: 3, reference: '', explanation: '', category: 'عام', difficulty: 'hard', status: 'pending_review' }));   // another admin imported row 14 a moment ago
  await page.getByRole('button', { name: /استيراد 3 سؤال/ }).click();
  await page.waitForSelector('text=ملخص الاستيراد');
  const sent = (await calls('friday_bc_import_questions')); assert.equal(sent.length, 1);
  const rows = sent[0].args.p_rows; assert.deepEqual(rows.map(r => r.row), [2, 14, 18]);
  for (const r of rows) { assert.equal(r.opts.length, 4); assert.ok([1, 2, 3, 4].includes(r.correct)); assert.ok(!('status' in r), 'client never chooses a status'); }
  const t = await modal();
  assert.match(t, /إجمالي الصفوف: 16/); assert.match(t, /اتستورد: 2/); assert.match(t, /مرفوض: 14/);
  assert.match(t, /الصف 14[\s\S]*موجود بالفعل/); assert.match(t, /قيد المراجعة/); assert.ok(!/مفيش رد/.test(t));
  const db = await page.evaluate(() => window.__db.bank.filter(b => b.status === 'pending_review' && b.id !== 'q-race').map(b => b.row));
  assert.deepEqual(db, [2, 18]);
  await shot('4-summary');
});

test('pending review: list shows answers, approve changes status, list refreshes', async () => {
  await page.getByRole('button', { name: /مراجعة الأسئلة المستوردة/ }).click();
  await page.waitForSelector('text=الأسئلة قيد المراجعة');
  await page.waitForSelector('#bcPendBody .cn-row');
  let t = await modal(); assert.match(t, /إجمالي المعلّق: 3/); assert.match(t, /✓ B\. إيليا/); assert.match(t, /✓ D\. 4/);     // messy.xlsx row 2 (answer B) and row 18 (answer (d)); 3rd pending = the stub's race row
  await shot('5-pending');
  await page.locator('#bcPendBody .cn-row').first().getByRole('button', { name: /اعتماد/ }).click();
  await page.waitForSelector('text=اتعتمد 1 سؤال');
  const rv = (await calls('friday_bc_review_questions')).at(-1).args; assert.equal(rv.p_action, 'approve'); assert.equal(rv.p_ids.length, 1);
  t = await modal(); assert.match(t, /إجمالي المعلّق: 2/);
  page.once('dialog', d => d.accept());
  await page.getByRole('button', { name: /اعتماد كل المعروض/ }).click();
  await page.waitForSelector('text=اتعتمد 2 سؤال'); assert.match(await modal(), /مفيش أسئلة قيد المراجعة/);
});

test('re-importing a file whose questions are already in the bank: they are rejected as duplicates and the existing rows are untouched', async () => {
  await page.evaluate(() => window.__db.bank.push({ id: 'q-valid-b', question: 'مين بنى الفلك؟', status: 'retired' }));
  await page.evaluate(() => bcImportForm()); await page.setInputFiles('#bcImpFile', fx('valid.xlsx')); await page.waitForSelector('text=معاينة الاستيراد');
  const t = await modal();
  assert.match(t, /جاهز: 2/); assert.match(t, /مرفوض: 2/);
  assert.match(t, /الصف 2[\s\S]*موجود بالفعل في بنك الأسئلة \(معتمد\)/);     // row 2 = the question imported from messy.xlsx and approved above
  assert.match(t, /الصف 3[\s\S]*موجود بالفعل في بنك الأسئلة \(مستبعد\)/);    // row 3 = a retired question: retired questions are not re-imported either
  const before = await page.evaluate(() => JSON.stringify(window.__db.bank));
  await page.getByRole('button', { name: /استيراد 2 سؤال/ }).click(); await page.waitForSelector('text=ملخص الاستيراد');
  const after = await page.evaluate(() => window.__db.bank), old = JSON.parse(before);
  assert.deepEqual(after.slice(0, old.length), old, 'no existing row was changed');
  assert.equal(after.length, old.length + 2); assert.ok(after.slice(old.length).every(b => b.status === 'pending_review'));
});

test('file errors are shown clearly and nothing is saved', async () => {
  await page.evaluate(() => bcImportForm()); await page.setInputFiles('#bcImpFile', fx('missing-columns.xlsx')); await page.waitForSelector('text=الملف مش صالح للاستيراد');
  let t = await modal(); assert.match(t, /أعمدة مطلوبة ناقصة: Correct Answer ، Category ، Difficulty/); assert.match(t, /مفيش حاجة اتحفظت/); await shot('6-file-error');
  await page.evaluate(() => bcImportForm()); await page.setInputFiles('#bcImpFile', fx('too-many.xlsx')); await page.waitForSelector('text=الملف مش صالح للاستيراد');
  assert.match(await modal(), /501 سؤال — أقصى حد 500/);
  await page.evaluate(() => bcImportForm()); await page.setInputFiles('#bcImpFile', fx('not-excel.xlsx'));
  await page.waitForFunction(() => /مش ملف Excel/.test(document.getElementById('bcImpNote')?.textContent || ''));
  await page.evaluate(() => bcImportForm()); await page.setInputFiles('#bcImpFile', fx('empty.xlsx')); await page.waitForSelector('text=الملف فاضي');
});

test('if the duplicate check cannot run (offline), the import is NOT offered', async () => {
  const before = (await calls('friday_bc_import_questions')).length;
  await page.evaluate(() => { window.__db.failDup = true; bcImportForm(); });
  await page.setInputFiles('#bcImpFile', fx('arabic-headers.xlsx'));
  await page.waitForFunction(() => /ماقدرناش نتأكد من التكرار/.test(document.getElementById('bcImpNote')?.textContent || ''));
  assert.ok(!/استيراد 1 سؤال/.test(await modal())); assert.equal((await calls('friday_bc_import_questions')).length, before);
  await page.evaluate(() => { window.__db.failDup = false; });
});

test('no horizontal overflow on a 390px phone for the busiest screens', async () => {
  await page.evaluate(() => bcImportForm()); await page.setInputFiles('#bcImpFile', fx('messy.xlsx')); await page.waitForSelector('text=معاينة الاستيراد');
  const w = await page.evaluate(() => { const m = document.querySelector('#bcModal .modal'); return { sw: m.scrollWidth, cw: m.clientWidth }; });
  assert.ok(w.sw <= w.cw + 1, JSON.stringify(w));
});

/* ====================== PDF -> AI questions ====================== */
const AI = (q, c, a, extra = {}) => ({ question: q, choices: c, correct: a, explanation: 'حسب الملف', reference: 'يونان 1:1', category: 'العهد القديم', difficulty: 'easy', ...extra });
const setAi = r => page.evaluate(r => { window.__ai.reply = r; window.__ai.calls.length = 0; }, r);
const noteText = () => page.locator('#bcImpNote').innerText();

test('PDF form is reachable from the import screen; generating without a file or with a non-PDF is refused locally (no call to the function)', async () => {
  await page.evaluate(() => bcImportForm()); await page.getByRole('button', { name: /توليد أسئلة من ملف PDF/ }).click(); await page.waitForSelector('text=توليد أسئلة من ملف PDF');
  await setAi({ ok: true, questions: [] }); await shot('7-pdf-form');
  await page.getByRole('button', { name: /توليد الأسئلة/ }).click(); assert.match(await noteText(), /اختار ملف PDF/);
  await page.setInputFiles('#bcPdfFile', fx('not-excel.xlsx')); await page.getByRole('button', { name: /توليد الأسئلة/ }).click();
  await page.waitForFunction(() => /مش PDF سليم/.test(document.getElementById('bcImpNote').textContent));
  assert.equal((await page.evaluate(() => window.__ai.calls.length)), 0);
});

test('PDF -> AI questions go through the SAME validation: bad ones are rejected with reasons, good ones previewed', async () => {
  const importsBefore = (await calls('friday_bc_import_questions')).length;
  await setAi({ ok: true, truncated: true, questions: [
    AI('مين اللي أرسله الله إلى نينوى؟', ['يونان', 'إيليا', 'إرميا', 'إشعياء'], 1),
    AI('كم يوم قضى يونان في بطن الحوت؟', ['يوم', 'ثلاثة أيام', 'سبعة أيام', 'أربعون يومًا'], 2, { reference: '', difficulty: 'medium' }),
    AI('سؤال رقم الإجابة فيه غلط', ['أ', 'ب', 'ج', 'د'], 5),
    AI('سؤال بخمس اختيارات', ['أ', 'ب', 'ج', 'د', 'هـ'], 1),
    AI('سؤال بتلات اختيارات بس', ['أ', 'ب', 'ج'], 1),
    AI('في أي مدينة وُلد الرب يسوع؟', ['الناصرة', 'بيت لحم', 'أورشليم', 'كفرناحوم'], 2),
  ] });
  await page.evaluate(() => bcPdfForm()); await page.setInputFiles('#bcPdfFile', fx('sample.pdf'));
  assert.match(await page.locator('#bcPdfName').innerText(), /sample\.pdf/);
  await page.fill('#bcPdfN', '6'); await page.selectOption('#bcPdfD', 'hard'); await page.fill('#bcPdfCat', 'يونان');
  await page.getByRole('button', { name: /توليد الأسئلة/ }).click(); await page.waitForSelector('text=معاينة الاستيراد');
  const call = await page.evaluate(() => window.__ai.calls); assert.equal(call.length, 1); assert.equal(call[0].name, 'friday-bc-pdf-questions');
  assert.ok(call[0].body.pdf_base64.startsWith('JVBERi0'), 'the real PDF bytes were sent as base64'); assert.equal(call[0].body.count, 6); assert.equal(call[0].body.difficulty, 'hard'); assert.equal(call[0].body.category, 'يونان');
  const t = await modal();
  assert.match(t, /أسئلة مولّدة بالذكاء الاصطناعي \(طلبت 6\) · 6 سؤال/); assert.match(t, /راجع الإجابة الصحيحة والمرجع بنفسك/); assert.match(t, /الرد اتقطع/);
  assert.match(t, /جاهز: 2/); assert.match(t, /مرفوض: 4/); assert.match(t, /تنبيهات: 1/);                      // question 2 has no reference
  assert.match(t, /الصف 3[\s\S]*A أو B أو C أو D/); assert.match(t, /الصف 4[\s\S]*أكتر من 4 اختيارات/); assert.match(t, /الصف 5[\s\S]*الاختيار D فاضي/);
  assert.match(t, /الصف 6[\s\S]*موجود بالفعل في بنك الأسئلة \(معتمد\)/);
  assert.equal((await calls('friday_bc_import_questions')).length, importsBefore, 'generating questions never saves anything by itself');
  await shot('8-pdf-preview');
});

test('PDF: confirming imports only the valid AI questions (as plain rows, no status)', async () => {
  const before = (await calls('friday_bc_import_questions')).length;
  await page.getByRole('button', { name: /استيراد 2 سؤال/ }).click(); await page.waitForSelector('text=ملخص الاستيراد');
  const sent = (await calls('friday_bc_import_questions')).at(-1).args.p_rows; assert.equal((await calls('friday_bc_import_questions')).length, before + 1);
  assert.deepEqual(sent.map(r => r.row), [1, 2]); assert.deepEqual(sent.map(r => r.correct), [1, 2]);
  for (const r of sent) { assert.equal(r.opts.length, 4); assert.ok(!('status' in r)); assert.equal(r.category, 'العهد القديم'); }
  assert.match(await modal(), /إجمالي الصفوف: 6/); assert.match(await modal(), /اتستورد: 2/); assert.match(await modal(), /مرفوض: 4/);
});

test('PDF: every function error is shown as a clear Arabic message and nothing is previewed', async () => {
  const cases = { ai_not_configured: /مش مفعّلة/, rate_limited: /وصلت للحد المسموح/, pdf_unreadable: /مقدرناش نقرا الـPDF/, ai_busy: /مشغولة/, ai_timeout: /وقت أطول/, admin_required: /للمسؤول/, no_questions: /ماطلّعش أسئلة/, server_misconfigured: /محتاج إعداد/ };
  for (const [code, re] of Object.entries(cases)) {
    await setAi({ err: code }); await page.evaluate(() => bcPdfForm()); await page.setInputFiles('#bcPdfFile', fx('sample.pdf'));
    await page.getByRole('button', { name: /توليد الأسئلة/ }).click();
    await page.waitForFunction(r => new RegExp(r).test(document.getElementById('bcImpNote')?.textContent || ''), re.source, { timeout: 5000 });
    assert.ok(!/معاينة الاستيراد/.test(await modal()), code);
  }
  await setAi('throw'); await page.evaluate(() => bcPdfForm()); await page.setInputFiles('#bcPdfFile', fx('sample.pdf')); await page.getByRole('button', { name: /توليد الأسئلة/ }).click();
  await page.waitForFunction(() => /مفيش اتصال بالنت/.test(document.getElementById('bcImpNote')?.textContent || ''));
});

test('PDF: an AI reply with zero usable rows shows the file-error screen with a way back to the PDF form', async () => {
  await setAi({ ok: true, questions: [AI('', [], 0)] });
  await page.evaluate(() => bcPdfForm()); await page.setInputFiles('#bcPdfFile', fx('sample.pdf')); await page.getByRole('button', { name: /توليد الأسئلة/ }).click();
  await page.waitForSelector('text=معاينة الاستيراد'); const t = await modal(); assert.match(t, /جاهز: 0/); assert.match(t, /مرفوض: 1/); assert.match(t, /نص السؤال فاضي/);
  assert.match(t, /مفيش أسئلة صالحة للاستيراد/); assert.equal(await page.getByRole('button', { name: /استيراد \d+ سؤال/ }).count(), 0);
  assert.equal(await page.getByRole('button', { name: /ولّد من ملف تاني/ }).count(), 1);
});
