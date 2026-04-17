# আমল (Tasks) ফিচার উন্নয়ন — বাস্তবায়ন পরিকল্পনা

এই ডকুমেন্ট Waqful Madinah অ্যাপে বিদ্যমান Tasks সিস্টেমকে পূর্ণাঙ্গ "আমল ট্র্যাকিং" সিস্টেমে রূপান্তরের বিস্তারিত পরিকল্পনা। প্রোটোটাইপ UI ইতোমধ্যে চূড়ান্ত হয়েছে (`amal-prototype.html` দেখো রেফারেন্সের জন্য)।

---

## লক্ষ্য (Goals)

বর্তমান সিস্টেম শুধু আজকের দিনের `pending / done / late` স্ট্যাটাস রাখে এবং রাতে রিসেট হলে পূর্বের ডেটা হারিয়ে যায়। এই ফিচার যোগ করবে:

1. **স্থায়ী ইতিহাস সংরক্ষণ** — প্রতিদিন কোন ছাত্র কোন আমল করেছে তার রেকর্ড
2. **শিক্ষকের সারসংক্ষেপ ড্যাশবোর্ড** — সব ছাত্রের অবস্থা এক পর্দায়
3. **ছাত্রের স্ট্রিক ও প্রোগ্রেস রিং** — অনুপ্রেরণামূলক ভিজ্যুয়াল
4. **ক্যালেন্ডার ভিউ** — মাস-ভিত্তিক ইতিহাস
5. **সাপ্তাহিক লিডারবোর্ড** — ছাত্রদের মধ্যে স্বাস্থ্যকর অনুপ্রেরণা

**দ্বিতীয় ধাপে (এই spec-এ নেই):** সাপ্তাহিক/মাসিক রিপোর্ট কার্ড, বার চার্ট ইতিহাস ট্যাব।

---

## স্থাপত্যের নিয়ম (Architecture Constraints)

প্রকল্পের `CLAUDE.md` অনুযায়ী অবশ্যই মেনে চলতে হবে:

- ALL data logic শুধু `api.js`-এ; HTML শুধু `API.*` কল করবে
- ALL shared CSS `style.css`-এ
- ভাষা: সব user-facing text বাংলায়
- `esc()` দিয়ে user data render করো
- Vanilla JS (no React/Vue)
- Supabase client variable-এর নাম `supabaseClient` (কখনো `supabase` না)

**File size limits:**
- `api.js` → 800 lines max (যদি ছাড়িয়ে যায়, `api-amal.js` module-এ split করো)
- `style.css` → 500 lines max
- `teacher.html` / `student.html` → 600 lines max
- নতুন `.js` file → 400 lines max

**Service Worker cache version bump করতে হবে** `sw.js`-এ (`waqful-full-vN` → `vN+1`)। নতুন file যোগ হলে `LOCAL_SHELL` array-তে যোগ করো।

---

## ডেটা মডেল (Data Model)

### Supabase: নতুন টেবিল `task_completions`

প্রতি দিন/ছাত্র/আমলে আলাদা row। এটাই ইতিহাসের একমাত্র উৎস (source of truth)।

```sql
-- Migration: 012_task_completions.sql

CREATE TABLE public.task_completions (
  id          text PRIMARY KEY,            -- uid('tc')
  task_id     text NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  student_id  text NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  date        date NOT NULL,               -- ISO yyyy-mm-dd, completed date
  status      text NOT NULL CHECK (status IN ('done','missed','partial')),
  completed_at timestamptz,                -- exact time of completion (null for auto-missed)
  note        text,                        -- optional student note
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, student_id, date)
);

CREATE INDEX idx_tc_student_date ON public.task_completions (student_id, date DESC);
CREATE INDEX idx_tc_task_date ON public.task_completions (task_id, date DESC);
CREATE INDEX idx_tc_date ON public.task_completions (date DESC);

ALTER TABLE public.task_completions ENABLE ROW LEVEL SECURITY;
-- RLS: deny all direct REST (follow pattern of 007_relational_rls.sql)
CREATE POLICY tc_deny_all ON public.task_completions FOR ALL USING (false);

-- Add to supabase_realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE public.task_completions;
```

