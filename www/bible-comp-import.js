/* Bible Competition — Excel question import (admin only).
   Part 1: pure validation logic (also loaded by the Node tests).  Part 2: UI.
   Uses globals from index.html: XLSX, ensureXlsx, XLSX_MISSING_MSG, saveWorkbook — and window.bcKit from bible-comp.js.
   The preview is a convenience only: the server (supabase-bible-comp-2-import.sql) re-validates every row and is the final authority. */
(function(root){
  'use strict';
  var MAX_ROWS = 500, MAX_BYTES = 5 * 1024 * 1024, FIRST_SHOWN = 25;
  var FIELDS = ['question', 'a', 'b', 'c', 'd', 'correct', 'explanation', 'reference', 'category', 'difficulty'];
  var REQUIRED = ['question', 'a', 'b', 'c', 'd', 'correct', 'category', 'difficulty'];     // explanation + reference are optional (a warning if empty)
  var FIELD_NAME = { question:'Question', a:'Choice A', b:'Choice B', c:'Choice C', d:'Choice D', correct:'Correct Answer', explanation:'Explanation', reference:'Bible Reference', category:'Category', difficulty:'Difficulty' };
  var STATUS_AR = { approved:'معتمد', retired:'مستبعد', pending_review:'قيد المراجعة' };
  var DIFF_AR = { easy:'سهل', medium:'متوسط', hard:'صعب' };

  /* ---------------- text helpers ---------------- */
  function len(s){ return Array.from(s).length; }
  function cell(v){ return String(v == null ? '' : v).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/\u00A0/g, ' ').trim(); }
  // duplicate key — keep in step with public.friday_bc_norm() in the SQL file
  function normText(s){
    return String(s == null ? '' : s)
      .replace(/[\u064B-\u0652\u0670\u0640]/g, '')
      .replace(/[\u0623\u0625\u0622]/g, '\u0627').replace(/\u0649/g, '\u064A')
      .replace(/[\u061F\u060C\u061B\u00AB\u00BB\u201C\u201D\u2018\u2019\u2026\u200B\u200E\u200F\uFEFF]/g, '')
      .replace(/[\s\p{P}\p{S}\p{Z}]+/gu, '')
      .toLowerCase();
  }

  /* ---------------- headers (English or Arabic) ---------------- */
  var ALIASES = {
    question:['question', 'question text', 'السؤال', 'نص السؤال'],
    a:['choice a', 'option a', 'answer a', 'choice 1', 'option 1', 'answer 1', 'a', 'الاختيار أ', 'الاختيار 1', 'الاختيار الأول', 'اختيار أ', 'اختيار 1', 'الإجابة أ', 'الاجابه أ', 'أ'],
    b:['choice b', 'option b', 'answer b', 'choice 2', 'option 2', 'answer 2', 'b', 'الاختيار ب', 'الاختيار 2', 'الاختيار الثاني', 'اختيار ب', 'اختيار 2', 'الإجابة ب', 'الاجابه ب', 'ب'],
    c:['choice c', 'option c', 'answer c', 'choice 3', 'option 3', 'answer 3', 'c', 'الاختيار ج', 'الاختيار 3', 'الاختيار الثالث', 'اختيار ج', 'اختيار 3', 'الإجابة ج', 'الاجابه ج', 'ج'],
    d:['choice d', 'option d', 'answer d', 'choice 4', 'option 4', 'answer 4', 'd', 'الاختيار د', 'الاختيار 4', 'الاختيار الرابع', 'اختيار د', 'اختيار 4', 'الإجابة د', 'الاجابه د', 'د'],
    correct:['correct answer', 'correct', 'right answer', 'answer', 'الإجابة الصحيحة', 'الاجابه الصحيحه', 'الإجابة', 'الاجابه', 'الصحيح'],
    explanation:['explanation', 'الشرح', 'التفسير', 'توضيح'],
    reference:['bible reference', 'reference', 'ref', 'المرجع', 'المرجع الكتابي', 'الآية', 'الاية'],
    category:['category', 'التصنيف', 'الفئة', 'القسم'],
    difficulty:['difficulty', 'level', 'الصعوبة', 'المستوى', 'مستوى الصعوبة']
  };
  var ALIAS_MAP = Object.create(null);
  Object.keys(ALIASES).forEach(function(f){ ALIASES[f].forEach(function(a){ ALIAS_MAP[normText(a)] = f; }); });
  var EXTRA_RE = /^((choice|option|answer)(e|f|g|h|5|6|7|8|9)|(الاختيار|اختيار|الاجابه|الاجابة)(الخامس|السادس|5|6|7|8|9))$/;   // a 5th/6th choice column

  function mapHeaders(row){
    var map = {}, dup = [], ignored = [], extra = [];
    (row || []).forEach(function(h, idx){
      var raw = cell(h); if(!raw) return;
      var n = normText(raw), f = ALIAS_MAP[n];
      if(f){ if(map[f] != null) dup.push(f); else map[f] = idx; }
      else if(EXTRA_RE.test(n)) extra.push(idx);
      else ignored.push(raw);
    });
    return { map:map, dup:dup, ignored:ignored, extra:extra, score:Object.keys(map).length };
  }

  /* ---------------- field parsers ---------------- */
  var LETTER = { 'A':1, 'B':2, 'C':3, 'D':4, '1':1, '2':2, '3':3, '4':4, '\u0627':1, '\u0628':2, '\u062C':3, '\u062F':4 };   // A-D, 1-4, أ ب ج د
  function parseCorrect(raw){
    var s = cell(raw); if(!s) return { code:'correct_missing' };
    var t = s.toUpperCase().replace(/[\u064B-\u0652\u0640]/g, '').replace(/[\u0623\u0625\u0622]/g, '\u0627')
      .replace(/[\u0660-\u0669]/g, function(d){ return String(d.charCodeAt(0) - 0x660); })
      .replace(/^[\s(\[]+|[\s)\].:]+$/g, '');
    if(Object.prototype.hasOwnProperty.call(LETTER, t)) return { index:LETTER[t] };
    if(/^[A-D]{2,4}$/.test(t)) return { code:'correct_multiple' };                                       // "AB", "ACD"
    var valid = t.split(/[\s,;\u060C\u061B\/&+|\-]+/).filter(function(x){ return Object.prototype.hasOwnProperty.call(LETTER, x.replace(/^[(\[]+|[)\].:]+$/g, '')); });
    if(valid.length > 1) return { code:'correct_multiple' };                                            // "A,C", "أ و ب"
    return { code:'correct_invalid' };
  }
  var DIFF_MAP = { 'easy':'easy', 'سهل':'easy', 'medium':'medium', 'متوسط':'medium', 'hard':'hard', 'صعب':'hard' };
  function parseDifficulty(raw){
    var s = cell(raw); if(!s) return { code:'diff_missing' };
    var k = normText(s);
    return Object.prototype.hasOwnProperty.call(DIFF_MAP, k) ? { value:DIFF_MAP[k] } : { code:'diff_invalid' };
  }

  /* ---------------- one row ---------------- */
  function validateRow(r, H){
    function g(f){ return H.map[f] == null ? '' : cell(r[H.map[f]]); }
    var reasons = [], warnings = [];
    var q = g('question');
    if(!q) reasons.push('q_missing'); else if(len(q) < 3) reasons.push('q_short'); else if(len(q) > 400) reasons.push('q_long');
    var opts = ['a', 'b', 'c', 'd'].map(g);
    opts.forEach(function(o, i){ var L = 'ABCD'.charAt(i); if(!o) reasons.push('opt_missing:' + L); else if(len(o) > 200) reasons.push('opt_long:' + L); });
    if(H.extra.some(function(c){ return cell(r[c]) !== ''; })) reasons.push('extra_choices');         // more than four choices
    if(opts.every(Boolean)){
      var low = opts.map(function(o){ return o.toLowerCase(); });
      if(low.some(function(o, i){ return low.indexOf(o) !== i; })) reasons.push('opts_duplicate');
    }
    var cr = parseCorrect(g('correct')); if(cr.code) reasons.push(cr.code);
    var ref = g('reference'), ex = g('explanation'), cat = g('category'), df = parseDifficulty(g('difficulty'));
    if(len(ref) > 120) reasons.push('ref_long');
    if(len(ex) > 500) reasons.push('expl_long');
    if(!cat) reasons.push('cat_missing'); else if(len(cat) > 60) reasons.push('cat_long');
    if(df.code) reasons.push(df.code);
    if(!ref) warnings.push('no_ref');
    if(!ex) warnings.push('no_expl');
    return { q:q, reasons:reasons, warnings:warnings,
      clean: reasons.length ? null : { question:q, opts:opts, correct:cr.index, reference:ref, explanation:ex, category:cat, difficulty:df.value } };
  }

  /* ---------------- whole sheet ----------------
     matrix = rows of cells (SheetJS header:1); startRow = zero-based sheet row of matrix[0], so reported row numbers match Excel. */
  function analyze(matrix, startRow){
    startRow = startRow || 0;
    var out = { fileErrors:[], rows:[], ignored:[], headerRow:0, header:null };
    var nonEmpty = [];
    (matrix || []).forEach(function(r, i){ if(r && r.some(function(c){ return cell(c) !== ''; })) nonEmpty.push(i); });
    if(!nonEmpty.length){ out.fileErrors.push({ code:'empty_file' }); return out; }
    var hi = nonEmpty[0], best = -1;                                                                  // header = best-matching row among the first 10 (allows a title row above it)
    nonEmpty.slice(0, 10).forEach(function(i){ var sc = mapHeaders(matrix[i]).score; if(sc > best){ best = sc; hi = i; } });
    var H = mapHeaders(matrix[hi]);
    out.header = matrix[hi]; out.headerRow = startRow + hi + 1; out.ignored = H.ignored;
    var missing = REQUIRED.filter(function(f){ return H.map[f] == null; });
    if(missing.length) out.fileErrors.push({ code:'missing_columns', fields:missing });
    var dups = H.dup.filter(function(f, i, a){ return a.indexOf(f) === i; });
    if(dups.length) out.fileErrors.push({ code:'duplicate_columns', fields:dups });
    var cols = Object.keys(H.map).map(function(f){ return H.map[f]; }).concat(H.extra);
    var data = nonEmpty.filter(function(i){ return i > hi && cols.some(function(c){ return cell(matrix[i][c]) !== ''; }); });
    if(!out.fileErrors.length && !data.length) out.fileErrors.push({ code:'no_data_rows' });
    if(data.length > MAX_ROWS) out.fileErrors.push({ code:'too_many_rows', count:data.length });
    if(out.fileErrors.length) return out;

    var seen = Object.create(null);                                                                   // normalized question -> first VALID row that used it
    data.forEach(function(i){
      var v = validateRow(matrix[i], H), rowNo = startRow + i + 1;
      if(v.clean){
        var key = normText(v.q);
        if(key && seen[key]){ v.reasons.push('dup_file:' + seen[key]); v.clean = null; }
        else if(key) seen[key] = rowNo;
      }
      out.rows.push({ row:rowNo, cells:matrix[i], q:v.q, reasons:v.reasons, warnings:v.warnings, clean:v.clean, ok:!v.reasons.length });
    });
    return out;
  }

  // items = [{i: 1-based position among the valid rows that were sent, status}] from friday_bc_find_duplicates
  function applyBankDuplicates(rows, items){
    var valid = rows.filter(function(r){ return r.ok; });
    (items || []).forEach(function(it){
      var r = valid[it.i - 1]; if(!r) return;
      r.ok = false; r.clean = null; r.reasons.push('dup_bank:' + (it.status || ''));
    });
    return rows;
  }
  function summarize(rows){
    var ok = rows.filter(function(r){ return r.ok; });
    return { total:rows.length, valid:ok.length, rejected:rows.length - ok.length, withWarnings:ok.filter(function(r){ return r.warnings.length; }).length };
  }
  function toPayload(r){ var c = r.clean; return { row:r.row, question:c.question, opts:c.opts, correct:c.correct, reference:c.reference, explanation:c.explanation, category:c.category, difficulty:c.difficulty }; }

  /* ---------------- messages (Arabic) ---------------- */
  var REASON = {
    q_missing:'نص السؤال فاضي', q_short:'السؤال قصير جدًا (أقل من 3 حروف)', q_long:'السؤال أطول من 400 حرف',
    extra_choices:'فيه أكتر من 4 اختيارات (لازم 4 بالظبط)', opts_not_four:'لازم 4 اختيارات بالظبط', opts_duplicate:'فيه اختيارات مكررة (لازم 4 اختيارات مختلفة)',
    correct_missing:'الإجابة الصحيحة مش محددة', correct_invalid:'الإجابة الصحيحة لازم تكون A أو B أو C أو D (أو 1 إلى 4)', correct_multiple:'متحدد أكتر من إجابة صحيحة (لازم إجابة واحدة بالظبط)',
    ref_long:'المرجع أطول من 120 حرف', expl_long:'الشرح أطول من 500 حرف', cat_missing:'التصنيف فاضي', cat_long:'التصنيف أطول من 60 حرف',
    diff_missing:'مستوى الصعوبة فاضي', diff_invalid:'مستوى الصعوبة لازم يكون easy أو medium أو hard (سهل / متوسط / صعب)',
    dup_file:'مكرر داخل الملف', dup_bank:'السؤال موجود بالفعل في بنك الأسئلة', db_rejected:'قاعدة البيانات رفضت البيانات (غير صالحة)'
  };
  var WARN = { no_ref:'مفيش مرجع كتابي', no_expl:'مفيش شرح' };
  function reasonText(code){
    var p = String(code).split(':'), k = p[0], a = p.slice(1).join(':');
    if(k === 'opt_missing') return 'الاختيار ' + a + ' فاضي (لازم 4 اختيارات)';
    if(k === 'opt_long') return 'الاختيار ' + a + ' أطول من 200 حرف';
    if(k === 'dup_file') return 'مكرر: نفس السؤال موجود في الصف ' + a;
    if(k === 'dup_bank') return REASON.dup_bank + (STATUS_AR[a] ? ' (' + STATUS_AR[a] + ')' : '');
    return REASON[k] || ('سبب غير معروف: ' + code);
  }
  function fileErrorText(e){
    if(e.code === 'empty_file') return 'الملف فاضي';
    if(e.code === 'no_data_rows') return 'مفيش أسئلة تحت صف العناوين';
    if(e.code === 'too_many_rows') return 'الملف فيه ' + e.count + ' سؤال — أقصى حد ' + MAX_ROWS + ' في المرة. قسّمه على أكتر من ملف';
    if(e.code === 'missing_columns') return 'أعمدة مطلوبة ناقصة: ' + e.fields.map(function(f){ return FIELD_NAME[f]; }).join(' ، ');
    if(e.code === 'duplicate_columns') return 'عمود مكرر في صف العناوين: ' + e.fields.map(function(f){ return FIELD_NAME[f]; }).join(' ، ');
    if(e.code === 'not_excel') return 'الملف ده مش ملف Excel (.xlsx)';
    if(e.code === 'password') return 'الملف محمي بكلمة سر — شيلها وجرّب تاني';
    return 'مقدرناش نقرا الملف — اتأكد إنه ملف Excel سليم';
  }

  /* ---------------- reading the file ---------------- */
  function readWorkbook(buf){
    var u8 = new Uint8Array(buf);
    var isZip = u8[0] === 0x50 && u8[1] === 0x4B, isOle = u8[0] === 0xD0 && u8[1] === 0xCF;
    if(!isZip && !isOle) throw { code:'not_excel' };
    var wb;
    try{ wb = root.XLSX.read(buf, { type:'array' }); }
    catch(e){ throw { code: /password|encrypt/i.test(String(e && e.message)) ? 'password' : 'unreadable' }; }
    var name = wb.SheetNames.filter(function(n){ return /^(questions|الأسئلة|الاسئلة|اسئلة|أسئلة)$/i.test(n.trim()); })[0] || wb.SheetNames[0];
    var ws = wb.Sheets[name];
    if(!ws || !ws['!ref']) return { sheet:name, matrix:[], start:0 };
    var matrix = root.XLSX.utils.sheet_to_json(ws, { header:1, raw:false, defval:'', blankrows:true });
    return { sheet:name, matrix:matrix, start:root.XLSX.utils.decode_range(ws['!ref']).s.r };
  }

  var api = { normText:normText, cell:cell, mapHeaders:mapHeaders, parseCorrect:parseCorrect, parseDifficulty:parseDifficulty, validateRow:validateRow, analyze:analyze,
    applyBankDuplicates:applyBankDuplicates, summarize:summarize, toPayload:toPayload, reasonText:reasonText, fileErrorText:fileErrorText, readWorkbook:readWorkbook,
    MAX_ROWS:MAX_ROWS, MAX_BYTES:MAX_BYTES, REQUIRED:REQUIRED, FIELDS:FIELDS };
  root.bcImportLogic = api;
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  if(typeof document === 'undefined') return;     // Node tests stop here

  /* ====================== UI ====================== */
  var S = { fileName:'', sheet:'', res:null, busy:false, rejected:[] };
  function K(){ return root.bcKit; }
  function E(s){ return K().E(s); }
  var WRAP = 'overflow-wrap:anywhere;word-break:break-word;';                                  // one long unbroken cell must never widen the phone screen
  function clip(s, n){ s = String(s || ''); return len(s) > n ? Array.from(s).slice(0, n).join('') + '…' : s; }
  var CHIP = 'display:inline-block;padding:2px 8px;border-radius:10px;font-size:11.5px;margin:2px 3px 2px 0;background:rgba(127,127,127,.16);';
  function chip(txt, st){ return '<span style="' + CHIP + WRAP + (st || '') + '">' + E(txt) + '</span>'; }
  var GOOD = 'background:rgba(43,196,168,.22);color:var(--good);', BAD = 'background:rgba(255,80,80,.18);color:var(--bad);', WARNC = 'background:rgba(227,162,59,.22);';
  function btn(label, onclick, line, extra){ return '<button type="button" class="btn' + (line ? ' btn-line' : '') + '" style="width:100%;margin-top:6px;' + (extra || '') + '" onclick="' + onclick + '">' + label + '</button>'; }

  function questionCard(q, correct, meta, tail){
    return '<div class="cn-row" style="' + WRAP + '">' + (meta || '') + '<b>' + E(q) + '</b>'
      + tail.opts.map(function(o, i){ return '<div class="cn-sub" style="' + (i + 1 === correct ? 'color:var(--good);font-weight:800;' : '') + '">' + (i + 1 === correct ? '✓ ' : '• ') + 'ABCD'.charAt(i) + '. ' + E(o) + '</div>'; }).join('')
      + '<div style="margin-top:4px;">' + (tail.category ? chip('📂 ' + tail.category) : '') + (tail.difficulty ? chip(DIFF_AR[tail.difficulty] || tail.difficulty) : '') + (tail.reference ? chip('📖 ' + tail.reference) : '') + '</div>'
      + (tail.explanation ? '<div class="cn-sub" style="margin-top:3px;">💡 ' + E(tail.explanation) + '</div>' : '')
      + (tail.extra || '') + '</div>';
  }
  function validCard(r){
    var c = r.clean;
    return questionCard(c.question, c.correct, '<span class="cn-sub">الصف ' + r.row + ' · </span>', { opts:c.opts, category:c.category, difficulty:c.difficulty, reference:c.reference, explanation:c.explanation,
      extra: r.warnings.length ? '<div style="margin-top:3px;">' + r.warnings.map(function(w){ return chip('⚠️ ' + WARN[w], WARNC); }).join('') + '</div>' : '' });
  }
  function rejectedCard(x){
    return '<div class="cn-row" style="' + WRAP + '"><span class="cn-sub">الصف ' + x.row + '</span> <b>' + E(clip(x.question, 120) || '—') + '</b>'
      + '<ul style="margin:4px 0 0;padding-inline-start:18px;color:var(--bad);font-size:12.5px;line-height:1.6;">' + x.reasons.map(function(c){ return '<li>' + E(reasonText(c)) + '</li>'; }).join('') + '</ul></div>';
  }

  /* ---- step 1: choose a file ---- */
  root.bcImportForm = function(){
    K().modal('<h3>📥 استيراد أسئلة</h3>'
      + '<div class="cn-sub" style="margin:4px 0;">الأعمدة المطلوبة: <b dir="ltr">Question · Choice A · B · C · D · Correct Answer · Category · Difficulty</b><br>واختياريًا: <b dir="ltr">Explanation · Bible Reference</b></div>'
      + '<div class="cn-sub" style="margin:4px 0;">الإجابة الصحيحة: حرف واحد A / B / C / D (أو 1 إلى 4). الصعوبة: easy / medium / hard. أقصى حد ' + MAX_ROWS + ' سؤال في الملف.</div>'
      + '<div class="cn-sub" style="margin:4px 0 8px;">الأسئلة بتتحفظ بحالة <b>«قيد المراجعة»</b> ومش بتظهر في أي مسابقة غير بعد ما تعتمدها. الأسئلة الموجودة مش بتتعدّل ولا بتتمسح، والمكرر بيترفض.</div>'
      + btn('📂 اختر ملف Excel', "document.getElementById('bcImpFile').click()")
      + btn('📄 توليد أسئلة من ملف PDF', 'bcPdfForm()', true)
      + '<input id="bcImpFile" type="file" accept=".xlsx,.xls" style="display:none" onchange="bcImportPick(event)">'
      + btn('⬇️ تحميل نموذج Excel', 'bcImportTemplate()', true)
      + btn('رجوع', 'bcOpen()', true)
      + '<div id="bcImpNote" class="cn-sub" style="margin-top:8px;" aria-live="polite"></div>');
  };
  root.bcImportTemplate = async function(){
    if(typeof ensureXlsx !== 'function' || !(await ensureXlsx())){ K().msg(typeof XLSX_MISSING_MSG === 'function' ? XLSX_MISSING_MSG() : 'مكتبة الإكسيل مش متاحة', true); return; }
    var X = root.XLSX, hdr = ['Question', 'Choice A', 'Choice B', 'Choice C', 'Choice D', 'Correct Answer', 'Explanation', 'Bible Reference', 'Category', 'Difficulty'];
    var wsQ = X.utils.aoa_to_sheet([hdr]);
    var wsE = X.utils.aoa_to_sheet([hdr,
      ['مين اللي اتبلع في بطن الحوت؟', 'يونان', 'إيليا', 'إرميا', 'إشعياء', 'A', 'أرسله الله إلى نينوى فهرب في سفينة', 'يونان 1:17', 'العهد القديم', 'easy'],
      ['في أي مدينة وُلد الرب يسوع؟', 'الناصرة', 'بيت لحم', 'أورشليم', 'كفرناحوم', 'B', '', 'متى 2:1', 'العهد الجديد', 'medium']]);
    var wsI = X.utils.aoa_to_sheet([['Instructions / تعليمات'],
      ['1. Fill the "Questions" sheet only. Delete nothing from the header row. / املا ورقة Questions فقط ومتغيّرش صف العناوين.'],
      ['2. Exactly 4 different choices (A-D) and ONE correct answer: A, B, C or D (or 1-4). / 4 اختيارات مختلفة وإجابة صحيحة واحدة.'],
      ['3. Required: Question, Choice A-D, Correct Answer, Category, Difficulty. Optional: Explanation, Bible Reference. / الشرح والمرجع اختياريين.'],
      ['4. Difficulty: easy, medium or hard (or سهل / متوسط / صعب). / مستوى الصعوبة.'],
      ['5. Max ' + MAX_ROWS + ' questions per file. Duplicates of existing questions are rejected, never overwritten. / أقصى حد ' + MAX_ROWS + ' سؤال في الملف.'],
      ['6. Imported questions are saved as "Pending review" until an admin approves them. / الأسئلة بتتحفظ «قيد المراجعة».']]);
    wsQ['!cols'] = wsE['!cols'] = [{ wch:48 }, { wch:20 }, { wch:20 }, { wch:20 }, { wch:20 }, { wch:15 }, { wch:36 }, { wch:16 }, { wch:16 }, { wch:11 }];
    wsI['!cols'] = [{ wch:120 }];
    var wb = X.utils.book_new(); X.utils.book_append_sheet(wb, wsQ, 'Questions'); X.utils.book_append_sheet(wb, wsE, 'Example'); X.utils.book_append_sheet(wb, wsI, 'Instructions');
    try{ await saveWorkbook(wb, 'bible-questions-template.xlsx', 'bible-questions-template.xlsx'); }catch(e){ K().msg('تعذر حفظ النموذج', true); }
  };

  /* ---- step 2: read + validate + preview ---- */
  root.bcImportPick = async function(ev){
    var input = ev.target, file = input.files && input.files[0]; input.value = '';
    if(!file) return;
    function note(m, bad){ var el = document.getElementById('bcImpNote'); if(el){ el.textContent = m; el.style.color = bad ? 'var(--bad)' : ''; } }
    if(typeof ensureXlsx !== 'function' || !(await ensureXlsx())) return note(typeof XLSX_MISSING_MSG === 'function' ? XLSX_MISSING_MSG() : 'مكتبة الإكسيل مش متاحة', true);
    if(file.size > MAX_BYTES) return note('الملف كبير جدًا (أقصى حد 5 ميجا)', true);
    if(!file.size) return note('الملف فاضي', true);
    note('جارِ قراءة الملف والتحقق منه...');
    var res, sheet;
    try{
      var wbk = readWorkbook(await file.arrayBuffer());
      sheet = wbk.sheet; res = analyze(wbk.matrix, wbk.start);
    }catch(e){ console.error('bc import read failed', e); return note(fileErrorText({ code:(e && e.code) || 'unreadable' }), true); }
    S = { fileName:file.name, sheet:sheet, source:'excel', res:res, busy:false, rejected:[] };
    proceed(note);
  };
  // shared by the Excel and PDF flows: file-level errors -> duplicate check against the bank -> preview
  async function proceed(note){
    var res = S.res;
    if(res.fileErrors.length) return showFileErrors();
    var valid = res.rows.filter(function(r){ return r.ok; });
    if(valid.length){                                                          // duplicates against the existing bank (any status)
      note('جارِ التأكد من عدم تكرار الأسئلة...');
      var d = await K().rpc('friday_bc_find_duplicates', { p_questions:valid.map(function(r){ return r.clean.question; }) });
      if(!d || !d.ok) return note(K().errTxt(d) + ' — ماقدرناش نتأكد من التكرار فمفيش حاجة اتحفظت', true);
      applyBankDuplicates(res.rows, d.items);
    }
    showPreview();
  }

  function showFileErrors(){
    var r = S.res;
    K().modal('<h3>❌ الملف مش صالح للاستيراد</h3><div class="cn-sub">' + E(S.fileName) + '</div>'
      + '<ul style="margin:8px 0;padding-inline-start:18px;color:var(--bad);line-height:1.8;">' + r.fileErrors.map(function(e){ return '<li>' + E(fileErrorText(e)) + '</li>'; }).join('') + '</ul>'
      + '<div class="cn-sub">مفيش حاجة اتحفظت. صحّح الملف واختاره تاني، أو نزّل النموذج الجاهز.</div>'
      + (S.source === 'pdf' ? btn('📄 جرّب ملف تاني', 'bcPdfForm()') : btn('📂 اختر ملف تاني', 'bcImportForm()')) + btn('رجوع', 'bcOpen()', true));
  }

  function showPreview(){
    var rows = S.res.rows, sm = summarize(rows), ok = rows.filter(function(r){ return r.ok; }), bad = rows.filter(function(r){ return !r.ok; });
    S.rejected = bad.map(function(r){ return { row:r.row, question:r.q, reasons:r.reasons, cells:r.cells }; });
    K().modal('<h3>👁 معاينة الاستيراد</h3><div class="cn-sub">' + E(S.fileName) + ' · ' + (S.source === 'pdf' ? 'أسئلة مولّدة بالذكاء الاصطناعي (طلبت ' + S.requested + ')' : 'الورقة: ' + E(S.sheet)) + ' · ' + sm.total + ' ' + (S.source === 'pdf' ? 'سؤال' : 'صف') + '</div>'
      + (S.source === 'pdf' ? '<div class="cn-sub" style="margin-top:6px;color:var(--bad);">⚠️ الأسئلة دي اتولّدت تلقائيًا — راجع الإجابة الصحيحة والمرجع بنفسك قبل الاعتماد.' + (S.truncated ? ' الرد اتقطع فممكن يكون فيه أسئلة ناقصة.' : '') + '</div>' : '')
      + '<div style="margin:8px 0;">' + chip('✅ جاهز: ' + sm.valid, GOOD) + chip('❌ مرفوض: ' + sm.rejected, sm.rejected ? BAD : '') + (sm.withWarnings ? chip('⚠️ تنبيهات: ' + sm.withWarnings, WARNC) : '') + '</div>'
      + (S.res.ignored.length ? '<div class="cn-sub">أعمدة اتتجاهلت: ' + E(S.res.ignored.join(' ، ')) + '</div>' : '')
      + (bad.length ? '<h4 style="margin:12px 0 2px;color:var(--bad);">❌ مرفوضة (' + bad.length + ') — مش هتتحفظ</h4>' + S.rejected.map(rejectedCard).join('') : '')
      + (ok.length ? '<h4 style="margin:12px 0 2px;">✅ هتتستورد (' + ok.length + ') بحالة «قيد المراجعة»</h4><div id="bcImpList">' + ok.slice(0, FIRST_SHOWN).map(validCard).join('') + '</div>'
          + (ok.length > FIRST_SHOWN ? '<button type="button" id="bcImpMore" class="btn btn-line" style="width:100%;margin-top:6px;" onclick="bcImportMore()">عرض باقي الأسئلة (' + (ok.length - FIRST_SHOWN) + ')</button>' : '')
        : '<div class="empty" style="margin:12px 0;">مفيش أسئلة صالحة للاستيراد</div>')
      + (ok.length ? btn('✅ استيراد ' + ok.length + ' سؤال', 'bcImportCommit(this)', false, 'margin-top:12px;') : '')
      + (bad.length ? btn('📄 تحميل الصفوف المرفوضة (Excel)', 'bcImportRejectedXlsx()', true) : '')
      + (S.source === 'pdf' ? btn('📄 ولّد من ملف تاني', 'bcPdfForm()', true) : btn('📂 اختر ملف تاني', 'bcImportForm()', true)) + btn('إلغاء', 'bcOpen()', true));
  }
  root.bcImportMore = function(){
    var list = document.getElementById('bcImpList'), more = document.getElementById('bcImpMore'); if(!list) return;
    list.insertAdjacentHTML('beforeend', S.res.rows.filter(function(r){ return r.ok; }).slice(FIRST_SHOWN).map(validCard).join(''));
    if(more) more.remove();
  };

  /* ---- step 3: import + summary ---- */
  root.bcImportCommit = async function(button){
    if(S.busy || !S.res) return;
    var rows = S.res.rows.filter(function(r){ return r.ok; }); if(!rows.length) return;
    S.busy = true; var label = button.textContent; button.disabled = true; button.textContent = 'جارِ الاستيراد...';
    var r = await K().rpc('friday_bc_import_questions', { p_rows:rows.map(toPayload) });
    S.busy = false;
    if(!r || !r.ok){
      button.disabled = false; button.textContent = label;
      K().msg(K().errTxt(r) + (r && r.error === 'network' ? ' — لو الاتصال اتقطع أثناء الحفظ، شوف «الأسئلة قيد المراجعة» قبل ما تعيد (المكرر بيترفض تلقائيًا)' : ''), true);
      return;
    }
    showResult(r, rows.length);
  };
  function showResult(r, sent){
    var byRow = {}; S.res.rows.forEach(function(x){ byRow[x.row] = x; });
    var rejected = S.res.rows.filter(function(x){ return !x.ok; }).map(function(x){ return { row:x.row, question:x.q, reasons:x.reasons, cells:x.cells }; })
      .concat((r.rejected || []).map(function(x){ return { row:x.row, question:(byRow[x.row] && byRow[x.row].q) || x.question, reasons:x.reasons || [], cells:byRow[x.row] ? byRow[x.row].cells : [] }; }))
      .sort(function(a, b){ return a.row - b.row; });
    S.rejected = rejected;
    var unaccounted = sent - r.imported - (r.rejected || []).length;
    K().modal('<h3>📊 ملخص الاستيراد</h3><div class="cn-sub">' + E(S.fileName) + '</div>'
      + '<div style="margin:8px 0;">' + chip('إجمالي الصفوف: ' + S.res.rows.length) + chip('✅ اتستورد: ' + r.imported, GOOD) + chip('❌ مرفوض: ' + rejected.length, rejected.length ? BAD : '') + '</div>'
      + (r.imported ? '<div class="cn-sub" style="color:var(--good);">الأسئلة المستوردة اتحفظت بحالة «قيد المراجعة» ومش هتظهر في المسابقات قبل اعتمادها.</div>' : '<div class="cn-sub">ماتحفظش أي سؤال.</div>')
      + (unaccounted > 0 ? '<div class="cn-sub" style="color:var(--bad);">⚠️ ' + unaccounted + ' صف مفيش رد عنهم من السيرفر — راجع «الأسئلة قيد المراجعة» قبل ما تعيد الاستيراد.</div>' : '')
      + (rejected.length ? '<h4 style="margin:12px 0 2px;color:var(--bad);">❌ الصفوف المرفوضة وأسبابها</h4>' + rejected.map(rejectedCard).join('') : '')
      + (r.imported ? btn('📋 مراجعة الأسئلة المستوردة', 'bcPending()', false, 'margin-top:12px;') : '')
      + (rejected.length ? btn('📄 تحميل الصفوف المرفوضة (Excel)', 'bcImportRejectedXlsx()', true) : '')
      + btn('📥 استيراد ملف تاني', 'bcImportForm()', true) + btn('رجوع', 'bcOpen()', true));
  }
  root.bcImportRejectedXlsx = async function(){
    if(!S.rejected.length) return;
    if(typeof ensureXlsx !== 'function' || !(await ensureXlsx())) return K().msg('مكتبة الإكسيل مش متاحة', true);
    var hdr = (S.res && S.res.header ? S.res.header.map(cell) : []).concat(['Rejection reason / سبب الرفض']);
    var aoa = [hdr].concat(S.rejected.map(function(x){ return x.cells.map(cell).concat([x.reasons.map(reasonText).join(' | ')]); }));
    var wb = root.XLSX.utils.book_new(); root.XLSX.utils.book_append_sheet(wb, root.XLSX.utils.aoa_to_sheet(aoa), 'Questions');
    try{ await saveWorkbook(wb, 'bible-questions-rejected.xlsx', 'bible-questions-rejected.xlsx'); }catch(e){ K().msg('تعذر حفظ الملف', true); }
  };


  /* ---- PDF -> questions written by the AI (Edge Function friday-bc-pdf-questions) -> the SAME validation / preview / import as Excel ---- */
  var PDF_MAX = 6 * 1024 * 1024, PDF_FILE = null, PDF_BUSY = false;
  var PDF_COLS = ['Question', 'Choice A', 'Choice B', 'Choice C', 'Choice D', 'Correct Answer', 'Explanation', 'Bible Reference', 'Category', 'Difficulty'];
  var PDF_ERR = { not_pdf:'الملف ده مش PDF سليم', missing_pdf:'اختار ملف PDF الأول', pdf_too_large:'الملف كبير (أقصى حد 6 ميجا)', pdf_unreadable:'مقدرناش نقرا الـPDF ده (ممكن يكون محمي أو تالف أو أكتر من 100 صفحة)',
    invalid_count:'عدد الأسئلة من 3 إلى 30', invalid_difficulty:'مستوى الصعوبة غير صالح', no_questions:'الذكاء الاصطناعي ماطلّعش أسئلة من الملف ده — جرّب ملف فيه محتوى أكتر',
    ai_not_configured:'خدمة التوليد لسه مش مفعّلة (محتاجة مفتاح الذكاء الاصطناعي على السيرفر)', ai_busy:'الخدمة مشغولة دلوقتي، جرّب بعد دقيقة', ai_unavailable:'الخدمة مش متاحة دلوقتي، جرّب تاني',
    ai_timeout:'التوليد أخد وقت أطول من المسموح — جرّب ملف أصغر أو عدد أسئلة أقل', ai_failed:'حصلت مشكلة في التوليد، جرّب تاني', rate_limited:'وصلت للحد المسموح (10 مرات كل 10 دقايق) — استنى شوية',
    admin_required:'للمسؤول فقط', unauthorized:'سجّل دخول تاني وجرّب', server_misconfigured:'السيرفر محتاج إعداد (شغّل ملف SQL الخاص بتوليد PDF)', network:'مفيش اتصال بالنت', server:'حصلت مشكلة، جرّب تاني' };
  function toBase64(file){
    return new Promise(function(res, rej){ var fr = new FileReader(); fr.onload = function(){ res(String(fr.result).split(',')[1] || ''); }; fr.onerror = function(){ rej(fr.error); }; fr.readAsDataURL(file); });
  }
  async function invokeFn(name, body){
    var call = (async function(){
      try{
        var r = await supabaseClient.functions.invoke(name, { body:body });
        if(r.error){
          try{ var j = await r.error.context.json(); if(j && j.error) return { ok:false, error:j.error }; }catch(e){}
          return { ok:false, error: /fetch|network|failed to send/i.test(String(r.error.message || '')) ? 'network' : 'server' };
        }
        return r.data || { ok:false, error:'server' };
      }catch(e){ return { ok:false, error:'network' }; }
    })();
    return Promise.race([call, new Promise(function(res){ setTimeout(function(){ res({ ok:false, error:'ai_timeout' }); }, 130000); })]);
  }
  // AI rows -> the same table shape as an Excel sheet, so analyze() applies exactly the same rules (4 choices, one correct, required fields...)
  function aiMatrix(qs){
    var wide = qs.some(function(q){ return q.choices.length > 4; });
    var rows = qs.map(function(q){
      var c = q.choices, ok = Number.isInteger(q.correct) && q.correct >= 1 && q.correct <= 4;
      var row = [q.question, c[0] || '', c[1] || '', c[2] || '', c[3] || '', ok ? 'ABCD'.charAt(q.correct - 1) : String(q.correct || ''), q.explanation, q.reference, q.category, q.difficulty];
      if(wide) row.push(c[4] || '');
      return row;
    });
    return [wide ? PDF_COLS.concat(['Choice E']) : PDF_COLS].concat(rows);
  }
  root.bcPdfForm = function(){
    K().modal('<h3>📄 توليد أسئلة من ملف PDF</h3>'
      + '<div class="cn-sub" style="margin:4px 0;">ارفع ملف PDF (درس، شرح، ملزمة...) والذكاء الاصطناعي بيألّف منه أسئلة اختيار من متعدد <b>من محتوى الملف بس</b>. أقصى حجم 6 ميجا.</div>'
      + '<div class="cn-sub" style="margin:4px 0 8px;">الأسئلة بتعدّي على نفس الفحص والمعاينة وكشف التكرار، وبتتحفظ «قيد المراجعة». محتوى الملف بيتبعت لخدمة الذكاء الاصطناعي.</div>'
      + btn('📂 اختر ملف PDF', "document.getElementById('bcPdfFile').click()")
      + '<input id="bcPdfFile" type="file" accept=".pdf,application/pdf" style="display:none" onchange="bcPdfPick(event)">'
      + '<div id="bcPdfName" class="cn-sub" style="margin:6px 0;' + WRAP + '">' + (PDF_FILE ? '📄 ' + E(PDF_FILE.name) : 'لسه ماتختارش ملف') + '</div>'
      + '<div style="display:flex;gap:8px;"><input id="bcPdfN" class="input" type="number" min="3" max="30" value="10" style="flex:1" aria-label="عدد الأسئلة">'
      + '<select id="bcPdfD" class="input" style="flex:1" aria-label="الصعوبة"><option value="mixed">صعوبة متنوعة</option><option value="easy">سهل</option><option value="medium">متوسط</option><option value="hard">صعب</option></select></div>'
      + '<div class="cn-sub">عدد الأسئلة (3 إلى 30) · مستوى الصعوبة</div>'
      + '<input id="bcPdfCat" class="input" maxlength="60" placeholder="التصنيف (اختياري) — لو فاضي بيتحدد من الملف" style="width:100%;box-sizing:border-box;margin-top:8px;">'
      + btn('✨ توليد الأسئلة', 'bcPdfGo(this)', false, 'margin-top:10px;') + btn('رجوع', 'bcImportForm()', true)
      + '<div id="bcImpNote" class="cn-sub" style="margin-top:8px;" aria-live="polite"></div>');
  };
  root.bcPdfPick = function(ev){
    var input = ev.target, f = input.files && input.files[0]; input.value = ''; if(!f) return;
    PDF_FILE = f; var el = document.getElementById('bcPdfName'); if(el) el.textContent = '📄 ' + f.name + ' (' + (f.size / 1048576).toFixed(1) + ' ميجا)';
  };
  root.bcPdfGo = async function(button){
    if(PDF_BUSY) return;
    function note(m, bad){ var el = document.getElementById('bcImpNote'); if(el){ el.textContent = m; el.style.color = bad ? 'var(--bad)' : ''; } }
    if(!PDF_FILE) return note(PDF_ERR.missing_pdf, true);
    if(PDF_FILE.size > PDF_MAX) return note(PDF_ERR.pdf_too_large, true);
    var n = parseInt(document.getElementById('bcPdfN').value, 10);
    if(!(n >= 3 && n <= 30)) return note(PDF_ERR.invalid_count, true);
    var file = PDF_FILE, diff = document.getElementById('bcPdfD').value, cat = document.getElementById('bcPdfCat').value.trim();
    PDF_BUSY = true; button.disabled = true; note('جارِ قراءة الملف وتوليد الأسئلة... ممكن ياخد لحد دقيقتين، متقفلش الشاشة');
    try{
      var head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
      if(String.fromCharCode.apply(null, head) !== '%PDF-') return note(PDF_ERR.not_pdf, true);
      var r = await invokeFn('friday-bc-pdf-questions', { pdf_base64:await toBase64(file), count:n, difficulty:diff, category:cat });
      if(!r || !r.ok || !Array.isArray(r.questions)) return note(PDF_ERR[r && r.error] || PDF_ERR.server, true);
      S = { fileName:file.name, sheet:'', source:'pdf', requested:n, truncated:!!r.truncated, res:analyze(aiMatrix(r.questions), -1), busy:false, rejected:[] };
      await proceed(note);
    }catch(e){ console.error('bc pdf failed', e); note(PDF_ERR.server, true); }
    finally{ PDF_BUSY = false; if(button && button.isConnected) button.disabled = false; }
  };

  /* ---- pending-review screen: approve / reject imported questions ---- */
  root.bcPending = async function(flash){
    K().modal('<h3>📋 الأسئلة قيد المراجعة</h3><div id="bcPendBody" class="empty">جارِ التحميل...</div>');
    var r = await K().rpc('friday_bc_pending_list', { p_limit:30 }), body = document.getElementById('bcPendBody'); if(!body) return;
    if(!r || !r.ok){ body.textContent = K().errTxt(r); return; }
    body.className = '';
    var ids = r.items.map(function(q){ return q.id; });
    body.innerHTML = '<div class="cn-sub">' + (r.total ? 'إجمالي المعلّق: ' + r.total + (r.total > r.items.length ? ' (معروض أول ' + r.items.length + ')' : '') : '') + '</div>'
      + (r.items.map(function(q, i){
          return questionCard(q.question, q.correct, '<span class="cn-sub">' + (i + 1) + ' · </span>', { opts:q.opts, category:q.category, difficulty:q.difficulty, reference:q.reference, explanation:q.explanation,
            extra:'<div style="display:flex;gap:6px;margin-top:6px;"><button type="button" class="btn" style="flex:1;" onclick="bcQReview([\'' + E(q.id) + '\'],\'approve\')">✅ اعتماد</button>'
              + '<button type="button" class="btn btn-line" style="flex:1;" onclick="if(confirm(\'رفض السؤال؟ هيتحوّل لحالة مستبعد.\'))bcQReview([\'' + E(q.id) + '\'],\'reject\')">🗑 رفض</button></div>' });
        }).join('') || '<div class="empty">مفيش أسئلة قيد المراجعة</div>')
      + (r.items.length > 1 ? btn('✅ اعتماد كل المعروض (' + r.items.length + ')', "if(confirm('اعتماد " + r.items.length + " سؤال؟ هتبقى متاحة للمسابقات.'))bcQReview(" + JSON.stringify(ids).replace(/"/g, "'") + ",'approve')", false, 'margin-top:10px;') : '')
      + btn('رجوع', 'bcOpen()', true);
    if(flash) K().msg(flash);
  };
  root.bcQReview = async function(ids, action){
    var r = await K().rpc('friday_bc_review_questions', { p_ids:ids, p_action:action });
    if(r && r.ok) root.bcPending(action === 'approve' ? 'اتعتمد ' + r.changed + ' سؤال ✓' : 'اترفض ' + r.changed + ' سؤال'); else K().msg(K().errTxt(r), true);
  };
})(typeof window !== 'undefined' ? window : globalThis);
