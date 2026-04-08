/* মাদরাসাতুল মদিনা · api.js · v3.0
   Backend বদলাতে শুধু এই ফাইল বদলান।
   এখন: LocalStorage | পরে: Firebase / Supabase

   ───── Storage keys ─────
   madrasa_db        → main DB (teacher, students, chats, tasks)
   madrasa_goals     → per-student goals
   madrasa_exams     → quizzes + submissions
   madrasa_docs      → document metadata (file content stored separately)
   madrasa_doc_<id>  → base64 file content for each document
   teacher_pin       → teacher PIN override
*/
const API = (() => {
  const DB_KEY='madrasa_db', GOALS_KEY='madrasa_goals',
        EXAMS_KEY='madrasa_exams', DOCS_KEY='madrasa_docs',
        T_PIN_KEY='teacher_pin', DEF_PIN='1234';

  const today  = () => new Date().toISOString().split('T')[0];
  const nowTime= () => { const d=new Date(); return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; };
  const nextDate= d => { const dt=new Date(); dt.setDate(dt.getDate()+d); return dt.toISOString().split('T')[0]; };
  const uid    = p => (p||'id')+Date.now()+Math.random().toString(36).slice(2,5);
  const readDB = () => { try { return JSON.parse(localStorage.getItem(DB_KEY))||null; } catch { return null; } };
  const writeDB= db => localStorage.setItem(DB_KEY, JSON.stringify(db));

  // ── Seed ──────────────────────────────────────────────────
  function seedDemo() {
    const colors=['#128C7E','#1565C0','#6A1B9A','#BF360C','#1B5E20'];
    const db = {
      teacher: { name:'শিক্ষক', madrasa:'মাদরাসাতুল মদিনা' },
      students: [
        { id:'s1', name:'মুহাম্মাদ আব্দুল্লাহ', cls:'হিফজ ১ম', roll:'০১', note:'মেধাবী', color:colors[0], pin:'1111' },
        { id:'s2', name:'আহমাদ উমর',           cls:'হিফজ ১ম', roll:'০২', note:'',       color:colors[1], pin:'2222' },
        { id:'s3', name:'ইউসুফ হাসান',          cls:'নাজেরা ২য়', roll:'০৩', note:'',    color:colors[2], pin:'3333' },
      ],
      chats: {
        's1': [{ id:uid('m'), role:'out', text:'আস-সালামু আলাইকুম। পাঠ তৈরি?', time:'১০:০০', read:true, type:'text' }],
        's2': [{ id:uid('m'), role:'out', text:'উমর, তেলাওয়াত কেমন গেল?',     time:'০৯:৩০', read:true, type:'text' }],
        '_bc':[{ id:uid('m'), role:'out', text:'📢 কাল সকাল ৮টায় বিশেষ দরস।', time:'০৮:০০', read:true, type:'text' }],
      },
      tasks: [
        {
          id:'t1', title:'সূরা মুলক মুখস্থ', desc:'আগামী শুক্রবারের মধ্যে সম্পূর্ণ।',
          type:'onetime', deadline:nextDate(5), created:today(),
          assignees:{ s1:'pending', s2:'done', s3:'pending' }, completedBy:{}
        },
        {
          id:'t2', title:'প্রতিদিন ১ পারা তেলাওয়াত', desc:'প্রতিদিন কমপক্ষে ১ পারা।',
          type:'daily', deadline:'', created:today(),
          assignees:{ s1:'pending', s2:'pending', s3:'pending' }, completedBy:{}
        },
      ],
    };
    writeDB(db);
    return db;
  }

  // ── AUTH ──────────────────────────────────────────────────
  const Auth = {
    getTeacherPin()     { return localStorage.getItem(T_PIN_KEY)||DEF_PIN; },
    setTeacherPin(p)    { localStorage.setItem(T_PIN_KEY, p); },
    checkTeacherPin(p)  { return p === this.getTeacherPin(); },
    findStudentByPin(p) { return readDB()?.students?.find(s=>s.pin===p)||null; },
  };

  // ── DB ────────────────────────────────────────────────────
  const DB = {
    init()          { let db=readDB(); if(!db||!db.students?.length) db=seedDemo(); return db; },
    get()           { return readDB()||this.init(); },
    save(db)        { writeDB(db); },
    getTeacher()    { return this.get().teacher; },
    saveTeacher(data){ const db=this.get(); db.teacher={...db.teacher,...data}; this.save(db); },
    exportJSON()    { return JSON.stringify({ db:this.get(), goals:JSON.parse(localStorage.getItem(GOALS_KEY)||'{}'), exams:JSON.parse(localStorage.getItem(EXAMS_KEY)||'{}'), docs:JSON.parse(localStorage.getItem(DOCS_KEY)||'[]') }, null, 2); },
    importJSON(json){ const p=JSON.parse(json); if(!p.db?.students) throw new Error('invalid'); this.save(p.db); if(p.goals) localStorage.setItem(GOALS_KEY,JSON.stringify(p.goals)); if(p.exams) localStorage.setItem(EXAMS_KEY,JSON.stringify(p.exams)); if(p.docs) localStorage.setItem(DOCS_KEY,JSON.stringify(p.docs)); return p.db; },
  };

  // ── STUDENTS ──────────────────────────────────────────────
  const Students = {
    getAll()  { return DB.get().students||[]; },
    getById(id){ return DB.get().students.find(s=>s.id===id)||null; },
    add({ name, cls, roll, note, pin }) {
      const db = DB.get();
      if (db.students.some(s=>s.pin===pin)) throw new Error('pin_exists');
      const colors=['#128C7E','#1565C0','#6A1B9A','#BF360C','#1B5E20','#E65100','#004D40','#880E4F'];
      const s = { id:uid('s'), name, cls, roll, note, pin, color:colors[db.students.length%colors.length] };
      db.students.push(s); db.chats[s.id]=[]; DB.save(db); return s;
    },
    updatePin(sid, pin) {
      const db=DB.get();
      if (db.students.some(s=>s.id!==sid&&s.pin===pin)) throw new Error('pin_exists');
      const s=db.students.find(s=>s.id===sid); if(s){ s.pin=pin; DB.save(db); } return s;
    },
  };

  // ── MESSAGES ─────────────────────────────────────────────
  const Messages = {
    getThread(id)          { return DB.get().chats[id]||[]; },
    send(threadId,text,type='text',extra={}) {
      const db=DB.get(); if(!db.chats[threadId]) db.chats[threadId]=[];
      // read:false = student hasn't seen it yet (shows single tick; double tick after student opens chat)
      const m={id:uid('m'),role:'out',text,type,time:nowTime(),read:false,...extra};
      db.chats[threadId].push(m); DB.save(db); return m;
    },
    sendFromStudent(sid,text,type='text',extra={}) {
      const db=DB.get(); if(!db.chats[sid]) db.chats[sid]=[];
      // read:false = teacher hasn't seen it yet (single tick on student side)
      const m={id:uid('m'),role:'in',text,type,time:nowTime(),read:false,...extra};
      db.chats[sid].push(m); DB.save(db); return m;
    },
    // Send a file directly from chat (student → teacher)
    sendFileFromStudent(sid, file, { category='general', note='' } = {}) {
      return new Promise((resolve, reject) => {
        const student=Students.getById(sid);
        if(!student){ reject(new Error('student_not_found')); return; }
        if(file.size > 5*1024*1024){ reject(new Error('file_too_large')); return; }
        const reader=new FileReader();
        reader.onload=e=>{
          const docId=uid('doc');
          const meta={
            id:docId, studentId:sid, studentName:student.name,
            fileName:file.name, fileType:file.type, fileSize:file.size,
            category, note, uploadedAt:new Date().toISOString(), read:false,
          };
          try { localStorage.setItem('madrasa_doc_'+docId, e.target.result); }
          catch { reject(new Error('storage_full')); return; }
          const list=JSON.parse(localStorage.getItem('madrasa_docs')||'[]');
          list.unshift(meta); localStorage.setItem('madrasa_docs', JSON.stringify(list));
          // Also create a chat message referencing this doc
          const db=DB.get(); if(!db.chats[sid]) db.chats[sid]=[];
          const m={id:uid('m'),role:'in',type:'doc',text:file.name,time:nowTime(),read:false,
                   fileName:file.name, fileType:file.type, fileSize:file.size, docId};
          db.chats[sid].push(m); DB.save(db);
          resolve({ meta, msg: m });
        };
        reader.onerror=()=>reject(new Error('read_error'));
        reader.readAsDataURL(file);
      });
    },
    // Send a file from teacher → student
    sendFileFromTeacher(sid, file) {
      return new Promise((resolve, reject) => {
        if(file.size > 5*1024*1024){ reject(new Error('file_too_large')); return; }
        const reader=new FileReader();
        reader.onload=e=>{
          const docId=uid('tdoc');
          try { localStorage.setItem('madrasa_doc_'+docId, e.target.result); }
          catch { reject(new Error('storage_full')); return; }
          const db=DB.get(); if(!db.chats[sid]) db.chats[sid]=[];
          const m={id:uid('m'),role:'out',type:'doc',text:file.name,time:nowTime(),read:false,
                   fileName:file.name, fileType:file.type, fileSize:file.size, docId};
          db.chats[sid].push(m); DB.save(db);
          resolve({ msg: m });
        };
        reader.onerror=()=>reject(new Error('read_error'));
        reader.readAsDataURL(file);
      });
    },
    broadcast(text) {
      const db=DB.get(); const m={id:uid('m'),role:'out',text,type:'text',time:nowTime(),read:true};
      if(!db.chats['_bc']) db.chats['_bc']=[];
      db.chats['_bc'].push({...m});
      db.students.forEach(s=>{ if(!db.chats[s.id]) db.chats[s.id]=[]; db.chats[s.id].push({...m,id:uid('m')}); });
      DB.save(db); return m;
    },
    sendTask(sid,task) {
      const db=DB.get(); if(!db.chats[sid]) db.chats[sid]=[];
      const m={id:uid('m'),role:'out',type:'task',text:task.title,task:{title:task.title,desc:task.desc,deadline:task.deadline,taskType:task.type},time:nowTime(),read:true};
      db.chats[sid].push(m); DB.save(db); return m;
    },
    markRead(threadId,role='in') {
      const db=DB.get(); (db.chats[threadId]||[]).forEach(m=>{ if(m.role===role) m.read=true; }); DB.save(db);
    },
    // Teacher opened a student's chat → mark student messages as read (→ double tick on student)
    markReadByTeacher(sid) { this.markRead(sid,'in'); },
    unreadCount(threadId,role='in') { return (DB.get().chats[threadId]||[]).filter(m=>m.role===role&&!m.read).length; },
  };

  // ── TASKS ─────────────────────────────────────────────────
  const Tasks = {
    getAll()          { return DB.get().tasks||[]; },
    getForStudent(sid){ return this.getAll().filter(t=>t.assignees&&t.assignees[sid]); },

    add({ title, desc, deadline, type='onetime', assigneeIds }) {
      const db=DB.get();
      const task = {
        id:uid('t'), title, desc,
        type: type||'onetime',
        deadline: type==='onetime' ? (deadline||nextDate(7)) : '',
        created:today(),
        assignees: Object.fromEntries(assigneeIds.map(id=>[id,'pending'])),
        completedBy: {},
      };
      db.tasks.push(task); DB.save(db);
      assigneeIds.forEach(sid=>Messages.sendTask(sid,task));
      return task;
    },

    // For one-time tasks: cycle pending→done→late
    toggleStatus(tid,sid) {
      const db=DB.get(); const t=db.tasks.find(x=>x.id===tid); if(!t) return null;
      const c=t.assignees[sid]; t.assignees[sid]=c==='pending'?'done':c==='done'?'late':'pending';
      DB.save(db); return t;
    },

    // Mark daily task done for today
    markDailyDone(tid, sid) {
      const db=DB.get(); const t=db.tasks.find(x=>x.id===tid); if(!t) return null;
      if(!t.completedBy) t.completedBy={};
      t.completedBy[sid] = { date:today(), time:nowTime() };
      t.assignees[sid]='done';
      DB.save(db); return t;
    },

    // Reset daily tasks for a new day (call on app init)
    resetDailyForToday() {
      const db=DB.get(); const todayStr=today(); let changed=false;
      db.tasks.forEach(t=>{
        if(t.type!=='daily') return;
        Object.keys(t.assignees||{}).forEach(sid=>{
          const cb=t.completedBy?.[sid];
          if(t.assignees[sid]==='done' && cb?.date !== todayStr) {
            t.assignees[sid]='pending'; changed=true;
          }
        });
      });
      if(changed) DB.save(db);
    },

    // Mark one-time task done (student side)
    markDone(tid, sid) {
      const db=DB.get(); const t=db.tasks.find(x=>x.id===tid); if(!t) return null;
      t.assignees[sid]='done';
      if(!t.completedBy) t.completedBy={};
      t.completedBy[sid]={ date:today(), time:nowTime() };
      DB.save(db); return t;
    },

    isDailyDoneToday(task, sid) {
      return task.completedBy?.[sid]?.date === today();
    },

    pendingCount(sid=null) {
      const tasks=this.getAll(); let n=0;
      if(sid) return tasks.filter(t=>{
        if(t.type==='daily') return !this.isDailyDoneToday(t,sid);
        return t.assignees?.[sid]==='pending';
      }).length;
      tasks.forEach(t=>Object.keys(t.assignees||{}).forEach(s=>{
        if(t.type==='daily'){ if(!this.isDailyDoneToday(t,s)) n++; }
        else { if(t.assignees[s]==='pending') n++; }
      })); return n;
    },

    overallStatus(task) {
      const ids=Object.keys(task.assignees||{});
      if(task.type==='daily'){
        const done=ids.filter(id=>this.isDailyDoneToday(task,id)).length;
        return done===ids.length?'done':done>0?'partial':'pending';
      }
      const done=ids.filter(id=>task.assignees[id]==='done').length;
      const late=task.deadline<today()&&done<ids.length;
      return done===ids.length?'done':late?'late':'pending';
    },

    delete(tid) {
      const db=DB.get(); db.tasks=db.tasks.filter(t=>t.id!==tid); DB.save(db);
    },
  };

  // ── GOALS ─────────────────────────────────────────────────
  const Goals = {
    getAll(sid)  { const all=JSON.parse(localStorage.getItem(GOALS_KEY)||'{}'); return all[sid]||[]; },
    _save(sid,g) { const all=JSON.parse(localStorage.getItem(GOALS_KEY)||'{}'); all[sid]=g; localStorage.setItem(GOALS_KEY,JSON.stringify(all)); },
    add(sid,{title,cat='other',deadline='',note=''}) {
      const goals=this.getAll(sid);
      const g={id:uid('g'),title,cat,deadline,note,done:false,created:today()};
      goals.push(g); this._save(sid,goals); return g;
    },
    toggle(sid,gid)  { const goals=this.getAll(sid); const g=goals.find(x=>x.id===gid); if(g){ g.done=!g.done; this._save(sid,goals); } return g; },
    delete(sid,gid)  { this._save(sid,this.getAll(sid).filter(g=>g.id!==gid)); },
  };

  // ── EXAMS ─────────────────────────────────────────────────
  /*
    Quiz structure:
    {
      id, title, subject, desc, timeLimit (minutes), passPercent,
      deadline, created, assigneeIds:[],
      questions: [{id, type, text, options[], correctAnswer, marks, uploadInstructions}]
    }
    Submission structure:
    {
      id, quizId, studentId, studentName,
      answers: { questionId: answer },
      score, total, passed, submittedAt
    }
  */
  const Exams = {
    _readAll() { try { return JSON.parse(localStorage.getItem(EXAMS_KEY))||{quizzes:[],submissions:[]}; } catch { return {quizzes:[],submissions:[]}; } },
    _write(data) { localStorage.setItem(EXAMS_KEY, JSON.stringify(data)); },

    getQuizzes()                { return this._readAll().quizzes||[]; },
    getQuizById(qid)            { return this.getQuizzes().find(q=>q.id===qid)||null; },
    getQuizzesForStudent(sid)   { return this.getQuizzes().filter(q=>q.assigneeIds?.includes(sid)); },
    getSubmissions()            { return this._readAll().submissions||[]; },
    getSubmission(qid, sid)     { return this.getSubmissions().find(s=>s.quizId===qid&&s.studentId===sid)||null; },
    getSubmissionsForQuiz(qid)  { return this.getSubmissions().filter(s=>s.quizId===qid); },

    addQuiz({ title, subject, desc, timeLimit, passPercent, deadline, assigneeIds, questions }) {
      const data=this._readAll();
      const quiz={
        id:uid('q'), title, subject:subject||'', desc:desc||'',
        timeLimit:parseInt(timeLimit)||30,
        passPercent:parseInt(passPercent)||60,
        deadline:deadline||'', created:today(),
        assigneeIds:assigneeIds||[],
        questions:(questions||[]).map((q,i)=>({...q,id:uid('qq'+i)})),
      };
      data.quizzes.push(quiz); this._write(data); return quiz;
    },

    deleteQuiz(qid) {
      const data=this._readAll();
      data.quizzes=data.quizzes.filter(q=>q.id!==qid);
      data.submissions=data.submissions.filter(s=>s.quizId!==qid);
      this._write(data);
    },

    submitQuiz(qid, sid, answers) {
      const quiz=this.getQuizById(qid); if(!quiz) throw new Error('quiz_not_found');
      const student=Students.getById(sid);
      let score=0, total=0;
      quiz.questions.forEach(q=>{
        total+=q.marks||1;
        const ans=answers[q.id];
        if(q.type==='multiple_choice'||q.type==='true_false'){
          if(String(ans).trim().toLowerCase()===String(q.correctAnswer).trim().toLowerCase()) score+=q.marks||1;
        } else if(q.type==='fill_blank'){
          if(String(ans||'').trim().toLowerCase()===String(q.correctAnswer||'').trim().toLowerCase()) score+=q.marks||1;
        }
        // short_answer / essay / file_upload → teacher grades manually (score=0 initially)
      });
      const data=this._readAll();
      const existing=data.submissions.findIndex(s=>s.quizId===qid&&s.studentId===sid);
      const sub={
        id:uid('sub'), quizId:qid, studentId:sid,
        studentName:student?.name||sid,
        answers, score, total,
        passed:total>0?(score/total*100)>=(quiz.passPercent||60):false,
        submittedAt:new Date().toISOString(),
        needsManualGrade: quiz.questions.some(q=>['short_answer','essay','file_upload'].includes(q.type)),
      };
      if(existing>=0) data.submissions[existing]=sub; else data.submissions.push(sub);
      this._write(data); return sub;
    },

    // Teacher manually updates a score
    updateScore(subId, score) {
      const data=this._readAll();
      const sub=data.submissions.find(s=>s.id===subId); if(!sub) return null;
      const quiz=this.getQuizById(sub.quizId);
      sub.score=score;
      sub.passed=quiz?(score/sub.total*100)>=(quiz.passPercent||60):false;
      this._write(data); return sub;
    },
  };

  // ── DOCUMENTS ────────────────────────────────────────────
  /*
    Document metadata:
    { id, studentId, studentName, fileName, fileType, fileSize,
      category, note, uploadedAt, read }
    File content stored in: madrasa_doc_<id> as base64 data-URL
  */
  const Docs = {
    _readMeta() { try { return JSON.parse(localStorage.getItem(DOCS_KEY))||[]; } catch { return []; } },
    _writeMeta(list) { localStorage.setItem(DOCS_KEY, JSON.stringify(list)); },

    getAll()                { return this._readMeta(); },
    getForStudent(sid)      { return this._readMeta().filter(d=>d.studentId===sid); },
    getById(id)             { return this._readMeta().find(d=>d.id===id)||null; },
    getFileData(id)         { return localStorage.getItem('madrasa_doc_'+id)||null; },

    // Upload: file is a File object, read as base64
    upload(sid, file, { category='general', note='' } = {}) {
      return new Promise((resolve, reject) => {
        const student=Students.getById(sid);
        if(!student){ reject(new Error('student_not_found')); return; }

        // 5 MB limit
        if(file.size > 5*1024*1024){ reject(new Error('file_too_large')); return; }

        const reader=new FileReader();
        reader.onload=e=>{
          const id=uid('doc');
          const meta={
            id, studentId:sid, studentName:student.name,
            fileName:file.name, fileType:file.type, fileSize:file.size,
            category, note, uploadedAt:new Date().toISOString(), read:false,
          };
          try {
            localStorage.setItem('madrasa_doc_'+id, e.target.result);
          } catch(storageErr) {
            reject(new Error('storage_full')); return;
          }
          const list=this._readMeta(); list.unshift(meta); this._writeMeta(list);
          resolve(meta);
        };
        reader.onerror=()=>reject(new Error('read_error'));
        reader.readAsDataURL(file);
      });
    },

    markRead(id) {
      const list=this._readMeta(); const d=list.find(x=>x.id===id);
      if(d){ d.read=true; this._writeMeta(list); }
    },

    delete(id) {
      localStorage.removeItem('madrasa_doc_'+id);
      this._writeMeta(this._readMeta().filter(d=>d.id!==id));
    },

    unreadCount() { return this._readMeta().filter(d=>!d.read).length; },

    totalStorageKB() {
      let bytes=0;
      this._readMeta().forEach(d=>{
        const data=localStorage.getItem('madrasa_doc_'+d.id);
        if(data) bytes+=data.length*0.75; // base64 ≈ 75% of actual size
      });
      return Math.round(bytes/1024);
    },
  };

  return { Auth, DB, Students, Messages, Tasks, Goals, Exams, Docs, today, nowTime, nextDate, uid };
})();

// ── Global helpers ────────────────────────────────────────
function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function autoResize(el){ el.style.height='auto'; el.style.height=Math.min(el.scrollHeight,120)+'px'; }
function showToast(msg,duration=2800){ const t=document.getElementById('toast'); if(!t) return; t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),duration); }
function openModal(id){ document.getElementById(id)?.classList.add('open'); }
function closeModal(id){ document.getElementById(id)?.classList.remove('open'); }
function formatBytes(b){ if(!b) return ''; if(b<1024) return b+' B'; if(b<1048576) return (b/1024).toFixed(1)+' KB'; return (b/1048576).toFixed(1)+' MB'; }
function formatDate(iso){ if(!iso) return ''; return new Date(iso).toLocaleDateString('bn-BD',{year:'numeric',month:'short',day:'numeric'}); }