**গুরুত্বপূর্ণ পয়েন্ট:**
- `UNIQUE (task_id, student_id, date)` — একই দিনে একই আমল দু'বার record হবে না। `ON CONFLICT` দিয়ে upsert হবে।
- `status = 'missed'` সার্ভারে স্বয়ংক্রিয় লেখা হবে না — শুধু তখনই write হয় যখন actual completion হয়। "miss" বের করা হয় absence থেকে (task assigned ছিল কিন্তু completion row নেই) → UI-তে calculate।
- `onetime` task-এর ক্ষেত্রে `date` = completion date, `task.deadline` আলাদা ফিল্ড থেকে পাওয়া যাবে।

### Migration ফাইল অর্ডার

`CLAUDE.md`-এর "Production DB migration order" list-এ নতুন এন্ট্রি যোগ করবে:
```
12. 012_task_completions.sql — আমল ইতিহাস টেবিল
13. 013_task_completions_rpc.sql — RPC ফাংশন
```

### নতুন RPC ফাংশন (`madrasa_rel_*` prefix, all `GRANT EXECUTE TO anon`)

সব RPC PIN-gated (`private.verify_teacher_pin()` বা student waqf+pin), pattern `008_relational_rpc.sql` অনুসরণ করবে:

```sql
-- Migration: 013_task_completions_rpc.sql

-- ১. আমল সম্পন্ন mark করা (student + teacher উভয় call করতে পারবে)
-- Student-এর ক্ষেত্রে waqf+pin check; teacher-এর ক্ষেত্রে teacher pin
CREATE OR REPLACE FUNCTION public.madrasa_rel_upsert_completion(
  p_pin text,
  p_id text,
  p_task_id text,
  p_student_id text,
  p_date date,
  p_status text,
  p_completed_at timestamptz,
  p_note text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- verify pin (student or teacher)
  -- ... use private.verify_teacher_pin(p_pin) OR check student pin
  INSERT INTO task_completions (id, task_id, student_id, date, status, completed_at, note)
  VALUES (p_id, p_task_id, p_student_id, p_date, p_status, p_completed_at, p_note)
  ON CONFLICT (task_id, student_id, date)
  DO UPDATE SET status = EXCLUDED.status,
                completed_at = EXCLUDED.completed_at,
                note = EXCLUDED.note;
END; $$;

-- ২. একক আমল undo (today only)
CREATE OR REPLACE FUNCTION public.madrasa_rel_delete_completion(
  p_pin text,
  p_task_id text,
  p_student_id text,
  p_date date
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM task_completions
  WHERE task_id = p_task_id AND student_id = p_student_id AND date = p_date;
END; $$;

-- ৩. একজন ছাত্রের নির্দিষ্ট তারিখ range-এ সব completion (ক্যালেন্ডার ভিউ-র জন্য)
CREATE OR REPLACE FUNCTION public.madrasa_rel_student_completions(
  p_pin text,
  p_student_id text,
  p_from date,
  p_to date
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN (SELECT jsonb_agg(row_to_json(t))
          FROM (SELECT * FROM task_completions
                WHERE student_id = p_student_id
                  AND date BETWEEN p_from AND p_to
                ORDER BY date DESC) t);
END; $$;

-- ৪. সব ছাত্রের নির্দিষ্ট তারিখের completions (শিক্ষকের ড্যাশবোর্ড-এর জন্য)
CREATE OR REPLACE FUNCTION public.madrasa_rel_daily_completions(
  p_pin text,
  p_date date
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- only teacher
  RETURN (SELECT jsonb_agg(row_to_json(t))
          FROM (SELECT * FROM task_completions WHERE date = p_date) t);
END; $$;

GRANT EXECUTE ON FUNCTION public.madrasa_rel_upsert_completion TO anon;
GRANT EXECUTE ON FUNCTION public.madrasa_rel_delete_completion TO anon;
GRANT EXECUTE ON FUNCTION public.madrasa_rel_student_completions TO anon;
GRANT EXECUTE ON FUNCTION public.madrasa_rel_daily_completions TO anon;
```

### `teacher_bootstrap` ও `student_bootstrap` RPC-এ যোগ

বিদ্যমান `madrasa_rel_teacher_bootstrap(pin)` ও `madrasa_rel_student_bootstrap(waqf, pin)` RPC-তে গত ৩৫ দিনের completion ডেটা assembled return-এ যোগ করতে হবে:

