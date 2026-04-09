/* Waqful Madinah — Supabase sync (PIN-gated RPC in production; direct KV only if role unset). */
(function (w) {
  const BUCKET = 'waqf-files';
  const DEBOUNCE_MS = 400;
  const SIGNED_URL_SEC = 3600;
  let client = null;
  const timers = {};
  let _teacherPin = '';
  let _studentWaqf = '';
  let _studentPin = '';

  const mem = {
    core: null,
    goals: null,
    exams: null,
    docs: [],
    academic: {},
    tnotes: {},
    teacherPin: null,
    loaded: false,
  };

  function role() {
    const r = w.__MADRASA_ROLE__;
    return r === 'teacher' || r === 'student' ? r : '';
  }

  function usesSecureKv() {
    return isRemote() && role() !== '';
  }

  function getCreateClient() {
    const s = w.supabase;
    if (!s) return null;
    if (typeof s.createClient === 'function') return s.createClient;
    if (s.default && typeof s.default.createClient === 'function') return s.default.createClient;
    return null;
  }

  function getClient() {
    if (client) return client;
    const url = w.SUPABASE_URL;
    const key = w.SUPABASE_ANON_KEY;
    const createClient = getCreateClient();
    if (!url || !key || !createClient) return null;
    client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    w.supabaseClient = client;
    return client;
  }

  function isRemote() {
    return !!(w.SUPABASE_URL && w.SUPABASE_ANON_KEY && getCreateClient());
  }

  async function loadKV(sb, key) {
    const { data, error } = await sb.from('app_kv').select('value').eq('key', key).maybeSingle();
    if (error) throw error;
    return data ? data.value : undefined;
  }

  async function saveKVImpl(sb, key, value) {
    const v = value === undefined ? {} : value;
    if (!usesSecureKv()) {
      const { error } = await sb.from('app_kv').upsert(
        { key, value: v, updated_at: new Date().toISOString() },
        { onConflict: 'key' }
      );
      if (error) throw error;
      return;
    }
    if (role() === 'teacher') {
      const { error } = await sb.rpc('madrasa_teacher_save_kv', {
        p_teacher_pin: _teacherPin,
        p_key: key,
        p_value: v,
      });
      if (error) throw error;
      if (key === 'teacher_pin' && v && typeof v === 'object' && v.pin != null) {
        _teacherPin = String(v.pin);
      }
      return;
    }
    const { error } = await sb.rpc('madrasa_student_save_kv', {
      p_waqf: _studentWaqf,
      p_pin: _studentPin,
      p_key: key,
      p_value: v,
    });
    if (error) throw error;
  }

  function applyBundle(bundle) {
    mem.core = bundle.core !== undefined ? bundle.core : null;
    mem.goals = bundle.goals != null ? bundle.goals : {};
    mem.exams = bundle.exams != null ? bundle.exams : { quizzes: [], submissions: [] };
    mem.docs = Array.isArray(bundle.docs_meta) ? bundle.docs_meta : [];
    mem.academic = bundle.academic || {};
    mem.tnotes = bundle.tnotes || {};
    const tp = bundle.teacher_pin;
    mem.teacherPin =
      tp && typeof tp === 'object' && tp.pin != null && String(tp.pin) !== ''
        ? String(tp.pin)
        : null;
  }

  function schedule(key, getter) {
    const sb = getClient();
    if (!sb) return;
    clearTimeout(timers[key]);
    timers[key] = setTimeout(async () => {
      try {
        const val = typeof getter === 'function' ? getter() : getter;
        await saveKVImpl(sb, key, val);
      } catch (e) {
        console.error('RemoteSync save failed:', key, e);
      }
    }, DEBOUNCE_MS);
  }

  async function flushKey(key, value) {
    const sb = getClient();
    if (!sb) return;
    clearTimeout(timers[key]);
    await saveKVImpl(sb, key, value);
  }

  async function bootstrapLegacy() {
    const sb = getClient();
    if (!sb) throw new Error('Supabase client unavailable');
    const keys = ['core', 'goals', 'exams', 'docs_meta', 'academic', 'tnotes', 'teacher_pin'];
    const rows = await Promise.all(keys.map((k) => loadKV(sb, k)));
    const [core, goals, exams, docsMeta, academic, tnotes, teacherPinRow] = rows;
    mem.core = core !== undefined ? core : null;
    mem.goals = goals != null ? goals : {};
    mem.exams = exams != null ? exams : { quizzes: [], submissions: [] };
    mem.docs = Array.isArray(docsMeta) ? docsMeta : [];
    mem.academic = academic || {};
    mem.tnotes = tnotes || {};
    mem.teacherPin =
      teacherPinRow && typeof teacherPinRow === 'object' && teacherPinRow.pin != null
        ? String(teacherPinRow.pin)
        : null;
    mem.loaded = true;
  }

  async function bootstrapTeacherIdle() {
    const sb = getClient();
    if (!sb) throw new Error('Supabase client unavailable');
    const { data, error } = await sb.rpc('madrasa_public_branding');
    if (error) throw error;
    const madrasa = data && data.madrasa ? String(data.madrasa) : 'Waqful Madinah';
    mem.core = {
      teacher: { name: '', madrasa },
      students: [],
      chats: {},
      tasks: [],
      allowEmptyStudents: true,
    };
    mem.goals = {};
    mem.exams = { quizzes: [], submissions: [] };
    mem.docs = [];
    mem.academic = {};
    mem.tnotes = {};
    mem.teacherPin = null;
    _teacherPin = '';
    mem.loaded = true;
  }

  async function unlockTeacherWithPin(pin) {
    const sb = getClient();
    if (!sb) throw new Error('Supabase client unavailable');
    const { data, error } = await sb.rpc('madrasa_teacher_bootstrap', { p_teacher_pin: pin });
    if (error) throw error;
    applyBundle(data);
    _teacherPin = mem.teacherPin != null && mem.teacherPin !== '' ? mem.teacherPin : String(pin);
    mem.loaded = true;
  }

  async function bootstrapStudentIdle() {
    const sb = getClient();
    if (!sb) throw new Error('Supabase client unavailable');
    const { data, error } = await sb.rpc('madrasa_public_branding');
    if (error) throw error;
    const madrasa = data && data.madrasa ? String(data.madrasa) : 'Waqful Madinah';
    mem.core = { teacher: { name: '', madrasa }, students: [], chats: {}, tasks: [] };
    mem.goals = {};
    mem.exams = { quizzes: [], submissions: [] };
    mem.docs = [];
    mem.academic = {};
    mem.tnotes = {};
    mem.teacherPin = null;
    _studentWaqf = '';
    _studentPin = '';
    mem.loaded = true;
  }

  async function unlockStudentWithWaqfPin(waqfRaw, pin) {
    const sb = getClient();
    if (!sb) throw new Error('Supabase client unavailable');
    const { data, error } = await sb.rpc('madrasa_student_bootstrap', {
      p_waqf: String(waqfRaw || '').trim(),
      p_pin: String(pin || ''),
    });
    if (error) throw error;
    applyBundle(data);
    mem.teacherPin = null;
    const norm = (function normalizeWaqf(raw) {
      const t = String(raw || '')
        .trim()
        .replace(/\s/g, '');
      if (!t) return null;
      let n;
      if (/^waqf_/i.test(t)) n = parseInt(t.slice(5), 10);
      else n = parseInt(t, 10);
      if (Number.isNaN(n) || n < 0) return null;
      return 'waqf_' + String(n).padStart(3, '0');
    })(waqfRaw);
    const stu = (mem.core && mem.core.students) || [];
    const hit = stu.find((s) => s.waqfId === norm && String(s.pin) === String(pin));
    _studentWaqf = hit ? hit.waqfId : norm || String(waqfRaw || '').trim();
    _studentPin = String(pin || '');
    mem.loaded = true;
  }

  async function flushAllFromMem() {
    const sb = getClient();
    if (!sb) return;
    await Promise.all([
      saveKVImpl(sb, 'core', mem.core),
      saveKVImpl(sb, 'goals', mem.goals),
      saveKVImpl(sb, 'exams', mem.exams),
      saveKVImpl(sb, 'docs_meta', mem.docs),
      saveKVImpl(sb, 'academic', mem.academic),
      saveKVImpl(sb, 'tnotes', mem.tnotes),
      saveKVImpl(sb, 'teacher_pin', { pin: mem.teacherPin || '' }),
    ]);
  }

  async function uploadFile(path, file) {
    const sb = getClient();
    const { error } = await sb.storage.from(BUCKET).upload(path, file, {
      upsert: true,
      contentType: file.type || 'application/octet-stream',
    });
    if (error) throw error;
    const { data, error: e2 } = await sb.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_SEC);
    if (e2) throw e2;
    return { url: data.signedUrl, path };
  }

  async function getSignedUrlForPath(path) {
    const sb = getClient();
    if (!sb || !path) return null;
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_SEC);
    if (error) {
      console.error('Signed URL failed:', path, error);
      return null;
    }
    return data.signedUrl;
  }

  function consumeUploadResult(res) {
    if (res && typeof res === 'object' && res.url) return { fileUrl: res.url, storagePath: res.path };
    return { fileUrl: res, storagePath: null };
  }

  function bootstrap() {
    if (!usesSecureKv()) return bootstrapLegacy();
    if (role() === 'teacher') return bootstrapTeacherIdle();
    if (role() === 'student') return bootstrapStudentIdle();
    return bootstrapLegacy();
  }

  w.RemoteSync = {
    isRemote,
    getClient,
    usesSecureKv,
    mem,
    bootstrap,
    bootstrapLegacy,
    bootstrapTeacherIdle,
    bootstrapStudentIdle,
    unlockTeacherWithPin,
    unlockStudentWithWaqfPin,
    schedule,
    flushKey,
    flushAllFromMem,
    uploadFile,
    getSignedUrlForPath,
    consumeUploadResult,
    BUCKET,
  };
})(typeof window !== 'undefined' ? window : globalThis);
