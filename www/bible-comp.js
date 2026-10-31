/* Bible Competition System (UI). Reuses: supabaseClient, escapeHtml, isAdminUser, hapticTick, .modal-bg (Android back closes it).
   All logic/scoring/timing is on the server (supabase-bible-comp-1.sql); this file only renders. */
(function(){
  var ID = 'bcModal', timer = null, rpcBusy = false;
  var ERR = { admin_required:'للمسؤول فقط', code_not_found:'الكود غير صحيح أو المسابقة غير متاحة', not_enough_questions:'عدد الأسئلة المعتمدة غير كافٍ',
    need_four_options_one_correct:'لازم 4 اختيارات وإجابة صحيحة واحدة', invalid_or_duplicate_options:'الاختيارات لازم تكون 4 مختلفة', already_answered:'جاوبت بالفعل',
    not_open:'السؤال اتقفل', not_joined:'لازم تنضم الأول', not_allowed_now:'مش متاح في الحالة دي', invalid_count:'العدد من 3 إلى 50',
    invalid_payload:'بيانات الاستيراد غير صالحة', invalid_row_count:'عدد الأسئلة غير مسموح (من 1 إلى 500)', too_many_rows:'أقصى حد 500 سؤال في المرة', invalid_action:'إجراء غير صالح',
    duplicate_question:'السؤال ده موجود بالفعل في البنك', invalid_question:'السؤال لازم يكون من 3 إلى 400 حرف', invalid_text:'نص أطول من المسموح', in_use:'السؤال داخل في مسابقة، مينفعش يتعدّل', not_found:'مش موجود', invalid_filter:'فلتر غير صالح',
    has_unapproved_questions:'المسابقة فيها سؤال مش معتمد — ولّد مسابقة جديدة' };
  var E = function(s){ return escapeHtml(String(s == null ? '' : s)); };
  function msg(m, bad){ var el = document.getElementById('bcMsg'); if(el){ el.textContent = m || ''; el.style.color = bad ? 'var(--bad)' : 'var(--good)'; } }
  async function rpc(name, args){
    try{ var r = await supabaseClient.rpc(name, args || {}); if(r.error) throw r.error; return r.data; }
    catch(e){ return { ok:false, error:(e && /network|fetch/i.test(e.message||'')) ? 'network' : 'server' }; }
  }
  function errTxt(r){ return ERR[r && r.error] || (r && r.error === 'network' ? 'مفيش اتصال بالنت' : 'حصلت مشكلة، جرّب تاني'); }
  function stop(){ if(timer){ clearInterval(timer); timer = null; } }
  function modal(inner){
    stop(); var old = document.getElementById(ID); if(old) old.remove();
    var bg = document.createElement('div'); bg.className = 'modal-bg'; bg.id = ID;
    bg.innerHTML = '<div class="modal" style="max-width:460px;text-align:start;max-height:92vh;overflow-y:auto;">' + inner + '<div id="bcMsg" class="cn-msg" aria-live="polite"></div></div>';
    new MutationObserver(function(_, ob){ if(!document.getElementById(ID)){ stop(); ob.disconnect(); } }).observe(document.body, { childList:true });
    document.body.appendChild(bg); return bg;
  }
  window.bcKit = { modal: modal, rpc: rpc, msg: msg, E: E, errTxt: errTxt };      // shared with bible-comp-import.js
  window.bcQuickBtn = function(){ return '<button type="button" class="qa cn-qa" style="grid-column:1/-1;" onclick="bcOpen()"><span style="font-size:26px;line-height:1;">📖</span><span>المسابقة الكتابية</span></button>'; };

  window.bcOpen = async function(){
    var adm = isAdminUser();
    modal('<h3>📖 المسابقة الكتابية</h3><div id="bcBody" class="empty">جارِ التحميل...</div>');
    var list = await rpc('friday_bc_list'), body = document.getElementById('bcBody'); if(!body) return;
    if(!Array.isArray(list)){ body.textContent = 'مش قادر أحمّل المسابقات'; return; }
    var st = { pending_review:'⏳ مراجعة', published:'🟢 مفتوحة', live:'🔴 مباشرة', finished:'🏁 انتهت' };
    body.className = '';
    body.innerHTML = '<div style="display:flex;gap:6px;margin:8px 0;"><input id="bcCode" class="input" maxlength="6" placeholder="كود المسابقة" style="flex:1;text-transform:uppercase;" dir="ltr"><button class="btn" onclick="bcJoinCode()">انضم</button></div>'
      + (adm ? '<div style="display:flex;gap:6px;margin:8px 0;"><button class="btn btn-line" style="flex:1;" onclick="bcAddForm()">➕ سؤال</button><button class="btn btn-line" style="flex:1;" onclick="bcGenForm()">⚙️ توليد مسابقة</button></div>'
        + '<div style="display:flex;gap:6px;margin:8px 0;"><button class="btn btn-line" style="flex:1;" onclick="bcImportForm()">📥 استيراد أسئلة</button><button class="btn btn-line" style="flex:1;" onclick="bcPending()">📋 قيد المراجعة</button></div>'
        + '<div style="display:flex;gap:6px;margin:8px 0;"><button class="btn btn-line" style="flex:1;" onclick="bcBank()">🗂 بنك الأسئلة (بحث / تعديل)</button><button class="btn btn-line" style="flex:1;" onclick="bcGenAIForm()">✨ توليد بالذكاء الاصطناعي</button></div>' : '')
      + (list.map(function(c){
          var a = '';
          if(c.status === 'published' || c.status === 'live') a += '<button class="btn" onclick="bcJoinId(\'' + c.id + '\')">' + (c.joined ? 'ادخل' : 'انضم') + '</button> ';
          if(c.status === 'finished' && c.joined) a += '<button class="btn btn-line" onclick="bcPlay(\'' + c.id + '\')">النتيجة</button> ';
          if(adm){
            if(c.status === 'pending_review') a += '<button class="btn btn-line" onclick="bcReview(\'' + c.id + '\')">مراجعة</button> ';
            if(c.status === 'published') a += '<button class="btn btn-line" onclick="bcAct(\'' + c.id + '\',\'start\')">ابدأ الآن</button> ';
            if(c.status !== 'finished') a += '<button class="btn btn-line" onclick="if(confirm(\'إلغاء المسابقة؟\'))bcAct(\'' + c.id + '\',\'cancel\')">إلغاء</button>';
          }
          return '<div class="cn-row"><b>' + E(c.title) + '</b> <span class="cn-sub">' + (st[c.status] || '') + ' · ' + c.questions + ' سؤال · ' + c.players + ' لاعب' + (c.code ? ' · الكود <b dir="ltr">' + E(c.code) + '</b>' : '') + '</span><div style="margin-top:6px;">' + a + '</div></div>';
        }).join('') || '<div class="empty">لا توجد مسابقات الآن</div>')
      + '<button class="btn btn-line" style="width:100%;margin-top:10px;" onclick="document.getElementById(\'' + ID + '\').remove()">إغلاق</button>';
  };
  window.bcJoinCode = async function(){ var v = (document.getElementById('bcCode').value || '').trim(); if(!v) return; var r = await rpc('friday_bc_join', { p_code:v }); r && r.ok ? bcPlay(r.id) : msg(errTxt(r), true); };
  window.bcJoinId = async function(id){ var r = await rpc('friday_bc_join_id', { p_id:id }); r && r.ok ? bcPlay(r.id) : msg(errTxt(r), true); };
  window.bcAct = async function(id, a){ var r = await rpc('friday_bc_set_status', { p_id:id, p_action:a }); if(r && r.ok) bcOpen(); else msg(errTxt(r), true); };

  window.bcAddForm = function(){
    modal('<h3>➕ سؤال جديد (4 اختيارات)</h3><textarea id="bcQ" class="input" rows="2" maxlength="400" placeholder="السؤال" style="width:100%"></textarea>'
      + [1,2,3,4].map(function(i){ return '<label style="display:flex;gap:10px;align-items:center;margin:6px 0;"><input type="radio" name="bcC" value="' + i + '"' + (i === 1 ? ' checked' : '') + ' aria-label="الاختيار ' + i + ' هو الصحيح" style="width:24px;height:24px;min-height:0;flex:none;margin:0;padding:0;"><input id="bcO' + i + '" class="input" maxlength="200" placeholder="الاختيار ' + i + '" style="flex:1;min-width:0;"></label>'; }).join('')
      + '<div class="cn-sub">حدّد دائرة الإجابة الصحيحة</div><input id="bcRef" class="input" maxlength="120" placeholder="المرجع (اختياري) مثال: يوحنا 3:16" style="width:100%;margin-top:6px;">'
      + '<button class="btn" style="width:100%;margin-top:10px;" onclick="bcSaveQ()">حفظ</button><button class="btn btn-line" style="width:100%;margin-top:6px;" onclick="bcOpen()">رجوع</button>');
  };
  window.bcSaveQ = async function(){
    var opts = [1,2,3,4].map(function(i){ return document.getElementById('bcO' + i).value.trim(); });
    var ch = document.querySelector('input[name=bcC]:checked');
    if(!document.getElementById('bcQ').value.trim() || opts.some(function(o){ return !o; })){ msg('املأ السؤال والاختيارات الأربعة', true); return; }
    var r = await rpc('friday_bc_add_question', { p_question:document.getElementById('bcQ').value, p_opts:opts, p_correct:+ch.value, p_ref:document.getElementById('bcRef').value });
    if(r && r.ok){ msg('اتحفظ ✓ — السؤال قيد المراجعة، اعتمده من «بنك الأسئلة» عشان يدخل المسابقات'); ['bcQ','bcO1','bcO2','bcO3','bcO4','bcRef'].forEach(function(i){ document.getElementById(i).value = ''; }); } else msg(errTxt(r), true);
  };
  window.bcGenForm = function(){
    modal('<h3>⚙️ توليد مسابقة تلقائيًا</h3><input id="bcT" class="input" maxlength="80" placeholder="اسم المسابقة" style="width:100%">'
      + '<div style="display:flex;gap:8px;margin-top:8px;"><input id="bcN" class="input" type="number" value="10" min="3" max="50" style="flex:1"><input id="bcS" class="input" type="number" value="20" min="10" max="120" style="flex:1"></div>'
      + '<div class="cn-sub">عدد الأسئلة · ثواني السؤال. بتتسحب عشوائيًا من الأسئلة المعتمدة وتحتاج مراجعتك قبل النشر.</div>'
      + '<button class="btn" style="width:100%;margin-top:10px;" onclick="bcGen()">توليد</button><button class="btn btn-line" style="width:100%;margin-top:6px;" onclick="bcOpen()">رجوع</button>');
  };
  window.bcGen = async function(){
    var t = document.getElementById('bcT').value.trim(); if(t.length < 2){ msg('اكتب اسم المسابقة', true); return; }
    var r = await rpc('friday_bc_generate', { p_title:t, p_count:+document.getElementById('bcN').value, p_secs:+document.getElementById('bcS').value });
    if(r && r.ok) bcReview(r.id); else msg(errTxt(r) + (r && r.available != null ? ' (المتاح ' + r.available + ')' : ''), true);
  };
  window.bcReview = async function(id){
    var r = await rpc('friday_bc_review', { p_id:id });
    if(!r || !r.ok){ msg(errTxt(r), true); return; }
    modal('<h3>مراجعة قبل النشر</h3>' + r.items.map(function(q){
      return '<div class="cn-row"><b>' + q.pos + '. ' + E(q.question) + '</b>' + q.opts.map(function(o, i){ return '<div class="cn-sub" style="' + (i + 1 === q.correct ? 'color:var(--good);font-weight:800;' : '') + '">' + (i + 1 === q.correct ? '✓ ' : '• ') + E(o) + '</div>'; }).join('') + '</div>';
    }).join('') + '<button class="btn" style="width:100%;margin-top:10px;" onclick="bcAct(\'' + id + '\',\'publish\')">✅ اعتماد ونشر</button><button class="btn btn-line" style="width:100%;margin-top:6px;" onclick="bcOpen()">رجوع</button>');
  };

  /* ---- live play: the server decides the phase/time; we only poll it and show it ---- */
  window.bcPlay = function(id){
    modal('<div id="bcStage" class="empty">جارِ الدخول...</div>');
    var deadline = 0, shown = '', tick;
    async function poll(){
      if(rpcBusy) return; rpcBusy = true;
      var c = await rpc('friday_bc_current', { p_id:id }); rpcBusy = false;
      var s = document.getElementById('bcStage'); if(!s) return stop();
      if(!c || !c.ok){ s.textContent = errTxt(c); return; }
      deadline = Date.now() + (c.seconds_left || 0) * 1000;
      var key = c.phase + ':' + (c.pos || '') + ':' + (c.my_choice || '');
      if(c.phase === 'lobby'){ s.innerHTML = '<h3>⏳ في انتظار البدء</h3><div class="cn-sub">اللاعبين: ' + c.players + '</div>'; return; }
      if(c.phase === 'cancelled'){ s.innerHTML = '<h3>اتلغت المسابقة</h3>'; stop(); return; }
      if(c.phase === 'finished'){ stop(); var lb = await rpc('friday_bc_leaderboard', { p_id:id }); s.innerHTML = '<h3>🏁 النتيجة النهائية</h3>' + board(lb) + '<button class="btn btn-line" style="width:100%;margin-top:10px;" onclick="bcOpen()">رجوع</button>'; return; }
      if(key === shown){ return; } shown = key;
      s.innerHTML = '<div class="cn-sub">سؤال ' + c.pos + ' من ' + c.total + ' · <b id="bcT2">' + Math.ceil(c.seconds_left) + '</b>ث</div><h3 style="margin:8px 0;">' + E(c.question) + '</h3>'
        + c.opts.map(function(o, i){
            var n = i + 1, st = '';
            if(c.phase === 'reveal') st = n === c.correct ? 'background:rgba(43,196,168,.25);border-color:var(--good);' : (n === c.my_choice ? 'background:rgba(255,80,80,.2);' : 'opacity:.6;');
            else if(c.my_choice === n) st = 'background:rgba(227,162,59,.25);border-color:#E3A23B;';
            return '<button class="btn btn-line" style="width:100%;margin:5px 0;text-align:start;' + st + '"' + (c.phase !== 'question' || c.my_choice ? ' disabled' : '') + ' onclick="bcAnswer(\'' + id + '\',' + n + ')">' + n + '. ' + E(o) + '</button>';
          }).join('')
        + (c.phase === 'reveal' ? '<div class="cn-sub">' + (c.my_choice ? (c.my_choice === c.correct ? '✅ إجابة صحيحة' : '❌ إجابة خاطئة') : '⌛ لم تجاوب') + (c.reference ? ' · ' + E(c.reference) : '') + '</div>' : (c.my_choice ? '<div class="cn-sub">اتسجلت إجابتك — الصح هيظهر بعد انتهاء الوقت</div>' : ''));
    }
    window.bcAnswer = async function(cid, n){ try{ hapticTick(); }catch(e){} var r = await rpc('friday_bc_answer', { p_id:cid, p_choice:n }); if(!(r && r.ok)) msg(errTxt(r), true); shown = ''; poll(); };
    poll(); stop(); timer = setInterval(function(){
      var t = document.getElementById('bcT2'); if(t) t.textContent = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      tick = (tick || 0) + 1; if(tick % 6 === 0) poll();     // ~every 1.5 s: re-sync with the server clock
    }, 250);
  };
  function board(lb){
    if(!Array.isArray(lb) || !lb.length) return '<div class="empty">لا نتائج</div>';
    return lb.map(function(x, i){ return '<div class="cn-row" style="display:flex;justify-content:space-between;"><span>' + (['🥇','🥈','🥉'][i] || (i + 1) + '.') + ' ' + E(x.name || '—') + '</span><b>' + x.score + ' <span class="cn-sub">(' + x.correct + ' صح)</span></b></div>'; }).join('');
  }
})();