- Teacher bootstrap → সব ছাত্রের গত ৩৫ দিন (সাপ্তাহিক লিডারবোর্ড + শিক্ষকের আজকের ড্যাশবোর্ড-এর জন্য)
- Student bootstrap → ওই ছাত্রের নিজের গত ৩৫ দিন (ক্যালেন্ডার ভিউ + স্ট্রিক গণনা-র জন্য)

এতে `RS.mem` shape-এ নতুন key যোগ হবে: `completions` (array)।

---

## `api.js`-এ পরিবর্তন

### ১. বিদ্যমান `Tasks` API ভাঙা ও পুনর্গঠন

বিদ্যমান `toggleStatus`, `markDailyDone`, `resetDailyForToday`, `markDone`, `isDailyDoneToday` — এগুলো বাদ দিয়ে নতুন clean API:

```javascript
const Tasks = {
  getAll() { return DB.get().tasks || []; },
  getForStudent(sid) { return this.getAll().filter(t => t.assignees && t.assignees[sid]); },
  add({ title, desc, deadline, type='onetime', assigneeIds }) { /* অপরিবর্তিত */ },
  delete(tid) { /* অপরিবর্তিত */ },

  // ── সম্পন্নতা (completions) ───────────────────────────────
  
  /** আজকের জন্য একক সম্পন্নতা toggle (ছাত্রের action) */
  markCompleted(tid, sid, { date=today(), status='done', note='' } = {}) {
    // Completions._upsert + task.assignees[sid] update (today only)
  },
  
  /** একক completion বাতিল */
  unmarkCompleted(tid, sid, date=today()) {
    // Completions._delete + reset task.assignees[sid] = 'pending'
  },
  
  /** নির্দিষ্ট তারিখে ছাত্র আমল সম্পন্ন করেছে কিনা */
  isCompleted(tid, sid, date=today()) {
    return Completions.find(tid, sid, date)?.status === 'done';
  },
  
  /** আজকের জন্য `assignees` status derive (completions থেকে) */
  getTodayStatus(task, sid) {
    // daily → completions থেকে check; onetime → completions একবার থাকলে 'done'
  },

  /** প্রতি দিন app init-এ call; সব daily task-এর assignees status completions থেকে recalculate */
  syncTodayFromCompletions() {
    // এটা বিদ্যমান resetDailyForToday-এর জায়গা নিবে
  },
  
  // ── অগ্রগতি গণনা (UI helpers) ──────────────────────────────
  
  /** শিক্ষকের ড্যাশবোর্ডের জন্য — আজকের সব আমল + প্রতিটিতে সব ছাত্রের status */
  getTodayOverview() {
    // [{ task, completed: [sid...], pending: [sid...], percent }]
  },
  
  /** ছাত্রের স্ট্রিক গণনা (একটা task-এর জন্য বা সব task-এ গড়) */
  getStreak(sid, tid=null) {
    // গতকাল থেকে পেছনে যাও যতদিন continuous done পাও
    // returns { current, longest }
  },
  
  /** ছাত্রের progress রিং-এর জন্য (আজ/সপ্তাহ/মাস) */
  getProgressSummary(sid) {
    // { today: {done, total, percent}, week: {...}, month: {...} }
  },
  
  /** শিক্ষকের লিডারবোর্ডের জন্য (সাপ্তাহিক/মাসিক) */
  getLeaderboard(period='week') {
    // [{ sid, name, done, total, percent, streak }] sorted by percent
  },
  
  /** ক্যালেন্ডার গ্রিড-এর জন্য — একজন ছাত্রের নির্দিষ্ট মাসে প্রতি দিনের status */
  getCalendarData(sid, year, month) {
    // { 'YYYY-MM-DD': 'done'|'partial'|'miss' }
  },
  
  /** বিদ্যমান `overallStatus` রাখো — completions-based পুনর্লিখন */
  overallStatus(task) { /* updated logic */ },
  
  /** বিদ্যমান `pendingCount` রাখো — completions-based পুনর্লিখন */
  pendingCount(sid=null) { /* updated logic */ },
};
```

### ২. নতুন private `Completions` submodule

`api.js`-এর ভেতরে (Tasks-এর কাছাকাছি):

