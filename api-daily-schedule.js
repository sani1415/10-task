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

    /** শিক্ষক: এই ছাত্র সময়সূচি অনুমোদনের জন্য পাঠিয়েছে কি না */
    hasPendingApproval(sid) {
      const ds = this.getForStudent(sid);
      return !!(ds.pending && ds.pending.status === 'pending');
    },

    /** শিক্ষক: কতজনের সময়সূচি অনুমোদনের অপেক্ষায় */
    pendingApprovalCount() {
      if (_role() !== 'teacher') return 0;
      const RS = _RS();
      if (RS && _isRemote() && RS.mem && RS.mem.dailyScheduleByStudent) {
        const by = RS.mem.dailyScheduleByStudent;
        return Object.keys(by).filter(k => {
          const d = by[k];
          return d && d.pending && d.pending.status === 'pending';
        }).length;
      }
      const map = _readLS();
      return Object.keys(map).filter(k => {
        const d = map[k];
        return d && d.pending && d.pending.status === 'pending';
      }).length;
    },
  };

  /** Shared schedule editor (student + teacher) — start/end clock + AM/PM + task */
  const _delIc = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';

  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  const ScheduleEditUI = {
    digitsOnly(v) { return String(v == null ? '' : v).replace(/\D/g, '').slice(0, 4); },
    formatClock(v) {
      const d = this.digitsOnly(v);
      if (!d) return '';
      if (d.length <= 2) return d;
      return d.slice(0, 2) + ':' + d.slice(2);
    },
    liveClock(v) {
      const d = this.digitsOnly(v);
      if (d.length <= 2) return d;
      return d.slice(0, 2) + ':' + d.slice(2);
    },
    normAmpm(v) {
      const s = String(v || '').trim().toUpperCase().replace(/\./g, '').replace(/\s+/g, '');
      if (s === 'PM' || s.indexOf('পি') === 0) return 'PM';
      return 'AM';
    },
    parseStored(time) {
      const raw = String(time || '').trim();
      const empty = { start: '', end: '', ampm: 'AM' };
      if (!raw) return empty;
      const re = /(\d{1,2})\s*[:.]?\s*(\d{0,2})\s*(AM|PM|A\.M\.|P\.M\.|এ\.?\s*ম\.?|পি\.?\s*ম\.?)?\s*[-–—~]\s*(\d{1,2})\s*[:.]?\s*(\d{0,2})\s*(AM|PM|A\.M\.|P\.M\.|এ\.?\s*ম\.?|পি\.?\s*ম\.?)?/i;
      const m = raw.match(re);
      if (m) {
        const sDig = (m[1] || '') + (m[2] ? String(m[2]).padStart(2, '0') : '');
        const eDig = (m[4] || '') + (m[5] ? String(m[5]).padStart(2, '0') : '');
        return {
          start: this.formatClock(sDig),
          end: this.formatClock(eDig),
          ampm: this.normAmpm(m[3] || m[6] || 'AM'),
        };
      }
      const one = /(\d{1,2})\s*[:.]?\s*(\d{0,2})\s*(AM|PM|A\.M\.|P\.M\.|এ\.?\s*ম\.?|পি\.?\s*ম\.?)?/i.exec(raw);
      if (one) {
        const dig = (one[1] || '') + (one[2] ? String(one[2]).padStart(2, '0') : '');
        return { start: this.formatClock(dig), end: '', ampm: this.normAmpm(one[3] || 'AM') };
      }
      return empty;
    },
    composeTime(start, end, ampm) {
      const s = this.formatClock(start);
      const e = this.formatClock(end);
      const ap = this.normAmpm(ampm);
      if (!s && !e) return '';
      if (s && e) return s + ' – ' + e + ' ' + ap;
      if (s) return s + ' ' + ap;
      return e + ' ' + ap;
    },
    ampmBtnHtml(val) {
      const v = this.normAmpm(val);
      return '<div class="sched-ampm-wrap"><button type="button" class="sched-ampm-btn" data-ampm-for="row" onclick="ScheduleEditUI.toggleAmpmMenu(this)" aria-label="AM/PM">'
        + v + '</button><div class="sched-ampm-menu" role="listbox">'
        + '<button type="button" class="sched-ampm-opt' + (v === 'AM' ? ' active' : '') + '" onclick="ScheduleEditUI.pickAmpm(this,\'AM\')">AM</button>'
        + '<button type="button" class="sched-ampm-opt' + (v === 'PM' ? ' active' : '') + '" onclick="ScheduleEditUI.pickAmpm(this,\'PM\')">PM</button>'
        + '</div></div>';
    },
    rowHtml(r) {
      const p = this.parseStored(r && r.time);
      const task = _esc((r && r.task) || '');
      return '<div class="schedule-edit-row">'
        + '<input type="text" class="sched-in-clock sched-in-start" inputmode="numeric" maxlength="5" placeholder="শুরু" value="' + _esc(p.start) + '" oninput="ScheduleEditUI.onClockInput(this)" onblur="ScheduleEditUI.onClockBlur(this)">'
        + '<span class="sched-time-dash">–</span>'
        + '<input type="text" class="sched-in-clock sched-in-end" inputmode="numeric" maxlength="5" placeholder="শেষ" value="' + _esc(p.end) + '" oninput="ScheduleEditUI.onClockInput(this)" onblur="ScheduleEditUI.onClockBlur(this)">'
        + this.ampmBtnHtml(p.ampm)
        + '<input type="text" class="sched-in-task" placeholder="কাজ" value="' + task + '">'
        + '<button type="button" class="schedule-edit-del" onclick="this.closest(\'.schedule-edit-row\').remove()" aria-label="সারি মুছুন">' + _delIc + '</button>'
        + '</div>';
    },
    onClockInput(el) {
      if (!el) return;
      const d = this.digitsOnly(el.value);
      el.value = this.liveClock(d);
      el.dataset.digits = d;
    },
    onClockBlur(el) {
      if (!el) return;
      const d = this.digitsOnly(el.dataset.digits || el.value);
      el.value = this.formatClock(d);
      el.dataset.digits = d;
    },
    closeAmpmMenus(rootSel, exceptMenu) {
      const root = rootSel ? document.querySelector(rootSel) : document;
      if (!root) return;
      root.querySelectorAll('.sched-ampm-menu.open').forEach(function (m) {
        if (m !== exceptMenu) m.classList.remove('open');
      });
      root.querySelectorAll('.sched-ampm-btn.open').forEach(function (b) {
        if (!exceptMenu || b.nextElementSibling !== exceptMenu) b.classList.remove('open');
      });
    },
    toggleAmpmMenu(btn) {
      if (!btn) return;
      const menu = btn.nextElementSibling;
      if (!menu) return;
      const open = menu.classList.contains('open');
      this.closeAmpmMenus();
      if (!open) { menu.classList.add('open'); btn.classList.add('open'); }
    },
    pickAmpm(opt, val) {
      const wrap = opt && opt.closest('.sched-ampm-wrap');
      if (!wrap) return;
      const btn = wrap.querySelector('.sched-ampm-btn');
      if (btn) btn.textContent = this.normAmpm(val);
      wrap.querySelectorAll('.sched-ampm-opt').forEach(function (o) {
        o.classList.toggle('active', o === opt);
      });
      this.closeAmpmMenus();
    },
    collectRows(rootSel) {
      const root = document.querySelector(rootSel || '#scheduleEditRows');
      if (!root) return [];
      const out = [];
      root.querySelectorAll('.schedule-edit-row').forEach(function (row) {
        const task = (row.querySelector('.sched-in-task') && row.querySelector('.sched-in-task').value.trim()) || '';
        const start = (row.querySelector('.sched-in-start') && row.querySelector('.sched-in-start').value) || '';
        const end = (row.querySelector('.sched-in-end') && row.querySelector('.sched-in-end').value) || '';
        const ampmBtn = row.querySelector('.sched-ampm-btn');
        const ampm = ampmBtn ? ampmBtn.textContent : 'AM';
        const time = ScheduleEditUI.composeTime(start, end, ampm);
        if (task || time) out.push({ task: task, time: time });
      });
      return out;
    },
    bindDocClick() {
      if (this._bound) return;
      this._bound = true;
      document.addEventListener('click', function (e) {
        if (e.target.closest('.sched-ampm-wrap')) return;
        ScheduleEditUI.closeAmpmMenus();
      });
    },
  };

  w.ScheduleEditUI = ScheduleEditUI;
  w.DailyScheduleAPI = DailySchedule;
  if (typeof w.API !== 'undefined') {
    w.API.DailySchedule = DailySchedule;
    w.API.ScheduleEditUI = ScheduleEditUI;
  }
})(typeof window !== 'undefined' ? window : globalThis);
