/* Waqful Madinah — remote-sync.js (relational, madrasa_rel_* RPCs)
   Requires: remote-sync-write.js loaded first */
(function (w) {
  const BUCKET = 'waqf-files';
  const DEBOUNCE_MS = 400;
  const SIGNED_URL_SEC = 3600;
  let client = null;
  const timers = {};
  let _teacherPin = '';
  let _studentWaqf = '';
  let _studentPin = '';
  let _studentId = '';
  let realtimeChannel = null;
  const _savedMsgIds = new Set();

  const mem = {
    core: null, goals: null, exams: null,
    docs: [], academic: {}, tnotes: {},
    teacherPin: null, lockHints: [], loaded: false,
    completions: [],
  };

  function role() { const r = w.__MADRASA_ROLE__; return r === 'teacher' || r === 'student' ? r : ''; }
  function usesSecureKv() { return isRemote() && role() !== ''; }

  function getCreateClient() {
    const s = w.supabase;
    if (!s) return null;
    if (typeof s.createClient === 'function') return s.createClient;
    if (s.default && typeof s.default.createClient === 'function') return s.default.createClient;
    return null;
  }

  function getClient() {
    if (client) return client;
    const url = w.SUPABASE_URL, key = w.SUPABASE_ANON_KEY, create = getCreateClient();
    if (!url || !key || !create) return null;
    client = create(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    w.supabaseClient = client;
    return client;
  }

  function isRemote() { return !!(w.SUPABASE_URL && w.SUPABASE_ANON_KEY && getCreateClient()); }

  /** "001" / "waqf_001" → `waqf_001` for RPC (matches `students.waqf_id`). */
  function normalizeWaqfForRpc(raw) {
    const t = String(raw || '').trim().replace(/\s/g, '');
    if (!t) return '';
    let n;
    if (/^waqf_/i.test(t)) n = parseInt(t.slice(5), 10);
    else n = parseInt(t, 10);
    if (Number.isNaN(n) || n < 0) return t;
    return 'waqf_' + String(n).padStart(3, '0');
  }

  // Write module context — wired up at bottom
  const _write = (w._RSWrite || { init: () => ({}) }).init({
    getPin: () => _teacherPin,
    setPin: (p) => { _teacherPin = p; mem.teacherPin = p; },
    getStudentPin: () => _studentPin,
    getStudentWaqf: () => _studentWaqf,
    getStudentId: () => _studentId,
    getRole: role,
    savedMsgIds: _savedMsgIds,
  });

  // ── Field conversion: DB (snake_case) → mem (camelCase) ──────
  function stuFromDB(r) {
    return { id: r.id, waqfId: r.waqf_id, name: r.name, cls: r.cls || '', roll: r.roll || '',
      pin: r.pin, color: r.color || '#128C7E', note: r.note || '',
      fatherName: r.father_name || '', fatherOccupation: r.father_occupation || '',
      contact: r.contact || '', district: r.district || '', upazila: r.upazila || '',
      bloodGroup: r.blood_group || '', enrollmentDate: r.enrollment_date || '' };
  }

  function msgFromDB(m) {
    return { id: m.id, role: m.role, type: m.type || 'text', text: m.text || '',
      read: m.is_read || false,
      time: m.sent_at ? new Date(m.sent_at).toTimeString().slice(0, 5) : '',
      _ts: m.sent_at ? new Date(m.sent_at).getTime() : 0,
      ...(m.extra && typeof m.extra === 'object' ? m.extra : {}) };
  }

  // ── Assemble relational teacher bundle → mem ─────────────────
  function assembleTeacherBundle(bundle) {
    const cfg = bundle.config || {};
    const students = (bundle.students || []).map(stuFromDB);
    const chats = { _bc: [] };
    students.forEach(s => { chats[s.id] = []; });
    (bundle.messages || []).forEach(m => {
      _savedMsgIds.add(m.id);
      const msg = msgFromDB(m);
      if (m.thread_id === '_bc') chats._bc.push(msg);
      else { if (!chats[m.thread_id]) chats[m.thread_id] = []; chats[m.thread_id].push(msg); }
    });
    const asByTask = {};
    (bundle.task_assignments || []).forEach(ta => {
      (asByTask[ta.task_id] = asByTask[ta.task_id] || []).push(ta);
    });
    const tasks = (bundle.tasks || []).map(t => {
      const assignees = {}, completedBy = {};
      (asByTask[t.id] || []).forEach(ta => {
        assignees[ta.student_id] = ta.status;
        if (ta.completed_date || ta.completed_time)
          completedBy[ta.student_id] = { date: ta.completed_date || '', time: ta.completed_time || '' };
      });
      return { id: t.id, title: t.title, desc: t.description || '', type: t.type || 'onetime',
        deadline: t.deadline || '', created: t.created_at || '', assignees, completedBy };
    });
    const goals = {};
    (bundle.goals || []).forEach(g => {
      (goals[g.student_id] = goals[g.student_id] || []).push(
        { id: g.id, title: g.title, cat: g.cat, deadline: g.deadline || '',
          note: g.note || '', done: g.done || false, created: g.created_at || '' });
    });
    const qByQ = {}, aByQ = {};
    (bundle.quiz_questions || []).forEach(q => {
      (qByQ[q.quiz_id] = qByQ[q.quiz_id] || []).push({ id: q.id, type: q.type, text: q.text,
        options: q.options || [], correctAnswer: q.correct_answer, marks: q.marks || 1,
        uploadInstructions: q.upload_instructions });
    });
    (bundle.quiz_assignees || []).forEach(qa => {
      (aByQ[qa.quiz_id] = aByQ[qa.quiz_id] || []).push(qa.student_id);
    });
    const quizzes = (bundle.quizzes || []).map(q => ({
      id: q.id, title: q.title, subject: q.subject || '', desc: q.description || '',
      timeLimit: q.time_limit || 30, passPercent: q.pass_percent || 60,
      deadline: q.deadline || '', created: q.created_at || '',
      questions: qByQ[q.id] || [], assigneeIds: aByQ[q.id] || [] }));
    const submissions = (bundle.quiz_submissions || []).map(qs => ({
      id: qs.id, quizId: qs.quiz_id, studentId: qs.student_id, studentName: qs.student_name || '',
      answers: qs.answers || {}, score: qs.score || 0, total: qs.total || 0,
      passed: qs.passed || false, needsManualGrade: qs.needs_manual_grade || false }));
    const docs = (bundle.documents || []).map(d => ({
      id: d.id, studentId: d.student_id, studentName: d.student_name || '',
      fileName: d.file_name, fileType: d.file_type || '', fileSize: d.file_size || 0,
      category: d.category || 'general', note: d.note || '',
      storage_path: d.storage_path, fileUrl: d.file_url, read: d.is_read || false,
      uploadedAt: d.uploaded_at || '' }));
    const academic = {}, tnotes = {};
    (bundle.academic_history || []).forEach(ah => {
      (academic[ah.student_id] = academic[ah.student_id] || []).push(
        { id: ah.id, yearClass: ah.year_class, grade: ah.grade, addedAt: ah.added_at || '' });
    });
    (bundle.teacher_notes || []).forEach(tn => {
      (tnotes[tn.student_id] = tnotes[tn.student_id] || []).push(
        { id: tn.id, text: tn.text, date: tn.note_date || '', time: tn.note_time || '' });
    });
    mem.core = { teacher: { name: cfg.teacher_name || '', madrasa: cfg.madrasa_name || 'Waqful Madinah' },
      students, chats, tasks };
    mem.goals = goals; mem.exams = { quizzes, submissions };
    mem.docs = docs; mem.academic = academic; mem.tnotes = tnotes;
    mem.teacherPin = cfg.teacher_pin ? String(cfg.teacher_pin) : null;
    mem.completions = Array.isArray(bundle.completions)
      ? bundle.completions.map(tc => ({
        id: tc.id,
        task_id: tc.task_id,
        student_id: tc.student_id,
        date: (tc.comp_date || tc.date || ''),
        status: tc.status || 'done',
        completed_at: tc.completed_at || null,
        note: tc.note || '',
        created_at: tc.created_at || null,
      }))
      : [];
  }

  // ── Assemble relational student bundle → mem ─────────────────
  function assembleStudentBundle(bundle) {
    const stu = bundle.student ? stuFromDB(bundle.student) : null;
    const cfg = bundle.config || {};
    const chats = { _bc: [] };
    if (stu) chats[stu.id] = [];
    (bundle.messages || []).forEach(m => {
      _savedMsgIds.add(m.id);
      const msg = msgFromDB(m);
      if (m.thread_id === '_bc') chats._bc.push(msg);
      else { if (!chats[m.thread_id]) chats[m.thread_id] = []; chats[m.thread_id].push(msg); }
    });
    const tasks = (bundle.tasks || []).filter(Boolean).map(item => {
      const t = item.task || item, ta = item.assignment || {};
      return { id: t.id, title: t.title, desc: t.description || '', type: t.type || 'onetime',
        deadline: t.deadline || '', created: t.created_at || '',
        assignees: stu ? { [stu.id]: ta.status || 'pending' } : {},
        completedBy: stu && (ta.completed_date || ta.completed_time)
          ? { [stu.id]: { date: ta.completed_date || '', time: ta.completed_time || '' } } : {} };
    });
    const goals = {};
    (bundle.goals || []).forEach(g => {
      (goals[g.student_id] = goals[g.student_id] || []).push(
        { id: g.id, title: g.title, cat: g.cat, deadline: g.deadline || '',
          note: g.note || '', done: g.done || false, created: g.created_at || '' });
    });
    const quizzes = (bundle.quizzes || []).filter(Boolean).map(item => {
      const q = item.quiz || item;
      return { id: q.id, title: q.title, subject: q.subject || '', desc: q.description || '',
        timeLimit: q.time_limit || 30, passPercent: q.pass_percent || 60,
        deadline: q.deadline || '', created: q.created_at || '',
        questions: (item.questions || []).map(qq => ({ id: qq.id, type: qq.type, text: qq.text,
          options: qq.options || [], correctAnswer: qq.correct_answer, marks: qq.marks || 1 })),
        assigneeIds: stu ? [stu.id] : [] };
    });
    const submissions = (bundle.quizzes || []).filter(Boolean)
      .map(i => i.submission).filter(Boolean).map(qs => ({
        id: qs.id, quizId: qs.quiz_id, studentId: qs.student_id, studentName: qs.student_name || '',
        answers: qs.answers || {}, score: qs.score || 0, total: qs.total || 0,
        passed: qs.passed || false, needsManualGrade: qs.needs_manual_grade || false }));
    const docs = (bundle.documents || []).map(d => ({
      id: d.id, studentId: d.student_id, studentName: d.student_name || '',
      fileName: d.file_name, fileType: d.file_type || '', fileSize: d.file_size || 0,
      category: d.category || 'general', note: d.note || '',
      storage_path: d.storage_path, fileUrl: d.file_url, read: d.is_read || false,
      uploadedAt: d.uploaded_at || '' }));
    const academic = {};
    (bundle.academic_history || []).forEach(ah => {
      (academic[ah.student_id] = academic[ah.student_id] || []).push(
        { id: ah.id, yearClass: ah.year_class, grade: ah.grade, addedAt: ah.added_at || '' });
    });
    mem.core = { teacher: { name: cfg.teacher_name || '', madrasa: cfg.madrasa || 'Waqful Madinah' },
      students: stu ? [stu] : [], chats, tasks };
    mem.goals = goals; mem.exams = { quizzes, submissions };
    mem.docs = docs; mem.academic = academic; mem.tnotes = {};
    mem.teacherPin = null;
    mem.completions = Array.isArray(bundle.completions)
      ? bundle.completions.map(tc => ({
        id: tc.id,
        task_id: tc.task_id,
        student_id: tc.student_id,
        date: (tc.comp_date || tc.date || ''),
        status: tc.status || 'done',
        completed_at: tc.completed_at || null,
        note: tc.note || '',
        created_at: tc.created_at || null,
      }))
      : [];
  }

  // ── Schedule / flush ─────────────────────────────────────────
  function schedule(key, getter) {
    const sb = getClient(); if (!sb) return;
    clearTimeout(timers[key]);
    timers[key] = setTimeout(async () => {
      delete timers[key];
      try { await _write.saveKVImpl(sb, key, typeof getter === 'function' ? getter() : getter, usesSecureKv()); }
      catch (e) { console.error('RemoteSync save failed:', key, e); }
    }, DEBOUNCE_MS);
  }

  async function flushKey(key, value) {
    const sb = getClient(); if (!sb) return;
    clearTimeout(timers[key]); delete timers[key];
    await _write.saveKVImpl(sb, key, value, usesSecureKv());
  }

  async function flushAllFromMem() {
    const sb = getClient(); if (!sb) return;
    try {
      await _write.saveCore(sb, mem.core);
      await _write.saveGoals(sb, mem.goals);
      await _write.saveExams(sb, mem.exams);
      await _write.saveDocs(sb, mem.docs);
    } catch (e) { console.error('flushAllFromMem:', e); }
  }

  async function markMessagesReadRemote(threadId, roleStr) {
    const sb = getClient(); if (!sb || !usesSecureKv()) return;
    const r = roleStr || role();
    const pin = r === 'teacher' ? _teacherPin : _studentPin;
    if (!pin) return;
    try { await sb.rpc('madrasa_rel_mark_messages_read', { p_pin: pin, p_role: r, p_thread_id: threadId }); }
    catch (e) { console.warn('markMessagesReadRemote:', e); }
  }

  // ── Bootstrap ────────────────────────────────────────────────
  async function _publicBranding(sb) {
    const { data, error } = await sb.rpc('madrasa_rel_public_branding');
    if (error) throw error;
    return data?.madrasa ? String(data.madrasa) : 'Waqful Madinah';
  }

  async function bootstrapTeacherIdle() {
    const sb = getClient(); if (!sb) throw new Error('Supabase client unavailable');
    const madrasa = await _publicBranding(sb);
    mem.core = { teacher: { name: '', madrasa }, students: [], chats: { _bc: [] }, tasks: [], allowEmptyStudents: true };
    mem.goals = {}; mem.exams = { quizzes: [], submissions: [] };
    mem.docs = []; mem.academic = {}; mem.tnotes = {};
    mem.teacherPin = null; mem.lockHints = []; _teacherPin = ''; mem.loaded = true;
  }

  async function bootstrapStudentIdle() {
    const sb = getClient(); if (!sb) throw new Error('Supabase client unavailable');
    const madrasa = await _publicBranding(sb);
    mem.core = { teacher: { name: '', madrasa }, students: [], chats: { _bc: [] }, tasks: [] };
    mem.goals = {}; mem.exams = { quizzes: [], submissions: [] };
    mem.docs = []; mem.academic = {}; mem.tnotes = {};
    mem.teacherPin = null; _studentWaqf = ''; _studentPin = ''; _studentId = '';
    const { data: hints, error: hErr } = await sb.rpc('madrasa_rel_student_lock_hints');
    mem.lockHints = hErr ? [] : (Array.isArray(hints) ? hints : []);
    mem.loaded = true;
  }

  async function bootstrapLegacy() {
    const sb = getClient(); if (!sb) throw new Error('Supabase client unavailable');
    const keys = ['core', 'goals', 'exams', 'docs_meta', 'academic', 'tnotes', 'teacher_pin'];
    const rows = await Promise.all(keys.map(k =>
      sb.from('app_kv').select('value').eq('key', k).maybeSingle().then(r => r.data?.value)));
    const [core, goals, exams, docs, academic, tnotes, tp] = rows;
    mem.core = core || null; mem.goals = goals || {};
    mem.exams = exams || { quizzes: [], submissions: [] };
    mem.docs = Array.isArray(docs) ? docs : [];
    mem.academic = academic || {}; mem.tnotes = tnotes || {};
    mem.teacherPin = tp?.pin ? String(tp.pin) : null;
    mem.lockHints = []; mem.loaded = true;
  }

  function bootstrap() {
    if (!usesSecureKv()) return bootstrapLegacy();
    if (role() === 'teacher') return bootstrapTeacherIdle();
    if (role() === 'student') return bootstrapStudentIdle();
    return bootstrapLegacy();
  }

  async function unlockTeacherWithPin(pin) {
    const sb = getClient(); if (!sb) throw new Error('Supabase client unavailable');
    const { data, error } = await sb.rpc('madrasa_rel_teacher_bootstrap', { p_teacher_pin: pin });
    if (error) throw error;
    assembleTeacherBundle(data);
    _teacherPin = (mem.teacherPin && mem.teacherPin !== '') ? mem.teacherPin : String(pin);
    mem.loaded = true;
  }

  async function unlockStudentWithWaqfPin(waqfRaw, pin) {
    const sb = getClient(); if (!sb) throw new Error('Supabase client unavailable');
    const waqfNorm = normalizeWaqfForRpc(waqfRaw);
    const { data, error } = await sb.rpc('madrasa_rel_student_bootstrap',
      { p_waqf: waqfNorm, p_pin: String(pin || '') });
    if (error) throw error;
    assembleStudentBundle(data);
    mem.teacherPin = null;
    const stu = mem.core?.students?.[0];
    _studentWaqf = stu?.waqfId || waqfNorm;
    _studentPin = String(pin || '');
    _studentId = stu?.id || '';
    mem.lockHints = []; mem.loaded = true;
  }

  async function refreshStudentLockHints() {
    // lock screen-এ কেউ login না করলেও hints দরকার — role check বাদ দিই
    if (!isRemote()) return;
    const sb = getClient(); if (!sb) return;
    const { data, error } = await sb.rpc('madrasa_rel_student_lock_hints');
    mem.lockHints = error ? [] : (Array.isArray(data) ? data : []);
  }

  async function pullRemoteSnapshot() {
    if (!isRemote() || !mem.loaded) return;
    const sb = getClient(); if (!sb) return;
    try {
      if (usesSecureKv() && role() === 'teacher' && _teacherPin) {
        const { data, error } = await sb.rpc('madrasa_rel_teacher_bootstrap', { p_teacher_pin: _teacherPin });
        if (!error) assembleTeacherBundle(data);
      } else if (usesSecureKv() && role() === 'student' && _studentWaqf && _studentPin) {
        const { data, error } = await sb.rpc('madrasa_rel_student_bootstrap',
          { p_waqf: _studentWaqf, p_pin: _studentPin });
        if (!error) { assembleStudentBundle(data); mem.teacherPin = null; }
      } else if (usesSecureKv() && role() === 'student') {
        await refreshStudentLockHints();
      }
    } catch (e) { console.warn('pullRemoteSnapshot:', e); }
    if (w.dispatchEvent) w.dispatchEvent(new CustomEvent('madrasa-remote-sync'));
  }

  function startRealtimeSync() {
    if (!isRemote()) return;
    const sb = getClient(); if (!sb || realtimeChannel) return;
    const pull = () => setTimeout(() => void pullRemoteSnapshot(), 200);
    realtimeChannel = sb.channel('madrasa_rel_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, pull)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'students' }, pull)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, pull)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_assignments' }, pull)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_completions' }, pull)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'quizzes' }, pull)
      .subscribe();
  }

  // ── File storage ──────────────────────────────────────────────
  async function uploadFile(path, file) {
    if (!file || typeof file.size !== 'number' || file.size > 10 * 1024 * 1024) throw new Error('file_too_large');
    const sb = getClient();
    const { error } = await sb.storage.from(BUCKET).upload(path, file,
      { upsert: true, contentType: file.type || 'application/octet-stream' });
    if (error) throw error;
    const { data, error: e2 } = await sb.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_SEC);
    if (e2) throw e2;
    return { url: data.signedUrl, path };
  }

  async function getSignedUrlForPath(path) {
    const sb = getClient(); if (!sb || !path) return null;
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_SEC);
    if (error) { console.error('Signed URL failed:', path, error); return null; }
    return data.signedUrl;
  }

  function consumeUploadResult(res) {
    if (res && typeof res === 'object' && res.url) return { fileUrl: res.url, storagePath: res.path };
    return { fileUrl: res, storagePath: null };
  }

  function upsertCompletionRemote(row) {
    if (!usesSecureKv()) return;
    const sb = getClient(); if (!sb) return;
    const r = role(), pin = r === 'teacher' ? _teacherPin : _studentPin;
    _write.upsertCompletionRemote(sb, row, pin, r);
  }

  function deleteCompletionRemote(tid, sid, date) {
    if (!usesSecureKv()) return;
    const sb = getClient(); if (!sb) return;
    const r = role(), pin = r === 'teacher' ? _teacherPin : _studentPin;
    _write.deleteCompletionRemote(sb, tid, sid, date, pin, r);
  }

  async function clearStudentDataRemote(sid) {
    if (!usesSecureKv() || role() !== 'teacher' || !_teacherPin) return;
    const sb = getClient(); if (!sb) return;
    try {
      await sb.rpc('madrasa_rel_clear_student_data', { p_teacher_pin: _teacherPin, p_student_id: sid });
    } catch (e) { console.warn('clearStudentDataRemote:', e); }
  }

  async function deleteStudentRemote(sid) {
    if (!usesSecureKv() || role() !== 'teacher' || !_teacherPin) return;
    const sb = getClient(); if (!sb) return;
    try {
      await sb.rpc('madrasa_rel_delete_student', { p_teacher_pin: _teacherPin, p_student_id: sid });
      if (Array.isArray(mem.lockHints)) mem.lockHints = mem.lockHints.filter(s => s.id !== sid);
    } catch (e) { console.warn('deleteStudentRemote:', e); }
  }

  async function deleteQuizRemote(qid) {
    if (!usesSecureKv() || role() !== 'teacher' || !_teacherPin) return;
    const sb = getClient(); if (!sb || !qid) return;
    try {
      await sb.rpc('madrasa_rel_delete_quiz', { p_teacher_pin: _teacherPin, p_quiz_id: qid });
    } catch (e) { console.warn('deleteQuizRemote:', e); }
  }

  w.RemoteSync = {
    isRemote, usesSecureKv, getClient,
    mem,
    bootstrap, bootstrapLegacy, bootstrapTeacherIdle, bootstrapStudentIdle,
    unlockTeacherWithPin, unlockStudentWithWaqfPin,
    refreshStudentLockHints,
    schedule, flushKey, flushAllFromMem,
    markMessagesReadRemote, clearStudentDataRemote, deleteStudentRemote, deleteQuizRemote,
    upsertCompletionRemote, deleteCompletionRemote,
    uploadFile, getSignedUrlForPath, consumeUploadResult,
    BUCKET, startRealtimeSync, pullRemoteSnapshot,
  };
})(typeof window !== 'undefined' ? window : globalThis);