```javascript
const Completions = {
  _all() {
    if (_useRemote) return RS.mem.completions || (RS.mem.completions = []);
    try { return JSON.parse(localStorage.getItem('madrasa_completions') || '[]'); }
    catch { return []; }
  },
  _save(list) {
    if (_useRemote) {
      RS.mem.completions = list;
      // scheduled individual upserts via RS.scheduleCompletion(id) — not bulk
    } else {
      localStorage.setItem('madrasa_completions', JSON.stringify(list));
    }
  },
  find(tid, sid, date) {
    return this._all().find(c => c.task_id===tid && c.student_id===sid && c.date===date);
  },
  _upsert({ task_id, student_id, date, status, note='' }) {
    const list = this._all();
    const existing = list.findIndex(c => c.task_id===task_id && c.student_id===student_id && c.date===date);
    const row = {
      id: existing >= 0 ? list[existing].id : uid('tc'),
      task_id, student_id, date, status,
      completed_at: new Date().toISOString(),
      note,
      created_at: existing >= 0 ? list[existing].created_at : new Date().toISOString(),
    };
    if (existing >= 0) list[existing] = row; else list.push(row);
    this._save(list);
    if (_useRemote && RS.upsertCompletionRemote) RS.upsertCompletionRemote(row);
    return row;
  },
  _delete(tid, sid, date) {
    const list = this._all().filter(c => !(c.task_id===tid && c.student_id===sid && c.date===date));
    this._save(list);
    if (_useRemote && RS.deleteCompletionRemote) RS.deleteCompletionRemote(tid, sid, date);
  },
  getForStudent(sid, from=null, to=null) {
    let list = this._all().filter(c => c.student_id===sid);
    if (from) list = list.filter(c => c.date >= from);
    if (to) list = list.filter(c => c.date <= to);
    return list;
  },
  getForDate(date) {
    return this._all().filter(c => c.date === date);
  },
};
```

### ৩. `clearAllRelatedData(sid)`-এ যোগ

ছাত্রের সব completions মুছতে হবে:
```javascript
// Inside Students.clearAllRelatedData(sid)
const comps = Completions._all().filter(c => c.student_id !== sid);
Completions._save(comps);
// remote: CASCADE will handle via DB, but mem needs update
```

### ৪. `DB.exportJSON` / `importJSON`-এ completions যোগ

ব্যাকআপে থাকতে হবে যাতে restore করলে ইতিহাস ফেরত আসে।

### ৫. `api.js` সীমা ছাড়িয়ে গেলে

`api.js` 800 লাইনের সীমা কাছাকাছি। নতুন Completions + Tasks helpers এর মোট ~150-200 লাইন যোগ হবে। যদি `api.js` 800 ছাড়িয়ে যায়, তাহলে `api-amal.js` নামে নতুন ফাইল তৈরি করো যেখানে Completions + Tasks-এর helpers থাকবে। `api.js`-এ শুধু thin wrappers (`API.Tasks.getStreak` → `ApiAmal.getStreak`)। Load order: `api-amal.js` before `api.js`।

---

## `remote-sync.js` ও `remote-sync-write.js`-এ পরিবর্তন

### `remote-sync-write.js`-এ নতুন method:
```javascript
// সার্ভারে completion upsert
upsertCompletionRemote(row) {
  return supabaseClient.rpc('madrasa_rel_upsert_completion', {
    p_pin: _pin,
    p_id: row.id,
    p_task_id: row.task_id,
    p_student_id: row.student_id,
    p_date: row.date,
    p_status: row.status,
    p_completed_at: row.completed_at,
    p_note: row.note || '',
  });
},

deleteCompletionRemote(tid, sid, date) {
  return supabaseClient.rpc('madrasa_rel_delete_completion', {
    p_pin: _pin, p_task_id: tid, p_student_id: sid, p_date: date,
  });
},
```

### `remote-sync.js`-এ পরিবর্তন:
- Bootstrap assembly-তে `completions` শোষণ (teacher ও student উভয় bootstrap)
- `RS.mem.completions` initialize
- Realtime subscription channel-এ `task_completions` table যোগ (postgres_changes)
- `pullRemoteSnapshot`-এ completions refresh

---

## UI — `teacher.html`-এ পরিবর্তন

বিদ্যমান Tasks tab কে দু'ভাগে ভাগ করো: একটা হলো আমল তৈরি/তালিকা (বর্তমান), আরেকটা হলো নতুন **আমল ড্যাশবোর্ড**।

### দুটো option:

