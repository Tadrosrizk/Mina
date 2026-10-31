/* Bible Competition — automatic question generation (admin only).
   Flow: settings -> Edge Function friday-bc-generate-questions (the AI key lives ONLY on the server) -> verified questions are saved by the database
   function friday_bc_save_generated() as 'pending_review' -> review screen (edit / regenerate / approve / reject / bulk approve).
   Nothing in this file can approve a question by itself: approval is always an explicit admin tap on friday_bc_review_questions.
   Uses window.bcKit from bible-comp.js and the globals supabaseClient / escapeHtml. */
(function(root){
  'use strict';
  if(typeof document === 'undefined') return;
  var WRAP = 'overflow-wrap:anywhere;word-break:break-word;';
  var CHIP = 'display:inline-block;padding:2px 8px;border-radius:10px;font-size:11.5px;margin:2px 3px 2px 0;background:rgba(127,127,127,.16);' + WRAP;
  var GOOD = 'background:rgba(43,196,168,.22);color:var(--good);', BAD = 'background:rgba(255,80,80,.18);color:var(--bad);', WARNC = 'background:rgba(227,162,59,.22);';
  var DIFF = { easy:'سهل', medium:'متوسط', hard:'صعب' };
  var ST = { pending_review:'⏳ قيد المراجعة', approved:'✅ معتمد', retired:'🗑 مرفوض' };
  var ST_STYLE = { pending_review:WARNC, approved:GOOD, retired:BAD };
  var CATS = ['شخصيات', 'قصص وأحداث', 'أماكن', 'معجزات', 'تعاليم ووصايا', 'أمثال', 'نبوات', 'مزامير وتسبيح', 'أرقام وأسماء', 'عام'];
  var ERR = {
    ai_not_configured:'خدمة التوليد غير مفعّلة (مفتاح الذكاء الاصطناعي مش مضاف على السيرفر)', ai_busy:'الخدمة مشغولة دلوقتي، جرّب بعد دقيقة', ai_quota:'رصيد حساب الذكاء الاصطناعي خلص أو وصل للحد',
    ai_unavailable:'الخدمة مش متاحة دلوقتي، جرّب تاني', ai_timeout:'التوليد أخد وقت أطول من المسموح — قلّل عدد الأسئلة وجرّب تاني', ai_failed:'حصلت مشكلة في التوليد، جرّب تاني',
    verify_failed:'فشل التحقق الآلي من الأسئلة — ما اتحفظ أي سؤال غير متحقَّق منه', verify_timeout:'التحقق الآلي أخد وقت طويل — ما اتحفظ أي سؤال، جرّب تاني',
    no_questions:'الذكاء الاصطناعي ماطلّعش أسئلة صالحة، جرّب موضوع تاني', rate_limited:'وصلت للحد المسموح في الفترة القصيرة — استنى شوية', daily_limit:'وصلت للحد اليومي للتوليد',
    admin_required:'للمسؤول فقط', unauthorized:'سجّل دخول تاني وجرّب', server_misconfigured:'السيرفر محتاج إعداد (شغّل ملفات SQL الخاصة بالمسابقة)', network:'مفيش اتصال بالنت', server:'حصلت مشكلة، جرّب تاني',
    invalid_count:'عدد الأسئلة من 1 إلى 20', invalid_difficulty:'اختار مستوى الصعوبة', invalid_testament:'العهد غير صالح', invalid_book:'السفر غير صالح', invalid_section:'القسم غير صالح',
    scope_conflict:'السفر مش تابع للقسم المختار', scope_testament_mismatch:'السفر/القسم مش من العهد المختار', need_topic_or_scope:'اكتب موضوع أو اختار سفر/قسم', invalid_category:'اكتب التصنيف',
    unsupported_language:'العربية بس مدعومة', unsupported_format:'اختيار من متعدد بس', request_too_large:'الطلب كبير', invalid_json:'طلب غير صالح'
  };
  var REASON = {
    q_short:'السؤال قصير جدًا', q_long:'السؤال طويل', not_arabic:'السؤال مش بالعربية', not_four_choices:'مش 4 اختيارات بالظبط', duplicate_choices:'اختيارات مكررة', overlapping_choices:'اختيارات متداخلة (ممكن أكتر من إجابة)',
    all_none_of_above:'اختيار «كل ما سبق/لا شيء مما سبق»', bad_correct:'الإجابة الصحيحة غير محددة بشكل سليم', no_explanation:'مفيش شرح', expl_long:'الشرح طويل',
    ref_missing:'مفيش مرجع كتابي', ref_format:'شكل المرجع غير صحيح', ref_unknown_book:'السفر في المرجع مش موجود في الكتاب المقدس', ref_chapter_range:'رقم الأصحاح مش موجود في السفر',
    ref_verse_range:'رقم العدد غير منطقي', ref_out_of_scope:'المرجع خارج السفر/القسم المطلوب', ref_testament:'المرجع خارج العهد المطلوب',
    dup_bank:'موجود بالفعل في البنك', dup_batch:'مكرر في نفس التوليد', dup_same_fact:'نفس المعلومة ونفس الآية اتكررت', dup_similar:'شبه سؤال تاني',
    verify_ref_not_found:'المراجِع ما لقاش المرجع ده', verify_unsupported:'الآية لا تجيب على السؤال', verify_ambiguous:'ممكن أكتر من إجابة صحيحة', verify_mismatch:'الآية تدعم إجابة مختلفة عن اللي اتحددت', verify_missing:'ماقدرناش نتأكد من السؤال',
    duplicate_question:'موجود بالفعل في البنك', need_four_options_one_correct:'لازم 4 اختيارات وإجابة واحدة', invalid_or_duplicate_options:'اختيارات غير صالحة', ref_required:'المرجع مطلوب', expl_required:'الشرح مطلوب', cat_required:'التصنيف مطلوب', diff_required:'الصعوبة مطلوبة',
    invalid_question:'السؤال غير صالح', invalid_text:'نص أطول من المسموح'
  };
  function K(){ return root.bcKit; }
  function E(s){ return K().E(s); }
  function opt(v, label, cur){ return '<option value="' + E(v) + '"' + (String(v) === String(cur) ? ' selected' : '') + '>' + E(label) + '</option>'; }
  function chip(t, st){ return '<span style="' + CHIP + (st || '') + '">' + E(t) + '</span>'; }
  function btn(label, onclick, line, extra){ return '<button type="button" class="btn' + (line ? ' btn-line' : '') + '" style="width:100%;margin-top:6px;' + (extra || '') + '" onclick="' + onclick + '">' + label + '</button>'; }
  function why(code){ return REASON[String(code).split(':')[0]] || ('سبب غير معروف: ' + code); }
  function err(r){ return ERR[r && r.error] || K().errTxt(r); }
  function uuid(){
    if(root.crypto && root.crypto.randomUUID) return root.crypto.randomUUID();
    var h = '0123456789abcdef', s = ''; for(var i = 0; i < 36; i++) s += (i === 8 || i === 13 || i === 18 || i === 23) ? '-' : (i === 14 ? '4' : h.charAt(Math.floor(Math.random() * 16)));
    return s;
  }

  var S = { status:null, cfg:{ topic:'', testament:'any', scope:'', category:'شخصيات', difficulty:'medium', count:5 }, batch:null, items:[], sel:{}, busy:false, last:null };

  /* ---- the Edge Function (the AI call happens on the server; this app only sends the settings) ---- */
  async function invokeFn(body){
    var call = (async function(){
      try{
        var r = await root.supabaseClient.functions.invoke('friday-bc-generate-questions', { body:body });
        if(r.error){
          try{ var j = await r.error.context.json(); if(j && j.error) return { ok:false, error:j.error }; }catch(e){}
          return { ok:false, error: /fetch|network|failed to send/i.test(String(r.error.message || '')) ? 'network' : 'server' };
        }
        return r.data || { ok:false, error:'server' };
      }catch(e){ return { ok:false, error:'network' }; }
    })();
    return Promise.race([call, new Promise(function(res){ setTimeout(function(){ res({ ok:false, error:'ai_timeout' }); }, 145000); })]);
  }
  function scopeOptions(){
    var st = S.status, t = S.cfg.testament; if(!st) return '';
    var secs = st.sections.filter(function(s){ return t === 'any' || s.testament === t; }), books = st.books.filter(function(b){ return t === 'any' || b.testament === t; });
    return opt('', 'كل الأسفار' + (t === 'old' ? ' (العهد القديم)' : t === 'new' ? ' (العهد الجديد)' : ''), S.cfg.scope)
      + '<optgroup label="أقسام">' + secs.map(function(s){ return opt('s:' + s.id, s.label, S.cfg.scope); }).join('') + '</optgroup>'
      + '<optgroup label="أسفار">' + books.map(function(b){ return opt('b:' + b.name, b.name, S.cfg.scope); }).join('') + '</optgroup>';
  }
  function readCfg(){
    var g = function(id){ var el = document.getElementById(id); return el ? el.value : ''; };
    S.cfg = { topic:g('bcGTopic').trim(), testament:g('bcGTest') || 'any', scope:g('bcGScope'), category:g('bcGCat').trim(), difficulty:g('bcGDiff') || 'medium', count:parseInt(g('bcGN'), 10) };
  }
  function requestBody(count, avoid){
    var c = S.cfg, b = { action:'generate', topic:c.topic, testament:c.testament, category:c.category, difficulty:c.difficulty, count:count, language:'ar', format:'mcq' };
    if(c.scope.indexOf('s:') === 0) b.section = c.scope.slice(2); else if(c.scope.indexOf('b:') === 0) b.book = c.scope.slice(2);
    if(avoid && avoid.length) b.avoid = avoid;
    return b;
  }

  /* ---- screen 1: availability + settings ---- */
  root.bcGenAIForm = async function(){
    K().modal('<h3>✨ توليد أسئلة بالذكاء الاصطناعي</h3><div id="bcGBody" class="empty">جارِ التحقق من الخدمة...</div>');
    var r = await invokeFn({ action:'status' }), body = document.getElementById('bcGBody'); if(!body) return;
    if(!r || !r.ok) return unavailable(body, r && r.error === 'network' ? 'network' : (r && r.error) || 'server');
    S.status = r;
    if(!r.configured) return unavailable(body, 'ai_not_configured');
    body.className = '';
    var c = S.cfg;
    body.innerHTML = '<div class="cn-sub" style="margin:2px 0 8px;">الأسئلة بتتولّد بالعربية اختيار من متعدد (4 اختيارات)، وكل سؤال بيتراجع آليًا (المرجع + الإجابة) وبيتحفظ <b>«قيد المراجعة»</b>. مفيش سؤال بيتعتمد تلقائيًا.</div>'
      + '<input id="bcGTopic" class="input" maxlength="120" placeholder="الموضوع (مثال: معجزات الرب يسوع، قصة يوسف)" value="' + E(c.topic) + '" style="width:100%;box-sizing:border-box;">'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:6px;">'
      + '<select id="bcGTest" class="input" onchange="bcGenTest()" aria-label="العهد" style="min-width:0;">' + opt('any', 'العهدين', c.testament) + opt('old', 'العهد القديم', c.testament) + opt('new', 'العهد الجديد', c.testament) + '</select>'
      + '<select id="bcGDiff" class="input" aria-label="الصعوبة" style="min-width:0;">' + opt('easy', 'سهل', c.difficulty) + opt('medium', 'متوسط', c.difficulty) + opt('hard', 'صعب', c.difficulty) + '</select>'
      + '<select id="bcGScope" class="input" aria-label="السفر أو القسم" style="grid-column:1/-1;min-width:0;">' + scopeOptions() + '</select>'
      + '<input id="bcGCat" class="input" list="bcGCats" maxlength="60" placeholder="التصنيف" value="' + E(c.category) + '" aria-label="التصنيف" style="min-width:0;"><datalist id="bcGCats">' + CATS.map(function(x){ return '<option value="' + E(x) + '">'; }).join('') + '</datalist>'
      + '<input id="bcGN" class="input" type="number" min="1" max="' + r.limits.max_count + '" value="' + E(c.count) + '" aria-label="عدد الأسئلة" style="min-width:0;"></div>'
      + '<div class="cn-sub" style="margin-top:4px;">الموضوع · العهد · الصعوبة · السفر/القسم · التصنيف · عدد الأسئلة (1 إلى ' + r.limits.max_count + ') · اللغة: العربية · النوع: اختيار من متعدد</div>'
      + '<div class="cn-sub" style="margin-top:8px;color:var(--bad);">💰 كل توليد بيستهلك من رصيد مفتاح الـAPI (مدفوع حسب الاستخدام): طلبين للذكاء الاصطناعي (كتابة ثم تحقق). الحد: ' + r.limits.per_window + ' طلبات كل ' + r.limits.window_minutes + ' دقايق و' + r.limits.per_day + ' في اليوم.</div>'
      + btn('✨ توليد الأسئلة', 'bcGenGo(this)', false, 'margin-top:10px;') + btn('رجوع', 'bcOpen()', true)
      + '<div id="bcGNote" class="cn-sub" style="margin-top:8px;" aria-live="polite"></div>';
  };
  function unavailable(body, code){
    body.className = '';
    var off = code === 'ai_not_configured';
    body.innerHTML = '<div class="cn-row" style="' + WRAP + '"><b>' + (off ? '⛔ التوليد بالذكاء الاصطناعي غير متاح حاليًا' : '⚠️ ' + E(err({ error:code }))) + '</b>'
      + (off ? '<div class="cn-sub" style="margin-top:6px;line-height:1.8;">الميزة مش مفعّلة لحد ما يتضاف مفتاح مزوّد الذكاء الاصطناعي على السيرفر (<span dir="ltr">ANTHROPIC_API_KEY</span>). مفيش أسئلة هتتولّد ولا هتتحفظ قبل كده.'
        + '<br>• الاستخدام <b>مدفوع حسب الاستهلاك</b> (مفيش حد مجاني مضمون).<br>• التفعيل بيتم من خارج التطبيق بأمر واحد على Supabase — الخطوات في <span dir="ltr">BIBLE-GENERATE-AR.md</span>.<br>• تقدر تكمّل شغل الأسئلة يدويًا أو من Excel/PDF في الوقت ده.</div>' : '')
      + '</div>' + btn('🔄 إعادة المحاولة', 'bcGenAIForm()', true) + btn('رجوع', 'bcOpen()', true);
  }
  root.bcGenTest = function(){ readCfg(); var sc = document.getElementById('bcGScope'); S.cfg.scope = ''; if(sc) sc.innerHTML = scopeOptions(); };

  /* ---- screen 2: generate -> save as pending -> review ---- */
  root.bcGenGo = async function(button){
    if(S.busy) return; readCfg();
    function note(m, bad){ var el = document.getElementById('bcGNote'); if(el){ el.textContent = m; el.style.color = bad ? 'var(--bad)' : ''; } }
    var c = S.cfg;
    if(!(c.count >= 1 && c.count <= S.status.limits.max_count)) return note(ERR.invalid_count, true);
    if(!c.topic && !c.scope) return note(ERR.need_topic_or_scope, true);
    if(!c.category) return note(ERR.invalid_category, true);
    if(!confirm('هيتبعت طلب مدفوع لخدمة الذكاء الاصطناعي (طلبين: كتابة ثم تحقق). متابعة؟')) return;
    S.busy = true; button.disabled = true; note('جارِ توليد الأسئلة والتحقق من كل آية... ممكن ياخد لحد دقيقتين، متقفلش الشاشة');
    try{
      var r = await invokeFn(requestBody(c.count));
      if(!r || !r.ok || !Array.isArray(r.questions)) return note(err(r), true);
      var batch = uuid(), saved = { saved:[], rejected:[] };
      if(r.questions.length){
        note('جارِ حفظ الأسئلة بحالة «قيد المراجعة»...');
        saved = await K().rpc('friday_bc_save_generated', { p_batch:batch, p_rows:r.questions.map(toRow) });
        if(!saved || !saved.ok) return note(err(saved) + ' — ماتحفظش أي سؤال', true);
      }
      S.batch = batch; S.sel = {};
      S.last = { requested:r.requested, verified:r.questions.length, truncated:!!r.truncated, savedN:saved.saved.length,
        rejected:(r.rejected || []).map(function(x){ return { question:x.question, reasons:x.reasons || [] }; })
          .concat((saved.rejected || []).map(function(x){ var q = r.questions[x.i - 1]; return { question:q ? q.question.slice(0, 120) : '', reasons:x.reasons || [] }; })) };
      await showReview();
    }catch(e){ console.error('bc gen failed', e); note(ERR.server, true); }
    finally{ S.busy = false; if(button && button.isConnected) button.disabled = false; }
  };
  function toRow(q){ return { question:q.question, opts:q.choices, correct:q.correct, reference:q.reference, explanation:q.explanation, category:q.category, difficulty:q.difficulty, note:q.verifier_note, verified:true }; }

  /* ---- screen 3: review ---- */
  async function loadBatch(){
    var r = await K().rpc('friday_bc_batch_list', { p_batch:S.batch });
    if(!r || !r.ok){ K().msg(err(r), true); return false; }
    S.items = r.items; return true;
  }
  function card(q, i){
    var pend = q.status === 'pending_review';
    var opts = q.opts.map(function(o, k){ return '<div class="cn-sub" style="' + (k + 1 === q.correct ? 'color:var(--good);font-weight:800;' : '') + WRAP + '">' + (k + 1 === q.correct ? '✓ ' : '• ') + 'ABCD'.charAt(k) + '. ' + E(o) + '</div>'; }).join('');
    return '<div class="cn-row" style="' + WRAP + '">'
      + (pend ? '<label style="display:flex;gap:8px;align-items:flex-start;"><input type="checkbox" id="bcGSel' + i + '" ' + (S.sel[q.id] ? 'checked ' : '') + 'onchange="bcGenSel(' + i + ')" aria-label="تحديد السؤال ' + (i + 1) + '" style="width:22px;height:22px;min-height:0;flex:none;margin:2px 0 0;padding:0;"><b>' + (i + 1) + '. ' + E(q.question) + '</b></label>' : '<b>' + (i + 1) + '. ' + E(q.question) + '</b>')
      + opts
      + '<div style="margin-top:4px;">' + chip(ST[q.status] || q.status, ST_STYLE[q.status]) + chip('📖 ' + q.reference) + chip('📂 ' + q.category) + chip(DIFF[q.difficulty] || q.difficulty || '—')
      + (q.ai_verified ? chip('🤖 اتفحص آليًا', GOOD) : chip('✏️ اتعدّل — الفحص الآلي ما بقاش ينطبق', WARNC)) + '</div>'
      + (q.explanation ? '<div class="cn-sub" style="margin-top:4px;">💡 ' + E(q.explanation) + '</div>' : '')
      + (q.note ? '<div class="cn-sub" style="margin-top:2px;">📜 الآية حسب المراجِع الآلي: ' + E(q.note) + '</div>' : '')
      + '<div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;">'
      + (pend ? '<button type="button" class="btn" style="flex:1;min-width:84px;" onclick="bcGenAct(' + i + ',\'approve\')">✅ اعتماد</button><button type="button" class="btn btn-line" style="flex:1;min-width:84px;" onclick="if(confirm(\'رفض السؤال؟\'))bcGenAct(' + i + ',\'reject\')">🗑 رفض</button>'
          + '<button type="button" class="btn btn-line" style="flex:1;min-width:84px;" onclick="bcGenEdit(' + i + ')">✏️ تعديل</button><button type="button" class="btn btn-line" style="flex:1;min-width:84px;" onclick="bcGenRegen(' + i + ',this)">🔄 سؤال بديل</button>'
        : '<span class="cn-sub">' + (q.status === 'approved' ? 'السؤال معتمد — تقدر تسحبه من «بنك الأسئلة»' : 'السؤال مرفوض') + '</span>') + '</div></div>';
  }
  async function showReview(flash){
    if(!S.batch) return root.bcOpen();
    K().modal('<h3>🔎 مراجعة الأسئلة المولّدة</h3><div id="bcGRev" class="empty">جارِ التحميل...</div>');
    var ok = await loadBatch(), el = document.getElementById('bcGRev'); if(!el) return;
    if(!ok){ el.textContent = 'مش قادر أحمّل الأسئلة'; el.insertAdjacentHTML('afterend', btn('رجوع', 'bcOpen()', true)); return; }
    paintReview(flash);
  }
  function paintReview(flash){
    var el = document.getElementById('bcGRev'); if(!el) return; el.className = '';
    var L = S.last, pending = S.items.filter(function(q){ return q.status === 'pending_review'; }), nSel = pending.filter(function(q){ return S.sel[q.id]; }).length;
    var head = '';
    if(L){
      head = '<div style="margin:2px 0 6px;">' + chip('المطلوب: ' + L.requested) + chip('✅ اتحفظ: ' + L.savedN, L.savedN ? GOOD : '') + chip('❌ اترفض: ' + L.rejected.length, L.rejected.length ? BAD : '') + '</div>'
        + (L.truncated ? '<div class="cn-sub" style="color:var(--bad);">الرد اتقطع فممكن يكون فيه أسئلة ناقصة.</div>' : '');
    }
    el.innerHTML = head
      + '<div class="cn-sub" style="margin:4px 0 8px;color:var(--bad);">⚠️ الفحص الآلي مش بديل عن مراجعتك. راجع الإجابة والمرجع والآية بنفسك قبل الاعتماد. كل الأسئلة دي «قيد المراجعة» ومش هتدخل أي مسابقة غير لما تعتمدها.</div>'
      + (S.items.map(card).join('') || '<div class="empty">مفيش أسئلة اتحفظت في التوليد ده</div>')
      + (pending.length ? '<div style="display:flex;gap:6px;margin-top:10px;"><button type="button" class="btn btn-line" style="flex:1;" onclick="bcGenSelAll()">☑️ تحديد الكل</button><button type="button" class="btn btn-line" style="flex:1;" onclick="bcGenSelNone()">إلغاء التحديد</button></div>'
          + btn('✅ اعتماد المحدد (' + nSel + ')', 'bcGenBulk(\'approve\')', false, nSel ? '' : 'opacity:.5;') + btn('🗑 رفض المحدد (' + nSel + ')', 'bcGenBulk(\'reject\')', true, nSel ? '' : 'opacity:.5;') : '')
      + (L && L.rejected.length ? '<h4 style="margin:14px 0 2px;color:var(--bad);">❌ أسئلة اترفضت ومتحفظتش (' + L.rejected.length + ')</h4>' + L.rejected.map(function(x){
          return '<div class="cn-row" style="' + WRAP + '"><b>' + E(x.question || '—') + '</b><ul style="margin:4px 0 0;padding-inline-start:18px;color:var(--bad);font-size:12.5px;line-height:1.6;">' + x.reasons.map(function(c){ return '<li>' + E(why(c)) + '</li>'; }).join('') + '</ul></div>'; }).join('') : '')
      + btn('✨ توليد دفعة جديدة', 'bcGenAIForm()', true, 'margin-top:12px;') + btn('رجوع للمسابقة', 'bcOpen()', true);
    if(flash) K().msg(flash);
  }
  root.bcGenSel = function(i){ var q = S.items[i], c = document.getElementById('bcGSel' + i); if(!q || !c) return; if(c.checked) S.sel[q.id] = true; else delete S.sel[q.id]; var y = document.getElementById('bcModal'); var top = y && y.firstChild ? y.firstChild.scrollTop : 0; paintReview(); if(y && y.firstChild) y.firstChild.scrollTop = top; };
  root.bcGenSelAll = function(){ S.items.forEach(function(q){ if(q.status === 'pending_review') S.sel[q.id] = true; }); paintReview(); };
  root.bcGenSelNone = function(){ S.sel = {}; paintReview(); };
  async function review(ids, action){
    var r = await K().rpc('friday_bc_review_questions', { p_ids:ids, p_action:action });
    if(!r || !r.ok){ K().msg(err(r), true); return false; }
    ids.forEach(function(id){ delete S.sel[id]; });
    await showReview(action === 'approve' ? 'اتعتمد ' + r.changed + ' سؤال ✓' : 'اترفض ' + r.changed + ' سؤال');
    return true;
  }
  root.bcGenAct = function(i, action){ var q = S.items[i]; if(q) review([q.id], action); };
  root.bcGenBulk = function(action){
    var ids = S.items.filter(function(q){ return q.status === 'pending_review' && S.sel[q.id]; }).map(function(q){ return q.id; });
    if(!ids.length){ K().msg('حدّد سؤال واحد على الأقل', true); return; }
    if(!confirm((action === 'approve' ? 'اعتماد ' : 'رفض ') + ids.length + ' سؤال؟' + (action === 'approve' ? ' هتبقى متاحة للمسابقات. اتأكد إنك راجعتها.' : ''))) return;
    review(ids, action);
  };

  /* ---- edit one generated question (it stays «قيد المراجعة»; the AI check no longer applies to the edited text) ---- */
  root.bcGenEdit = function(i){
    var q = S.items[i]; if(!q) return;
    K().modal('<h3>✏️ تعديل سؤال</h3><textarea id="bcGEQ" class="input" rows="3" maxlength="400" style="width:100%;box-sizing:border-box;">' + E(q.question) + '</textarea>'
      + [0,1,2,3].map(function(k){ return '<label style="display:flex;gap:10px;align-items:center;margin:6px 0;"><input type="radio" name="bcGEC" value="' + (k + 1) + '"' + (k + 1 === q.correct ? ' checked' : '') + ' aria-label="الاختيار ' + (k + 1) + ' هو الصحيح" style="width:24px;height:24px;min-height:0;flex:none;margin:0;padding:0;"><input id="bcGEO' + k + '" class="input" maxlength="200" value="' + E(q.opts[k]) + '" style="flex:1;min-width:0;"></label>'; }).join('')
      + '<div class="cn-sub">حدّد دائرة الإجابة الصحيحة</div>'
      + '<input id="bcGER" class="input" maxlength="120" placeholder="المرجع (سفر أصحاح:عدد)" value="' + E(q.reference) + '" style="width:100%;box-sizing:border-box;margin-top:6px;">'
      + '<textarea id="bcGEX" class="input" rows="2" maxlength="500" placeholder="الشرح" style="width:100%;box-sizing:border-box;margin-top:6px;">' + E(q.explanation) + '</textarea>'
      + '<div class="cn-sub" style="margin-top:6px;">⚠️ بعد التعديل الفحص الآلي ما بقاش ينطبق على النص الجديد — راجعه بنفسك.</div>'
      + btn('حفظ التعديل', 'bcGenSave(' + i + ')') + btn('رجوع بدون حفظ', 'bcGenBack()', true));
  };
  root.bcGenBack = function(){ showReview(); };
  root.bcGenSave = async function(i){
    var q = S.items[i]; if(!q || S.busy) return;
    var v = function(id){ return (document.getElementById(id).value || '').trim(); };
    var opts = [0,1,2,3].map(function(k){ return v('bcGEO' + k); }), ch = document.querySelector('input[name=bcGEC]:checked');
    if(!v('bcGEQ') || opts.some(function(o){ return !o; }) || !ch || !v('bcGER') || !v('bcGEX')){ K().msg('املأ السؤال والاختيارات والمرجع والشرح وحدّد الإجابة الصحيحة', true); return; }
    S.busy = true;
    var r = await K().rpc('friday_bc_update_question', { p_id:q.id, p_question:v('bcGEQ'), p_opts:opts, p_correct:+ch.value, p_ref:v('bcGER'), p_expl:v('bcGEX'), p_cat:q.category, p_diff:q.difficulty || null });
    S.busy = false;
    if(r && r.ok) showReview('اتحفظ ✓ — السؤال لسه قيد المراجعة'); else K().msg(err(r), true);
  };

  /* ---- regenerate ONE question: ask for a replacement first; the old question is rejected only after the new one was saved ---- */
  root.bcGenRegen = async function(i, button){
    var q = S.items[i]; if(!q || S.busy || q.status !== 'pending_review') return;
    if(!confirm('هيتبعت طلب مدفوع لخدمة الذكاء الاصطناعي لتوليد سؤال بديل. السؤال الحالي هيترفض بعد ما البديل يتحفظ. متابعة؟')) return;
    S.busy = true; button.disabled = true; K().msg('جارِ توليد سؤال بديل والتحقق منه...');
    try{
      var avoid = S.items.map(function(x){ return x.question; });
      var r = await invokeFn(requestBody(1, avoid));
      if(!r || !r.ok || !Array.isArray(r.questions)) return K().msg(err(r), true);
      if(!r.questions.length) return K().msg('البديل ماعدّاش الفحص: ' + ((r.rejected && r.rejected[0] && r.rejected[0].reasons || []).map(why).join('، ') || 'جرّب تاني') + ' — السؤال القديم زي ما هو', true);
      var sv = await K().rpc('friday_bc_save_generated', { p_batch:S.batch, p_rows:r.questions.map(toRow) });
      if(!sv || !sv.ok) return K().msg(err(sv), true);
      if(!sv.saved.length) return K().msg('البديل اترفض: ' + ((sv.rejected[0] && sv.rejected[0].reasons || []).map(why).join('، ')) + ' — السؤال القديم زي ما هو', true);
      S.busy = false; delete S.sel[q.id];
      await review([q.id], 'reject');
    }catch(e){ console.error('bc regen failed', e); K().msg(ERR.server, true); }
    finally{ S.busy = false; if(button && button.isConnected) button.disabled = false; }
  };

  root._bcGenState = S;     // read by the browser tests only
})(typeof window !== 'undefined' ? window : globalThis);
