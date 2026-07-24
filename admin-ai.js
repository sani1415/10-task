(function (w) {
  'use strict';
  const history = [];
  let pendingAction = null;
  let busy = false;
  let speakOn = localStorage.getItem('madrasa_ai_speak') === '1';

  const icon = {
    spark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3Z"/><path d="M18.5 14l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z"/></svg>',
    close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    volume: '<svg viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15 9a4 4 0 0 1 0 6M17.5 6.5a8 8 0 0 1 0 11"/></svg>',
    mic: '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6"/></svg>',
    send: '<svg viewBox="0 0 24 24"><path d="m4 4 16 8-16 8 3-8-3-8Z"/><path d="M7 12h13"/></svg>'
  };

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }
  function todayBD() { return new Date(Date.now() + 21600000).toISOString().slice(0, 10); }
  function clip(value, max) { return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max); }

  function studentContext(student, date, includeDetails) {
    const sid = student.id;
    const today = w.API.Tasks.getRangeProgress(sid, date, date);
    const overall = w.API.Tasks.getListProgress(sid);
    const row = w.API.Biboron && w.API.Biboron.getStudentRow ? w.API.Biboron.getStudentRow(sid) : {};
    const notes = [];
    (includeDetails ? (w.API.StudentNotes?.getAll?.(sid) || []) : []).slice(0, 18).forEach((n) => notes.push({
      kind: 'student_description', date: n.date || n.note_date || '', title: clip(n.title, 100), text: clip(n.text, 700)
    }));
    (includeDetails ? (w.API.TeacherNotes?.getAll?.(sid) || []) : []).slice(0, 12).forEach((n) => notes.push({
      kind: 'teacher_note', date: n.date || n.note_date || '', text: clip(n.text, 700)
    }));
    notes.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const recentMessages = (includeDetails ? (w.API.Messages?.getThread?.(sid) || []) : []).slice(-10).map((m) => ({
      from: m.role === 'in' ? 'student' : 'teacher', time: m.time || '', text: clip(m.text, 450)
    })).filter((m) => m.text);
    return {
      id: sid, name: student.name || '', waqfId: student.waqfId || '', class: student.cls || '', roll: student.roll || '',
      today: { done: today.done | 0, total: today.total | 0, percent: today.percent | 0 },
      overall: { done: overall.done | 0, total: overall.total | 0, percent: overall.percent | 0, from: overall.from || null, to: overall.to || null },
      pending: { unreadMessages: row.unreadMessages | 0, pendingDocs: row.pendingDocs | 0, pendingSchedule: !!row.pendingSchedule, pendingQuiz: row.pendingQuiz | 0, manualGrade: row.manualQuiz | 0 },
      notes: notes.slice(0, 24), recentMessages
    };
  }

  function normalizeFind(value) { return String(value || '').toLocaleLowerCase('bn-BD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); }
  function asksForUnreadMessages(message) {
    const value=normalizeFind(message);
    const mentionsMessages=/(মেসেজ|বার্তা|রিসালা|message|messages)/.test(value);
    const mentionsUnread=/(অপঠিত|আনরিড|unread|পড়িনি|পড়িনি|পড়া হয়নি|পড়া হয়নি|না পড়া|না পড়া|দেখিনি|খুলিনি|নতুন মেসেজ|পাঠিয়েছে|পাঠিয়েছে)/.test(value);
    return mentionsMessages&&mentionsUnread;
  }
  function buildContext(message) {
    const date = todayBD();
    const query = normalizeFind(message);
    const queryParts = query.split(/\s+/).filter((x) => x.length >= 3);
    const allStudents = w.API.Students?.getAll?.() || [];
    const detailedIds = new Set(allStudents.filter((s) => {
      const hay = normalizeFind([s.name, s.waqfId, s.roll].join(' '));
      return queryParts.some((part) => hay.includes(part)) || (query.length >= 3 && hay.includes(query));
    }).slice(0, 5).map((s) => s.id));
    const students = allStudents.map((s) => studentContext(s, date, detailedIds.has(s.id)));
    const includeUnread=asksForUnreadMessages(message);
    const unreadMessages=[];
    if(includeUnread){
      allStudents.forEach((student)=>{
        (w.API.Messages?.getThread?.(student.id)||[]).forEach((m)=>{
          if(m.role!=='in'||m.read) return;
          unreadMessages.push({
            studentId:student.id,studentName:student.name||'',waqfId:student.waqfId||'',
            messageId:m.id||'',time:m.time||'',sentAt:m._ts||null,type:m.type||'text',
            text:clip(m.text||m.fileName||m.extra?.fileName||'(ফাইল/সংযুক্তি)',2000)
          });
        });
      });
      unreadMessages.sort((a,b)=>(Number(b.sentAt)||0)-(Number(a.sentAt)||0));
    }
    const overview = w.API.Tasks?.getTodayOverview?.(date) || [];
    return {
      asOf: new Date().toISOString(), timeZone: 'Asia/Dhaka', today: date,
      scope: 'teacher_admin', studentCount: students.length,
      todayTasks: overview.map((o) => ({
        task: clip(o.task?.title || o.title || '', 140),
        completedStudentIds: (o.completed || []).map((x) => typeof x === 'string' ? x : x.id),
        pendingStudentIds: (o.pending || []).map((x) => typeof x === 'string' ? x : x.id)
      })),
      unreadMessageBodiesIncluded:includeUnread,
      unreadMessageCount:unreadMessages.length,
      unreadMessages,
      students
    };
  }

  function mount() {
    if (document.getElementById('adminAiShell')) return;
    document.body.insertAdjacentHTML('beforeend', `
      <button class="ai-fab" id="adminAiFab" type="button" aria-label="AI সহকারী খুলুন">${icon.spark}<i class="ai-fab-dot"></i></button>
      <div class="ai-shell" id="adminAiShell" role="dialog" aria-modal="true" aria-label="অ্যাডমিন AI সহকারী">
        <section class="ai-panel">
          <header class="ai-head"><div class="ai-mark">${icon.spark}</div><div class="ai-title"><strong>অ্যাডমিন AI সহকারী</strong><span>রিপোর্ট, সারসংক্ষেপ ও অনুমোদিত বার্তা</span></div><button class="ai-head-btn" id="adminAiSpeak" type="button" aria-label="উত্তর পড়ে শোনানো">${icon.volume}</button><button class="ai-head-btn" id="adminAiClose" type="button" aria-label="বন্ধ করুন">${icon.close}</button></header>
          <main class="ai-feed" id="adminAiFeed"><div class="ai-welcome"><h3>আসসালামু আলাইকুম 👋</h3><p>আজকের কাজ, কোনো ছাত্রের বিবরণ বা বাকি বিষয় জানতে পারেন। বার্তা আপনার অনুমোদন ছাড়া পাঠানো হবে না।</p><div class="ai-chips"><button class="ai-chip" data-q="আজ কারা সব কাজ শেষ করেছে এবং কারা বাকি আছে?">আজকের কাজ</button><button class="ai-chip" data-q="আজ যাদের বিষয়ে মনোযোগ দেওয়া দরকার তাদের সংক্ষিপ্ত তালিকা দাও।">মনোযোগ দরকার</button><button class="ai-chip" data-q="সব ছাত্রের আজকের কাজের সংক্ষিপ্ত রিপোর্ট দাও।">সংক্ষিপ্ত রিপোর্ট</button></div></div></main>
          <div class="ai-voice-time" id="adminAiTimer">0:00</div>
          <footer class="ai-compose"><div class="ai-input-wrap"><textarea class="ai-input" id="adminAiInput" rows="1" maxlength="2000" placeholder="কিছু জিজ্ঞেস করুন…"></textarea><button class="ai-mic" id="adminAiMic" type="button" aria-label="ভয়েসে বলুন">${icon.mic}</button></div><button class="ai-send" id="adminAiSend" type="button" aria-label="পাঠান">${icon.send}</button></footer>
        </section>
      </div>`);
    const shell = document.getElementById('adminAiShell');
    document.getElementById('adminAiFab').onclick = open;
    document.getElementById('adminAiClose').onclick = close;
    document.getElementById('adminAiSpeak').onclick = toggleSpeak;
    document.getElementById('adminAiSend').onclick = send;
    document.getElementById('adminAiMic').onclick = () => w.VoiceType?.toggle('admin-ai');
    document.getElementById('adminAiInput').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
    document.getElementById('adminAiInput').addEventListener('input', resizeInput);
    shell.addEventListener('click', (e) => { if (e.target === shell) close(); });
    document.querySelectorAll('.ai-chip').forEach((b) => b.onclick = () => { document.getElementById('adminAiInput').value = b.dataset.q; send(); });
    syncSpeak();
    if (w.VoiceType) w.VoiceType.bind({ id:'admin-ai', micBtn:'#adminAiMic', target:'#adminAiInput', timerEl:'#adminAiTimer', maxSeconds:60, idleTitle:'ভয়েসে প্রশ্ন করুন', onAppend:resizeInput });
  }

  function resizeInput() { const el = document.getElementById('adminAiInput'); if (!el) return; el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 112) + 'px'; }
  function open() { const s = document.getElementById('adminAiShell'); if (!s) return; s.classList.add('open'); setTimeout(() => document.getElementById('adminAiInput')?.focus(), 120); }
  function close() { document.getElementById('adminAiShell')?.classList.remove('open'); w.speechSynthesis?.cancel(); }
  function showAfterAuth() { document.getElementById('adminAiFab')?.classList.add('show'); }
  function hideOnLock() { document.getElementById('adminAiFab')?.classList.remove('show'); close(); }
  function syncSpeak() { document.getElementById('adminAiSpeak')?.classList.toggle('on', speakOn); }
  function toggleSpeak() { speakOn = !speakOn; localStorage.setItem('madrasa_ai_speak', speakOn ? '1' : '0'); syncSpeak(); if (!speakOn) w.speechSynthesis?.cancel(); }
  function speak(text) { if (!speakOn || !('speechSynthesis' in w)) return; w.speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.lang = 'bn-BD'; u.rate = .93; w.speechSynthesis.speak(u); }
  function append(role, text) { const feed = document.getElementById('adminAiFeed'); const row = document.createElement('div'); row.className = 'ai-row ' + role; row.innerHTML = `<div class="ai-bubble">${esc(text)}</div>`; feed.appendChild(row); feed.scrollTop = feed.scrollHeight; return row; }
  function thinking() { const feed = document.getElementById('adminAiFeed'); const row = document.createElement('div'); row.className='ai-row assistant'; row.id='adminAiThinking'; row.innerHTML='<div class="ai-bubble"><span class="ai-thinking"><i></i><i></i><i></i></span></div>'; feed.appendChild(row); feed.scrollTop=feed.scrollHeight; }
  function setBusy(value) { busy=value; const btn=document.getElementById('adminAiSend'); if(btn) btn.disabled=value; const inp=document.getElementById('adminAiInput'); if(inp) inp.disabled=value; }

  function renderAction(action) {
    pendingAction = action;
    const feed = document.getElementById('adminAiFeed');
    const card = document.createElement('div'); card.className='ai-action'; card.id='adminAiAction';
    const isBackup=action.type==='download_backup';
    card.innerHTML=isBackup
      ? `<div class="ai-action-label">ডাউনলোডের আগে নিশ্চিত করুন</div><div class="ai-action-name">সম্পূর্ণ ডেটা ব্যাকআপ</div><div class="ai-action-msg">বর্তমান অ্যাপ ডেটা একটি JSON ফাইল হিসেবে এই ডিভাইসে ডাউনলোড হবে।</div><div class="ai-action-btns"><button class="ai-action-cancel" type="button">বাতিল</button><button class="ai-action-send" type="button">ব্যাকআপ ডাউনলোড</button></div>`
      : `<div class="ai-action-label">পাঠানোর আগে অনুমোদন</div><div class="ai-action-name">${esc(action.studentName)}</div><div class="ai-action-msg">${esc(action.message)}</div><div class="ai-action-btns"><button class="ai-action-cancel" type="button">বাতিল</button><button class="ai-action-send" type="button">বার্তা পাঠান</button></div>`;
    card.querySelector('.ai-action-cancel').onclick=()=>{ pendingAction=null; card.remove(); append('assistant','ঠিক আছে, বার্তাটি পাঠানো হয়নি।'); };
    card.querySelector('.ai-action-send').onclick=()=>confirmAction(card);
    feed.appendChild(card); feed.scrollTop=feed.scrollHeight;
  }

  async function confirmAction(card) {
    const action=pendingAction; if(!action) return;
    if(action.type==='download_backup'){
      try{
        if(typeof w.doExport!=='function') throw new Error('backup_unavailable');
        w.doExport(); pendingAction=null; card.classList.add('sent'); card.querySelector('.ai-action-label').textContent='ব্যাকআপ ডাউনলোড শুরু হয়েছে';
      }catch(error){ console.error(error); if(typeof w.showToast==='function') w.showToast('❌ ব্যাকআপ ডাউনলোড করা যায়নি'); }
      return;
    }
    const student=w.API.Students.getById(action.studentId);
    if(!student || student.name!==action.studentName){ append('assistant','ছাত্রের তথ্য পরিবর্তিত হয়েছে, তাই নিরাপত্তার জন্য বার্তাটি পাঠানো হয়নি। আবার বলুন।'); card.remove(); pendingAction=null; return; }
    const btn=card.querySelector('.ai-action-send'); btn.disabled=true; btn.textContent='পাঠানো হচ্ছে…';
    try {
      await w.API.Messages.send(action.studentId,action.message,'text',{source:'admin_ai'});
      pendingAction=null; card.classList.add('sent'); card.querySelector('.ai-action-label').textContent='বার্তা পাঠানো হয়েছে';
      if(typeof w.renderAll==='function') w.renderAll();
      if(typeof w.showToast==='function') w.showToast('✅ বার্তা পাঠানো হয়েছে');
    } catch(error) { console.error(error); btn.disabled=false; btn.textContent='আবার চেষ্টা করুন'; if(typeof w.showToast==='function') w.showToast('❌ বার্তা পাঠানো যায়নি'); }
  }

  async function send() {
    if(busy) return;
    const input=document.getElementById('adminAiInput'); const message=String(input.value||'').trim(); if(!message) return;
    pendingAction=null; document.getElementById('adminAiAction')?.remove();
    append('user',message); history.push({role:'user',text:message}); input.value=''; resizeInput(); setBusy(true); thinking();
    try {
      const response=await fetch('/api/admin-ai',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message,context:buildContext(message),history:history.slice(-8)})});
      const data=await response.json().catch(()=>({})); if(!response.ok||!data.ok) throw new Error(data.error||'AI উত্তর দিতে পারেনি।');
      document.getElementById('adminAiThinking')?.remove(); append('assistant',data.reply); history.push({role:'assistant',text:data.reply}); if(history.length>16) history.splice(0,history.length-16); speak(data.reply); if(data.action) renderAction(data.action);
    } catch(error) { document.getElementById('adminAiThinking')?.remove(); append('assistant',error.message||'AI সহকারীর সঙ্গে যোগাযোগ করা যায়নি।'); }
    finally { setBusy(false); input.focus(); }
  }

  w.AdminAi={mount,showAfterAuth,hideOnLock,open};
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',mount); else mount();
})(window);
