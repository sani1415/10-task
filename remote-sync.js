/* Waqful Madinah — Supabase sync layer (loaded before api.js when configured). */
(function (w) {
  const BUCKET = 'waqf-files';
  const DEBOUNCE_MS = 400;
  let client = null;
  const timers = {};

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

  async function saveKV(sb, key, value) {
    const { error } = await sb.from('app_kv').upsert(
      { key, value: value === undefined ? {} : value, updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    );
    if (error) throw error;
  }

  function schedule(key, getter) {
    const sb = getClient();
    if (!sb) return;
    clearTimeout(timers[key]);
    timers[key] = setTimeout(async () => {
      try {
        const val = typeof getter === 'function' ? getter() : getter;
        await saveKV(sb, key, val);
      } catch (e) {
        console.error('RemoteSync save failed:', key, e);
      }
    }, DEBOUNCE_MS);
  }

  async function flushKey(key, value) {
    const sb = getClient();
    if (!sb) return;
    clearTimeout(timers[key]);
    await saveKV(sb, key, value);
  }

  async function bootstrap() {
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

  async function flushAllFromMem() {
    const sb = getClient();
    if (!sb) return;
    await Promise.all([
      saveKV(sb, 'core', mem.core),
      saveKV(sb, 'goals', mem.goals),
      saveKV(sb, 'exams', mem.exams),
      saveKV(sb, 'docs_meta', mem.docs),
      saveKV(sb, 'academic', mem.academic),
      saveKV(sb, 'tnotes', mem.tnotes),
      saveKV(sb, 'teacher_pin', { pin: mem.teacherPin || '' }),
    ]);
  }

  async function uploadFile(path, file) {
    const sb = getClient();
    const { error } = await sb.storage.from(BUCKET).upload(path, file, {
      upsert: true,
      contentType: file.type || 'application/octet-stream',
    });
    if (error) throw error;
    const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
    return data.publicUrl;
  }

  w.RemoteSync = {
    isRemote,
    getClient,
    mem,
    bootstrap,
    schedule,
    flushKey,
    flushAllFromMem,
    uploadFile,
    BUCKET,
  };
})(typeof window !== 'undefined' ? window : globalThis);
