/* Waqful Madinah — দৈনিক সময়সূচি (ছাত্র প্রস্তাব · শিক্ষক অনুমোদন) */
(function (w) {
  const LS_KEY = 'madrasa_daily_schedule_v1';

  function _isRemote() { return !!(w.RemoteSync && w.RemoteSync.isRemote()); }
  function _RS() { return w.RemoteSync || null; }
  function _role() {
    const r = typeof w.__MADRASA_ROLE__ !== 'undefined' ? w.__MADRASA_ROLE__ : '';
    return r === 'teacher' || r === 'student' ? r : '';
  }
  function _uid() { return 'ds_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8); }

  function _readLS() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch { return {}; }
  }
  function _writeLS(map) {
    localStorage.setItem(LS_KEY, JSON.stringify(map || {}));
  }

  function _normRow(r, i) {
    return {
      id: r.id || _uid(),
      task: String(r.task || r.task_text || ''),
      time: String(r.time || r.time_text || ''),
      sort: typeof r.sort === 'number' ? r.sort : i,
    };
  }

  function _fromMem(sid) {
    const RS = _RS();
    if (!RS || !_isRemote()) return null;
    if (_role() === 'teacher') {
      const by = RS.mem.dailyScheduleByStudent || {};
      return by[sid] ? JSON.parse(JSON.stringify(by[sid])) : { rows: [], pending: null };
    }
    if (_role() === 'student' && RS.mem.dailySchedule) {
      const me = RS.mem.core && RS.mem.core.students && RS.mem.core.students[0];
      if (me && me.id === sid) return JSON.parse(JSON.stringify(RS.mem.dailySchedule));
    }
    return null;
  }

  const DailySchedule = {
    getForStudent(sid) {
      const fromMem = _fromMem(sid);
      if (fromMem) return fromMem;
      const map = _readLS();
      return map[sid] ? JSON.parse(JSON.stringify(map[sid])) : { rows: [], pending: null };
    },

    /** শিক্ষক: সরাসরি সময়সূচি সেভ (রিমোট বা লোকাল) */
    async setTeacherDirect(sid, rows) {
      const list = (rows || []).map(_normRow);
      if (_isRemote() && _role() === 'teacher' && _RS().setDailyScheduleTeacherRemote) {
        await _RS().setDailyScheduleTeacherRemote(sid, list.map(r => ({ task: r.task, time: r.time })));
        return;
      }
      const map = _readLS();
      map[sid] = { rows: list.map((r, i) => ({ ...r, sort: i })), pending: null };
      _writeLS(map);
    },

    /** ছাত্র: অনুমোদনের জন্য প্রস্তাব পাঠান */
    async submitProposal(sid, rows) {
      const list = (rows || []).map(_normRow);
      if (_isRemote() && _role() === 'student' && _RS().submitDailyScheduleProposalRemote) {
        await _RS().submitDailyScheduleProposalRemote(list.map(r => ({ task: r.task, time: r.time })));
        return;
      }
      const map = _readLS();
      const cur = map[sid] || { rows: [], pending: null };
      cur.pending = {
        rows: list.map((r, i) => ({ ...r, sort: i })),
        status: 'pending',
        submittedAt: new Date().toISOString(),
        teacherNote: '',
      };
      map[sid] = cur;
      _writeLS(map);
    },

    /** শিক্ষক: প্রস্তাব অনুমোদন বা প্রত্যাখ্যান */
    async teacherResolve(sid, approve, note) {
      const n = String(note || '').trim();
      if (_isRemote() && _role() === 'teacher' && _RS().resolveDailyScheduleProposalRemote) {
        await _RS().resolveDailyScheduleProposalRemote(sid, !!approve, n);
        return;
      }
      const map = _readLS();
      const cur = map[sid] || { rows: [], pending: null };
      if (!cur.pending || cur.pending.status !== 'pending') return;
      if (approve) {
        cur.rows = (cur.pending.rows || []).map((r, i) => ({ ...r, sort: i }));
        cur.pending = null;
      } else {
        cur.pending = { ...cur.pending, status: 'rejected', teacherNote: n };
      }
      map[sid] = cur;
      _writeLS(map);
    },

    clearStudent(sid) {
      const map = _readLS();
      if (map[sid]) { delete map[sid]; _writeLS(map); }
      const RS = _RS();
      if (RS && RS.mem) {
        if (RS.mem.dailyScheduleByStudent && RS.mem.dailyScheduleByStudent[sid])
          delete RS.mem.dailyScheduleByStudent[sid];
        if (_role() === 'student' && RS.mem.dailySchedule)
          RS.mem.dailySchedule = { rows: [], pending: null };
      }
    },
  };

  w.DailyScheduleAPI = DailySchedule;
  if (typeof w.API !== 'undefined') w.API.DailySchedule = DailySchedule;
})(typeof window !== 'undefined' ? window : globalThis);
