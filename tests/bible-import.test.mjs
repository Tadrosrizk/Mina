// Run: node --test tests/bible-import.test.mjs      (needs: python3 tests/make_fixtures.py once)
// Loads the REAL SheetJS build that is inlined in www/index.html, so the parser is exercised exactly as in the app.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const www = path.join(here, '..', 'www');
const html = fs.readFileSync(path.join(www, 'index.html')).toString('utf8');
const start = html.indexOf('/* inlined: libs/xlsx.full.min.js */');
const code = html.slice(html.indexOf('\n', start) + 1, html.indexOf('</script>', start));
const m = { exports: {} };
new Function('exports', 'module', 'require', code)(m.exports, m, undefined);
globalThis.XLSX = m.exports;
const L = createRequire(import.meta.url)(path.join(www, 'bible-comp-import.js'));

const load = f => {
  const b = fs.readFileSync(path.join(here, 'fixtures', f));
  const w = L.readWorkbook(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  return { w, r: L.analyze(w.matrix, w.start) };
};
const byRow = r => Object.fromEntries(r.rows.map(x => [x.row, x]));

test('SheetJS loaded from the app', () => assert.ok(globalThis.XLSX.version, 'XLSX.version'));

test('valid.xlsx: 4 valid rows, reads the "Questions" sheet, correct answers parsed from letters/numbers', () => {
  const { w, r } = load('valid.xlsx');
  assert.equal(w.sheet, 'Questions'); assert.deepEqual(r.fileErrors, []);
  assert.equal(r.rows.length, 4); assert.ok(r.rows.every(x => x.ok));
  assert.deepEqual(r.rows.map(x => x.clean.correct), [1, 2, 3, 4]);
  assert.deepEqual(r.rows.map(x => x.clean.difficulty), ['easy', 'easy', 'medium', 'hard']);
  assert.deepEqual(r.rows.map(x => x.row), [2, 3, 4, 5]);                       // Excel row numbers
  assert.equal(r.rows[0].clean.opts.length, 4);
});

test('messy.xlsx: exactly the expected rows are accepted / rejected, with the expected reasons', () => {
  const { r } = load('messy.xlsx'); const x = byRow(r);
  assert.deepEqual(r.fileErrors, []);
  assert.equal(r.rows.length, 16, 'blank row 11 is skipped, not counted');
  assert.deepEqual(r.rows.filter(a => a.ok).map(a => a.row), [2, 3, 14, 18]);
  const expect = { 4:['opt_missing:C'], 5:['correct_multiple'], 6:['correct_invalid'], 7:['correct_missing'], 8:['dup_file:2'], 9:['opts_duplicate'],
    10:['cat_missing', 'diff_invalid'], 12:['q_missing'], 13:['q_long'], 15:['expl_long'], 16:['ref_long'], 17:['correct_multiple'] };
  for (const [row, reasons] of Object.entries(expect)) assert.deepEqual(x[row].reasons, reasons, 'row ' + row);
  assert.deepEqual(x[3].warnings, ['no_ref', 'no_expl']); assert.equal(x[3].clean.correct, 3);   // numeric cell 3
  assert.equal(x[14].clean.correct, 3); assert.equal(x[14].clean.difficulty, 'hard');            // Arabic letter ج + Arabic صعب
  assert.equal(x[18].clean.correct, 4); assert.equal(x[18].clean.difficulty, 'easy');            // "(d)", "Easy"
  assert.ok(r.rows.filter(a => !a.ok).every(a => a.clean === null), 'rejected rows carry no payload');
});

test('invalid rows never reach the payload', () => {
  const { r } = load('messy.xlsx');
  const payload = r.rows.filter(a => a.ok).map(L.toPayload);
  assert.equal(payload.length, 4);
  for (const p of payload) {
    assert.equal(p.opts.length, 4); assert.ok(p.correct >= 1 && p.correct <= 4);
    assert.deepEqual(Object.keys(p).sort(), ['category', 'correct', 'difficulty', 'explanation', 'opts', 'question', 'reference', 'row']);
  }
});

test('bank duplicates found at preview time turn valid rows into rejected rows', () => {
  const { r } = load('messy.xlsx');
  // rows 2,3,14,18 were sent as items 1..4; the server says #2 (row 3) already exists as a retired question
  L.applyBankDuplicates(r.rows, [{ i: 2, status: 'retired' }]);
  const x = byRow(r);
  assert.equal(x[3].ok, false); assert.deepEqual(x[3].reasons, ['dup_bank:retired']); assert.equal(x[3].clean, null);
  assert.deepEqual(r.rows.filter(a => a.ok).map(a => a.row), [2, 14, 18]);
  assert.deepEqual(L.summarize(r.rows), { total: 16, valid: 3, rejected: 13, withWarnings: 2 });   // rows 14 (no explanation) and 18 (no reference, no explanation)
  assert.match(L.reasonText('dup_bank:retired'), /موجود بالفعل.*مستبعد/);
  assert.match(L.reasonText('dup_file:2'), /الصف 2/);
});

test('Arabic headers in any order + unknown column ignored', () => {
  const { r } = load('arabic-headers.xlsx');
  assert.deepEqual(r.fileErrors, []); assert.deepEqual(r.ignored, ['Notes']);
  assert.equal(r.rows.length, 1); assert.ok(r.rows[0].ok);
  assert.equal(r.rows[0].clean.correct, 1); assert.equal(r.rows[0].clean.difficulty, 'easy'); assert.equal(r.rows[0].clean.reference, 'تكوين 1:1');
});

test('title row above the headers is tolerated; row numbers still match Excel', () => {
  const { r } = load('title-row.xlsx');
  assert.deepEqual(r.fileErrors, []); assert.equal(r.headerRow, 3); assert.equal(r.rows[0].row, 4); assert.ok(r.rows[0].ok);
});

test('file-level errors: nothing importable', () => {
  let e = load('missing-columns.xlsx').r.fileErrors;
  assert.deepEqual(e, [{ code: 'missing_columns', fields: ['correct', 'category', 'difficulty'] }]);
  assert.match(L.fileErrorText(e[0]), /Correct Answer.*Category.*Difficulty/);
  assert.deepEqual(load('header-only.xlsx').r.fileErrors, [{ code: 'no_data_rows' }]);
  assert.deepEqual(load('empty.xlsx').r.fileErrors, [{ code: 'empty_file' }]);
  assert.deepEqual(load('duplicate-columns.xlsx').r.fileErrors, [{ code: 'duplicate_columns', fields: ['category'] }]);
  assert.deepEqual(load('too-many.xlsx').r.fileErrors, [{ code: 'too_many_rows', count: 501 }]);
  assert.equal(load('too-many.xlsx').r.rows.length, 0);
});

test('exactly 500 rows is accepted', () => { const { r } = load('exactly-500.xlsx'); assert.deepEqual(r.fileErrors, []); assert.equal(r.rows.length, 500); assert.ok(r.rows.every(x => x.ok)); });

test('a fifth choice column: only rows that actually fill it are rejected ("exactly four choices")', () => {
  const { r } = load('five-choices.xlsx'); assert.deepEqual(r.fileErrors, []);
  assert.equal(r.rows[0].ok, true); assert.deepEqual(r.rows[1].reasons, ['extra_choices']);
});

test('not an Excel file is refused before parsing', () => {
  const b = fs.readFileSync(path.join(here, 'fixtures', 'not-excel.xlsx'));
  assert.throws(() => L.readWorkbook(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)), e => e.code === 'not_excel');
  assert.match(L.fileErrorText({ code: 'not_excel' }), /مش ملف Excel/);
});