**বিকল্প A (পছন্দের):** বিদ্যমান Tasks tab-এ একটা sub-tab bar যোগ করো: "তালিকা" | "সারসংক্ষেপ" | "ছাত্রভিত্তিক"।

**বিকল্প B:** Tasks tab-এর উপরে একটা "📊 ড্যাশবোর্ড দেখুন" বাটন যেটা modal খুলে।

### সারসংক্ষেপ ভিউ (প্রোটোটাইপের t-overview অনুসরণ করো):

- উপরে ৩টা summary card (আজকের হার %, বাকি সংখ্যা, অনুপস্থিত সংখ্যা)
- তারিখ navigation (◀ গতকাল | আজ | আগামীকাল ▶)
- Filter chips: সব / দৈনিক / একবার
- প্রতিটা আমলের জন্য `.amal-card`:
  - শিরোনাম + type badge
  - progress bar (সম্পন্ন সংখ্যা / মোট assigned)
  - নিচে horizontal scroll strip ছাত্রদের avatar (সবুজ ✓ / কমলা / লাল dot সহ)
  - footer-এ "সর্বোচ্চ ধারাবাহিকতা: X (Y দিন)" + "বিস্তারিত →"

### ছাত্রভিত্তিক ভিউ (প্রোটোটাইপের t-students অনুসরণ):

- Period filter: এই সপ্তাহ / এই মাস / সর্বকালীন
- `.leaderboard-item` cards (sorted by percent):
  - র‍্যাঙ্ক (১ = গোল্ড, ২ = সিলভার, ৩ = ব্রোঞ্জ)
  - avatar + নাম + meta
  - percent + 🔥 streak
- ক্লিক করলে নিচে expand হবে `.stu-detail` — গত ৭ দিনের সাপ্তাহিক গ্রিড + আজকের আমল তালিকা

---

## UI — `student.html`-এ পরিবর্তন

বিদ্যমান "টাস্ক" ট্যাবকে "আমল" নাম দাও। তিনটা sub-tab যোগ করো: "আজ" | "রিপোর্ট" | "ইতিহাস"।

**প্রথম ধাপে** "রিপোর্ট" ট্যাব বাদ থাকছে (দ্বিতীয় ধাপে)। তাই এখন দুটো sub-tab: **আজ | ইতিহাস**।

### আজ ভিউ (প্রোটোটাইপের s-today অনুসরণ):

- উপরে gradient summary strip: streak badge (বৃত্তে বড় সংখ্যা) + সালাম + "X / Y আমল সম্পন্ন"
- `.s-progress-ring` strip: আজ / সপ্তাহ / মাস — conic-gradient দিয়ে percent ring
- `.s-amal-card` list (বিদ্যমান দৈনিক task-এর জায়গায়):
  - বড় circular check button (tap করলে toggle)
  - শিরোনাম + meta (সময় সম্পন্ন হলে, নইলে "বাকি")
  - streak indicator (🔥 N দিন ধারাবাহিক) — শুধু sparingly, প্রতি row-এ না

### ইতিহাস ভিউ (প্রোটোটাইপের s-history অনুসরণ):

- মাস selector (এপ্রিল / মার্চ / ফেব্রু)
- `.s-cal-grid` 7-column calendar:
  - প্রতিটা cell-এ তারিখ
  - সব আমল done → solid blue
  - কিছু done → light blue (partial)
  - কিছুই done না + task assigned ছিল → red tint (miss)
  - আজ → orange outline
  - Empty cells → gray
- নিচে legend + মাসিক সারসংক্ষেপ

---

## `style.css`-এ পরিবর্তন

প্রোটোটাইপের সব `.amal-*`, `.stu-*`, `.lb-*`, `.s-streak-*`, `.pr-*`, `.s-cal-*`, `.wk-*`, `.summary-*`, `.date-nav*`, `.filter-chip`, `.s-amal-*`, `.s-report-*` class definitions `style.css`-এ port করো।

**Important:** 500 লাইন সীমা। যদি বর্তমান `style.css` 400+ লাইন হয়, amal-related styles আলাদা ফাইল `amal.css`-এ রাখো এবং `teacher.html` / `student.html`-এ `style.css`-এর পরে load করো।

---

## Migration & Backfill Strategy

বিদ্যমান ব্যবহারকারীদের জন্য:

