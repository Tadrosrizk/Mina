/* Bible Competition — question bank screen (admin only): search, filter, edit, approve / reject.
   Uses window.bcKit from bible-comp.js. Every rule is enforced by the server (supabase-bible-comp-4-bank.sql); this file only renders and sends. */
(function(root){
  'use strict';
  var PAGE = 20;
  var ST = { pending_review:'⏳ قيد المراجعة', approved:'✅ معتمد', retired:'🗑 مرفوض' };
  var ST_STYLE = { pending_review:'background:rgba(227,162,59,.22);', approved:'background:rgba(43,196,168,.22);color:var(--good);', retired:'background:rgba(255,80,80,.18);color:var(--bad);' };
  var DIFF = { easy:'سهل', medium:'متوسط', hard:'صعب' };
  var S = { search:'', status:'all', category:'', difficulty:'', offset:0, items:[], total:0, counts:{}, cats:[], busy:false };
  function K(){ return root.bcKit; }
  function E(s){ return K().E(s); }
  var CHIP = 'display:inline-block;padding:2px 9px;border-radius:99px;font-size:12px;margin:2px 3px 2px 0;background:rgba(120,140,190,.16);';
  function chip(t, st){ return '<span style="' + CHIP + (st || '') + '">' + E(t) + '</span>'; }
  var MSG = { duplicate_question:'السؤال ده موجود بالفعل في البنك', in_use:'السؤال ده داخل في مسابقة، مينفعش يتعدّل', not_found:'السؤال مش موجود',
    invalid_question:'السؤال لازم يكون من 3 إلى 400 حرف', invalid_text:'المرجع (120) أو الشرح (500) أو التصنيف (60) أطول من المسموح', invalid_filter:'فلتر غير صالح',
    has_unapproved_questions:'المسابقة فيها سؤال مش معتمد — ولّد مسابقة جديدة' };
  function err(r){ return MSG[r && r.error] || K().errTxt(r); }
  function opt(v, label, cur){ return '<option value="' + E(v) + '"' + (String(v) === String(cur) ? ' selected' : '') + '>' + E(label) + '</option>'; }

  function card(q, i){
    var opts = q.opts.map(function(o, k){ return '<div class="cn-sub" style="' + (k + 1 === q.correct ? 'color:var(--good);font-weight:800;' : '') + 'overflow-wrap:anywhere;">' + (k + 1 === q.correct ? '✓ ' : '• ') + E(o) + '</div>'; }).join('');
    var acts = '';
    if(q.status !== 'approved') acts += '<button type="button" class="btn" style="flex:1;min-width:90px;" onclick="bcBankAct(' + i + ',\'approve\')">✅ اعتماد</button>';
    if(q.status !== 'retired') acts += '<button type="button" class="btn btn-line" style="flex:1;min-width:90px;" onclick="if(confirm(\'' + (q.status === 'approved' ? 'سحب السؤال من المعتمد؟ مش هيتسحب في مسابقات جديدة.' : 'رفض السؤال؟') + '\'))bcBankAct(' + i + ',\'reject\')">🗑 رفض</button>';
    acts += q.in_use ? '<span class="cn-sub" style="flex:1 1 100%;">🔒 داخل في مسابقة — التعديل مقفول</span>'
                     : '<button type="button" class="btn btn-line" style="flex:1;min-width:90px;" onclick="bcBankEdit(' + i + ')">✏️ تعديل</button>';
    return '<div class="cn-row" style="overflow-wrap:anywhere;"><b>' + E(q.question) + '</b>' + opts
      + '<div style="margin-top:4px;">' + chip(ST[q.status] || q.status, ST_STYLE[q.status]) + (q.category ? chip('📂 ' + q.category) : '') + (q.difficulty ? chip(DIFF[q.difficulty] || q.difficulty) : '') + (q.reference ? chip('📖 ' + q.reference) : '') + '</div>'
      + (q.explanation ? '<div class="cn-sub" style="margin-top:4px;">💡 ' + E(q.explanation) + '</div>' : '')
      + '<div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;">' + acts + '</div></div>';
  }

  async function load(append){
    if(S.busy) return; S.busy = true;
    var r = await K().rpc('friday_bc_bank_list', { p_search:S.search, p_status:S.status, p_category:S.category, p_difficulty:S.difficulty, p_limit:PAGE, p_offset:S.offset });
    S.busy = false;
    var list = document.getElementById('bcBankList'); if(!list) return;
    if(!r || !r.ok){ K().msg(err(r), true); return; }
    S.total = r.total; S.counts = r.counts || {}; S.cats = r.categories || [];
    S.items = append ? S.items.concat(r.items) : r.items;
    paint();
  }
  function paint(){
    var list = document.getElementById('bcBankList'); if(!list) return;
    var c = S.counts, tot = (c.approved || 0) + (c.pending_review || 0) + (c.retired || 0);
    var sum = document.getElementById('bcBankSum'); if(sum) sum.innerHTML = chip('الكل ' + tot) + chip('✅ ' + (c.approved || 0), ST_STYLE.approved) + chip('⏳ ' + (c.pending_review || 0), ST_STYLE.pending_review) + chip('🗑 ' + (c.retired || 0), ST_STYLE.retired);
    var cs = document.getElementById('bcBankCat'); if(cs) cs.innerHTML = opt('', 'كل التصنيفات', S.category) + S.cats.map(function(x){ return opt(x, x, S.category); }).join('');
    list.innerHTML = '<div class="cn-sub" style="margin:6px 0;">النتائج: ' + S.total + '</div>'
      + (S.items.map(card).join('') || '<div class="empty">مفيش أسئلة مطابقة</div>')
      + (S.items.length < S.total ? '<button type="button" class="btn btn-line" style="width:100%;margin-top:8px;" onclick="bcBankMore()">عرض المزيد (' + (S.total - S.items.length) + ')</button>' : '');
  }

  root.bcBank = function(keep){
    if(!keep){ S.search = ''; S.status = 'all'; S.category = ''; S.difficulty = ''; }
    S.offset = 0; S.items = [];
    K().modal('<h3>🗂 بنك الأسئلة</h3>'
      + '<div style="display:flex;gap:6px;"><input id="bcBankQ" class="input" type="search" maxlength="100" placeholder="ابحث في السؤال أو الاختيارات أو المرجع" value="' + E(S.search) + '" style="flex:1;min-width:0;"><button type="button" class="btn" onclick="bcBankFilter()">🔍</button></div>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:6px;">'
      + '<select id="bcBankSt" onchange="bcBankFilter()" style="min-width:0;">' + opt('all', 'كل الحالات', S.status) + opt('pending_review', 'قيد المراجعة', S.status) + opt('approved', 'معتمد', S.status) + opt('retired', 'مرفوض', S.status) + '</select>'
      + '<select id="bcBankDf" onchange="bcBankFilter()" style="min-width:0;">' + opt('', 'كل المستويات', S.difficulty) + opt('easy', 'سهل', S.difficulty) + opt('medium', 'متوسط', S.difficulty) + opt('hard', 'صعب', S.difficulty) + opt('none', 'بدون مستوى', S.difficulty) + '</select>'
      + '<select id="bcBankCat" onchange="bcBankFilter()" style="grid-column:1/-1;min-width:0;">' + opt('', 'كل التصنيفات', S.category) + '</select></div>'
      + '<div id="bcBankSum" style="margin-top:6px;"></div><div id="bcBankList"><div class="empty">جارِ التحميل...</div></div>'
      + '<button type="button" class="btn btn-line" style="width:100%;margin-top:10px;" onclick="bcOpen()">رجوع</button>');
    var q = document.getElementById('bcBankQ');
    if(q) q.addEventListener('keydown', function(e){ if(e.key === 'Enter'){ e.preventDefault(); root.bcBankFilter(); } });
    load(false);
  };
  root.bcBankFilter = function(){
    S.search = (document.getElementById('bcBankQ') || {}).value || ''; S.status = (document.getElementById('bcBankSt') || {}).value || 'all';
    S.difficulty = (document.getElementById('bcBankDf') || {}).value || ''; S.category = (document.getElementById('bcBankCat') || {}).value || '';
    S.offset = 0; load(false);
  };
  root.bcBankMore = function(){ S.offset = S.items.length; load(true); };
  root.bcBankAct = async function(i, action){
    var q = S.items[i]; if(!q) return;
    var r = await K().rpc('friday_bc_review_questions', { p_ids:[q.id], p_action:action });
    if(r && r.ok){ S.offset = 0; S.items = []; await load(false); K().msg(r.changed ? (action === 'approve' ? 'اتعتمد ✓' : 'اترفض') : 'الحالة اتغيّرت قبل كده'); } else K().msg(err(r), true);
  };

  root.bcBankEdit = function(i){
    var q = S.items[i]; if(!q) return;
    K().modal('<h3>✏️ تعديل سؤال</h3><textarea id="bcEQ" class="input" rows="3" maxlength="400" style="width:100%;">' + E(q.question) + '</textarea>'
      + [0,1,2,3].map(function(k){ return '<label style="display:flex;gap:10px;align-items:center;margin:6px 0;"><input type="radio" name="bcEC" value="' + (k + 1) + '"' + (k + 1 === q.correct ? ' checked' : '') + ' aria-label="الاختيار ' + (k + 1) + ' هو الصحيح" style="width:24px;height:24px;min-height:0;flex:none;margin:0;padding:0;"><input id="bcEO' + k + '" class="input" maxlength="200" value="' + E(q.opts[k]) + '" style="flex:1;min-width:0;"></label>'; }).join('')
      + '<div class="cn-sub">حدّد دائرة الإجابة الصحيحة</div>'
      + '<input id="bcER" class="input" maxlength="120" placeholder="المرجع" value="' + E(q.reference) + '" style="width:100%;margin-top:6px;">'
      + '<textarea id="bcEX" class="input" rows="2" maxlength="500" placeholder="الشرح (اختياري)" style="width:100%;margin-top:6px;">' + E(q.explanation) + '</textarea>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:6px;"><input id="bcEC" class="input" maxlength="60" placeholder="التصنيف" value="' + E(q.category) + '" style="min-width:0;">'
      + '<select id="bcED" style="min-width:0;">' + opt('', 'بدون مستوى', q.difficulty || '') + opt('easy', 'سهل', q.difficulty) + opt('medium', 'متوسط', q.difficulty) + opt('hard', 'صعب', q.difficulty) + '</select></div>'
      + '<div class="cn-sub" style="margin-top:6px;">⚠️ بعد الحفظ السؤال بيرجع «قيد المراجعة» وتعتمده من جديد.</div>'
      + '<button type="button" class="btn" style="width:100%;margin-top:10px;" onclick="bcBankSave(' + i + ')">حفظ التعديل</button><button type="button" class="btn btn-line" style="width:100%;margin-top:6px;" onclick="bcBank(true)">رجوع بدون حفظ</button>');
  };
  root.bcBankSave = async function(i){
    var q = S.items[i]; if(!q || S.busy) return;
    var v = function(id){ return (document.getElementById(id).value || '').trim(); };
    var opts = [0,1,2,3].map(function(k){ return v('bcEO' + k); });
    var ch = document.querySelector('input[name=bcEC]:checked');
    if(!v('bcEQ') || opts.some(function(o){ return !o; }) || !ch){ K().msg('املأ السؤال والاختيارات الأربعة وحدّد الإجابة الصحيحة', true); return; }
    S.busy = true;
    var r = await K().rpc('friday_bc_update_question', { p_id:q.id, p_question:v('bcEQ'), p_opts:opts, p_correct:+ch.value, p_ref:v('bcER'), p_expl:v('bcEX'), p_cat:v('bcEC'), p_diff:v('bcED') || null });
    S.busy = false;
    if(r && r.ok){ root.bcBank(true); setTimeout(function(){ K().msg('اتحفظ ✓ — السؤال رجع قيد المراجعة'); }, 400); } else K().msg(err(r), true);
  };
})(typeof window !== 'undefined' ? window : globalThis);