test('exactly ONE correct answer: parseCorrect table', () => {
  const ok = { A:1, b:2, ' C ':3, d:4, 1:1, '2':2, '3.':3, '(4)':4, 'أ':1, 'ب':2, 'ج':3, 'د':4, 'أ.':1, '٣':3, 'a)':1 };
  for (const [raw, idx] of Object.entries(ok)) assert.equal(L.parseCorrect(raw).index, idx, JSON.stringify(raw));
  const multi = ['A,C', 'A C', 'A and B', 'AB', 'ACD', 'A/B', 'أ و ب', 'a;d', '1,2', 'ب، ج'];
  for (const raw of multi) assert.equal(L.parseCorrect(raw).code, 'correct_multiple', raw);
  for (const raw of ['E', '5', '0', 'none', 'Abraham', 'x', '1.5', 'الأول']) assert.equal(L.parseCorrect(raw).code, 'correct_invalid', raw);
  for (const raw of ['', '   ', null, undefined]) assert.equal(L.parseCorrect(raw).code, 'correct_missing');
});

test('difficulty parsing (English/Arabic, prototype keys are not accepted)', () => {
  for (const [raw, v] of Object.entries({ easy: 'easy', EASY: 'easy', ' Medium ': 'medium', hard: 'hard', 'سهل': 'easy', 'متوسط': 'medium', 'صعب': 'hard' })) assert.equal(L.parseDifficulty(raw).value, v, raw);
  for (const raw of ['', 'constructor', '__proto__', 'toString', 'hardest', '2']) assert.ok(L.parseDifficulty(raw).code, raw);
});

test('duplicate key ignores diacritics, tatweel, alef/ya variants, spacing, punctuation, case', () => {
  const k = L.normText;
  assert.equal(k('مِين  اللي اتبلع في بطن الحوت'), k('مين اللي اتبلع في بطن الحوت؟'));
  assert.equal(k('أحمد'), k('احمد')); assert.equal(k('على'), k('علي')); assert.equal(k('الله'), k('اللـــه'));
  assert.equal(k('Who built the Ark?'), k('who  built the ark')); assert.equal(k('«نص»\u200F'), k('نص'));
  assert.notEqual(k('مين كتب تكوين'), k('مين كتب خروج'));
});

test('every reason code the client or the server can produce has Arabic text', () => {
  const codes = ['q_missing', 'q_short', 'q_long', 'extra_choices', 'opts_not_four', 'opts_duplicate', 'correct_missing', 'correct_invalid', 'correct_multiple', 'ref_long', 'expl_long',
    'cat_missing', 'cat_long', 'diff_missing', 'diff_invalid', 'dup_file:3', 'dup_bank:approved', 'db_rejected', 'opt_missing:B', 'opt_long:D'];
  for (const c of codes) assert.ok(!/سبب غير معروف/.test(L.reasonText(c)), c);
  assert.match(L.reasonText('opt_missing:B'), /الاختيار B/);
});