1. নতুন migration deploy করো (012, 013)
2. `api.js` deploy করো — `RS.mem.completions = []` initialize হবে
3. বিদ্যমান task-এর `assignees[sid] === 'done'` state → আজকের `task_completions` row-এ convert (one-time script বা app init-এ auto)
4. বিদ্যমান task-এর `completedBy[sid] = { date, time }` → `task_completions` row-এ convert (historical data যা আছে)

**Backfill script** (optional — যদি বিদ্যমান `completedBy` data রাখতে চাও):
```javascript
// api.js-এ এক-বার চলবে; flag দিয়ে track করো
function backfillCompletionsFromCompletedBy() {
  const db = DB.get();
  (db.tasks || []).forEach(t => {
    Object.entries(t.completedBy || {}).forEach(([sid, info]) => {
      if (info?.date) {
        Completions._upsert({
          task_id: t.id, student_id: sid, date: info.date,
          status: 'done', note: '(backfilled)'
        });
      }
    });
  });
  localStorage.setItem('amal_backfill_done', '1');
}
```

---

## Service Worker

`sw.js`:
- `CACHE` version: `waqful-full-v20` → `v21`
- যদি `amal.css` বা `api-amal.js` যোগ হয়, `LOCAL_SHELL`-এ যোগ করো

---

## Testing Checklist

Claude Code কাজ শেষ করার পর যাচাই করবে:

**Local mode (supabase-config.js ছাড়া):**
- [ ] আমল mark done → localStorage-এ `madrasa_completions` key-তে row যোগ
- [ ] পরদিন খুললে আজকের আমল আবার pending (completion row গতদিনের)
- [ ] ইতিহাস ট্যাবে গতদিনের cell সবুজ
- [ ] স্ট্রিক সঠিক গণনা
- [ ] শিক্ষকের ড্যাশবোর্ড সব ছাত্র সঠিক স্ট্যাটাস দেখায়
- [ ] `clearAllRelatedData(sid)` সব completions মুছে
- [ ] Backup export/import ইতিহাস সহ কাজ করে

**Remote mode:**
- [ ] নতুন RPC কাজ করছে (SQL Editor-এ পরীক্ষা)
- [ ] RLS direct REST block করছে
- [ ] Realtime subscription-এ অন্য device-এ update reflect হয়
- [ ] Bootstrap-এ completions load হয়

**Edge cases:**
- [ ] একই মিনিটে একাধিক click (debounce)
- [ ] Offline → online হলে pending completions sync হয়
- [ ] ছাত্র delete করলে CASCADE এ সব completions মোছে

---

## পরিবর্তনের সারসংক্ষেপ (শুরু করার আগে user-কে জানাও)

Claude Code-কে বলা হলো:
- **Create:** `012_task_completions.sql`, `013_task_completions_rpc.sql`, সম্ভবত `api-amal.js` ও `amal.css`
- **Modify:** `api.js`, `remote-sync.js`, `remote-sync-write.js`, `teacher.html`, `student.html`, `style.css`, `sw.js`, `CLAUDE.md` (migration list + cache version + নতুন tables list update)
- **Do NOT commit** — user নিজে stage/commit করবে
- **Do NOT run destructive SQL** (DELETE/DROP/TRUNCATE) user-এর explicit approval ছাড়া

---

## বাস্তবায়ন ক্রম (Suggested order)

১. SQL migrations (012, 013) লেখো এবং user-কে দেখাও — user manual-ভাবে SQL Editor-এ run করবে

২. `api.js`-এ `Completions` submodule + `Tasks` পুনর্লিখন (local-only first, remote later)

৩. `remote-sync.js` / `remote-sync-write.js` update

৪. Bootstrap RPCs update (user-কে SQL দেখাও)

৫. `teacher.html`-এ সারসংক্ষেপ sub-tab + UI

৬. `student.html`-এ আমল ট্যাব redesign + ক্যালেন্ডার

৭. `style.css` / `amal.css` আপডেট

৮. `sw.js` cache bump

৯. `CLAUDE.md` self-update

১০. প্রতি ধাপের শেষে change summary user-কে দাও।

---

## রেফারেন্স

ভিজ্যুয়াল চূড়ান্ত রেফারেন্স: `amal-prototype.html` — সব রঙ, layout, spacing, class-name অনুসরণ করো।
