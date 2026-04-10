# Waqful Madinah — Relational Schema Migration Guide
## JSON Blob → Proper PostgreSQL Tables

> **এই document Claude Code-এর জন্য।** ধাপে ধাপে পড়ো এবং প্রতিটা ধাপ শেষ করে নিশ্চিত হও।

---

## ০. শুরু করার আগে — নতুন Branch তৈরি করো

```bash
git checkout -b feature/relational-schema
```

**মূল নিয়ম:** এই পুরো migration `feature/relational-schema` branch-এ হবে। `main` branch-এ কোনো পরিবর্তন করবে না। যেকোনো সমস্যায় `git checkout main` করলেই পুরনো অবস্থায় ফেরা যাবে।

---

## ১. বর্তমান অবস্থার সারাংশ

### এখন যা আছে (`app_kv` table, key-value blob):

| KV Key | বিষয়বস্তু |
|---|---|
| `core` | `{ teacher, students[], chats{sid: msg[]}, tasks[] }` |
| `goals` | `{ sid: goal[] }` |
| `exams` | `{ quizzes[], submissions[] }` |
| `docs_meta` | `[{ id, studentId, fileName, storage_path, ... }]` |
| `academic` | `{ sid: record[] }` |
| `tnotes` | `{ sid: note[] }` |
| `teacher_pin` | `{ pin: "1234" }` |
| `pwa_push_teacher` | Web Push subscription object |
| `pwa_push_student_*` | Web Push subscription per student |

### লক্ষ্য — আলাদা relational tables:

```
madrasa_config         → teacher info + teacher PIN
students               → প্রতিটা ছাত্র আলাদা row
messages               → প্রতিটা message আলাদা row
tasks                  → প্রতিটা task আলাদা row
task_assignments       → task ↔ student অ্যাসাইনমেন্ট
goals                  → প্রতিটা goal আলাদা row
quizzes                → প্রতিটা quiz আলাদা row
quiz_questions         → প্রতিটা question আলাদা row
quiz_submissions       → প্রতিটা submission আলাদা row
documents              → প্রতিটা document metadata আলাদা row
academic_history       → প্রতিটা academic record আলাদা row
teacher_notes          → প্রতিটা note আলাদা row
pwa_subscriptions      → Web Push subscriptions (app_kv থেকে এখানে)
```

---

## ২. কোন feature কোথায় যাবে — সম্পূর্ণ ম্যাপিং

### ✅ অপরিবর্তিত থাকবে (কোনো কাজ নেই)
- `sw.js` — Service Worker, PWA cache
- `pwa-notify.js` — foreground notification logic
- `manifest.webmanifest`
- `style.css`
- `teacher.html` এবং `student.html` — UI সম্পূর্ণ অপরিবর্তিত
- `index.html`
- `vercel.json`
- `package.json`
- Supabase Storage bucket `waqf-files` — ফাইলের bytes এখানেই থাকবে
- VAPID keys, Edge Function `notify-kv-push`

### ⚠️ পরিবর্তিত হবে
- `supabase/` folder — নতুন migration SQL files যোগ হবে
- `remote-sync.js` — সম্পূর্ণ নতুন লেখা (KV blob বদলে table operations)
- `api.js` — প্রতিটা module আপডেট

### 🔴 বিশেষ সতর্কতা — Web Push subscriptions
বর্তমানে `app_kv` table-এ `pwa_push_teacher` এবং `pwa_push_student_*` keys হিসেবে আছে। Edge Function `notify-kv-push` এই table-এর Webhook থেকে trigger হয়। নতুনতে push subscriptions আলাদা `pwa_subscriptions` table-এ যাবে, তাই **Edge Function এবং Database Webhook আপডেট করতে হবে।**

---

## ৩. SQL Migration Files

### ফাইল: `supabase/006_relational_tables.sql`

এই file তৈরি করো। নিচের সব tables, indexes এবং RLS policies যোগ করো:

```sql
-- ══════════════════════════════════════════════
-- 006_relational_tables.sql
-- JSON blob → relational schema migration
-- ══════════════════════════════════════════════

-- ── madrasa_config ────────────────────────────
-- Teacher info + teacher PIN (একটাই row থাকবে সবসময়)
CREATE TABLE IF NOT EXISTS public.madrasa_config (
  id          text PRIMARY KEY DEFAULT 'singleton',
  teacher_name text NOT NULL DEFAULT '',
  madrasa_name text NOT NULL DEFAULT 'Waqful Madinah',
  teacher_pin  text NOT NULL DEFAULT '1234',
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- ── students ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.students (
  id              text PRIMARY KEY,
  waqf_id         text UNIQUE NOT NULL,
  name            text NOT NULL,
  cls             text NOT NULL DEFAULT '',
  roll            text NOT NULL DEFAULT '',
  pin             text NOT NULL,
  color           text NOT NULL DEFAULT '#128C7E',
  note            text NOT NULL DEFAULT '',
  father_name     text NOT NULL DEFAULT '',
  father_occupation text NOT NULL DEFAULT '',
  contact         text NOT NULL DEFAULT '',
  district        text NOT NULL DEFAULT '',
  upazila         text NOT NULL DEFAULT '',
  blood_group     text NOT NULL DEFAULT '',
  enrollment_date date,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS students_pin_idx ON public.students(pin);

-- ── messages ──────────────────────────────────
-- role: 'out' = teacher→student, 'in' = student→teacher, '_bc' = broadcast
CREATE TABLE IF NOT EXISTS public.messages (
  id          text PRIMARY KEY,
  thread_id   text NOT NULL,  -- student.id অথবা '_bc' broadcast-এর জন্য
  role        text NOT NULL CHECK (role IN ('out', 'in')),
  type        text NOT NULL DEFAULT 'text',  -- 'text', 'doc', 'task', 'quiz'
  text        text NOT NULL DEFAULT '',
  extra       jsonb NOT NULL DEFAULT '{}',  -- fileName, fileType, docId, task{}, ইত্যাদি
  is_read     boolean NOT NULL DEFAULT false,
  sent_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_thread_idx ON public.messages(thread_id, sent_at);

-- ── tasks ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tasks (
  id          text PRIMARY KEY,
  title       text NOT NULL,
  description text NOT NULL DEFAULT '',
  type        text NOT NULL DEFAULT 'onetime' CHECK (type IN ('onetime', 'daily')),
  deadline    date,
  created_at  date NOT NULL DEFAULT CURRENT_DATE
);

-- ── task_assignments ──────────────────────────
-- প্রতিটা student-task জুটির জন্য একটা row
CREATE TABLE IF NOT EXISTS public.task_assignments (
  id          text PRIMARY KEY,
  task_id     text NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  student_id  text NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'late')),
  completed_date date,
  completed_time text,
  UNIQUE(task_id, student_id)
);
CREATE INDEX IF NOT EXISTS task_assignments_student_idx ON public.task_assignments(student_id);

-- ── goals ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.goals (
  id          text PRIMARY KEY,
  student_id  text NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  title       text NOT NULL,
  cat         text NOT NULL DEFAULT 'other',
  deadline    date,
  note        text NOT NULL DEFAULT '',
  done        boolean NOT NULL DEFAULT false,
  created_at  date NOT NULL DEFAULT CURRENT_DATE
);
CREATE INDEX IF NOT EXISTS goals_student_idx ON public.goals(student_id);

-- ── quizzes ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.quizzes (
  id            text PRIMARY KEY,
  title         text NOT NULL,
  subject       text NOT NULL DEFAULT '',
  description   text NOT NULL DEFAULT '',
  time_limit    integer NOT NULL DEFAULT 30,
  pass_percent  integer NOT NULL DEFAULT 60,
  deadline      date,
  created_at    date NOT NULL DEFAULT CURRENT_DATE
);

-- ── quiz_questions ────────────────────────────
CREATE TABLE IF NOT EXISTS public.quiz_questions (
  id          text PRIMARY KEY,
  quiz_id     text NOT NULL REFERENCES public.quizzes(id) ON DELETE CASCADE,
  sort_order  integer NOT NULL DEFAULT 0,
  type        text NOT NULL,
  text        text NOT NULL,
  options     jsonb NOT NULL DEFAULT '[]',
  correct_answer text,
  marks       integer NOT NULL DEFAULT 1,
  upload_instructions text
);
CREATE INDEX IF NOT EXISTS quiz_questions_quiz_idx ON public.quiz_questions(quiz_id, sort_order);

-- ── quiz_assignees ────────────────────────────
CREATE TABLE IF NOT EXISTS public.quiz_assignees (
  quiz_id     text NOT NULL REFERENCES public.quizzes(id) ON DELETE CASCADE,
  student_id  text NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  PRIMARY KEY (quiz_id, student_id)
);

-- ── quiz_submissions ──────────────────────────
CREATE TABLE IF NOT EXISTS public.quiz_submissions (
  id              text PRIMARY KEY,
  quiz_id         text NOT NULL REFERENCES public.quizzes(id) ON DELETE CASCADE,
  student_id      text NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  student_name    text NOT NULL DEFAULT '',
  answers         jsonb NOT NULL DEFAULT '{}',
  score           integer NOT NULL DEFAULT 0,
  total           integer NOT NULL DEFAULT 0,
  passed          boolean NOT NULL DEFAULT false,
  needs_manual_grade boolean NOT NULL DEFAULT false,
  submitted_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE(quiz_id, student_id)
);

-- ── documents ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.documents (
  id            text PRIMARY KEY,
  student_id    text NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  student_name  text NOT NULL DEFAULT '',
  file_name     text NOT NULL,
  file_type     text NOT NULL DEFAULT '',
  file_size     bigint NOT NULL DEFAULT 0,
  category      text NOT NULL DEFAULT 'general',
  note          text NOT NULL DEFAULT '',
  storage_path  text,
  file_url      text,
  is_read       boolean NOT NULL DEFAULT false,
  uploaded_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS documents_student_idx ON public.documents(student_id);

-- ── academic_history ──────────────────────────
CREATE TABLE IF NOT EXISTS public.academic_history (
  id          text PRIMARY KEY,
  student_id  text NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  year_class  text NOT NULL,
  grade       text NOT NULL,
  added_at    date NOT NULL DEFAULT CURRENT_DATE
);

-- ── teacher_notes ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.teacher_notes (
  id          text PRIMARY KEY,
  student_id  text NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  text        text NOT NULL,
  note_date   date NOT NULL DEFAULT CURRENT_DATE,
  note_time   text NOT NULL DEFAULT '',
  edited_at   date
);
CREATE INDEX IF NOT EXISTS teacher_notes_student_idx ON public.teacher_notes(student_id);

-- ── pwa_subscriptions ─────────────────────────
-- Web Push subscriptions (app_kv-এর pwa_push_* keys প্রতিস্থাপন)
CREATE TABLE IF NOT EXISTS public.pwa_subscriptions (
  id          text PRIMARY KEY,  -- 'teacher' অথবা student waqf_id
  role        text NOT NULL CHECK (role IN ('teacher', 'student')),
  subscription jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
```

---

### ফাইল: `supabase/007_relational_rls.sql`

RLS policies। **গুরুত্বপূর্ণ:** এই app-এ Supabase Auth ব্যবহার হয় না — PIN-based RPC দিয়ে auth হয়। তাই সব direct REST access বন্ধ রাখতে হবে, শুধু RPC দিয়ে access হবে।

```sql
-- ══════════════════════════════════════════════
-- 007_relational_rls.sql
-- সব নতুন table-এ RLS চালু, direct REST বন্ধ
-- ══════════════════════════════════════════════

ALTER TABLE public.madrasa_config     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.students           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_assignments   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goals              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quizzes            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_questions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_assignees     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_submissions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academic_history   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teacher_notes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pwa_subscriptions  ENABLE ROW LEVEL SECURITY;

-- সব table-এ anon direct access বন্ধ (RPC ছাড়া কিছু হবে না)
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'madrasa_config','students','messages','tasks','task_assignments',
    'goals','quizzes','quiz_questions','quiz_assignees','quiz_submissions',
    'documents','academic_history','teacher_notes','pwa_subscriptions'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS deny_all ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY deny_all ON public.%I FOR ALL TO anon USING (false)',
      t
    );
  END LOOP;
END;
$$;
```

---

### ফাইল: `supabase/008_relational_rpc.sql`

**এটা সবচেয়ে গুরুত্বপূর্ণ ফাইল।** বিদ্যমান `madrasa_teacher_bootstrap`, `madrasa_student_bootstrap` ইত্যাদি RPC-র relational version।

```sql
-- ══════════════════════════════════════════════
-- 008_relational_rpc.sql
-- PIN-gated RPC functions — relational version
-- ══════════════════════════════════════════════

-- Helper: teacher PIN verify
CREATE OR REPLACE FUNCTION private.verify_teacher_pin(p_pin text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.madrasa_config WHERE id = 'singleton' AND teacher_pin = p_pin
  );
END;
$$;

-- ── PUBLIC BRANDING (PIN ছাড়া) ────────────────
CREATE OR REPLACE FUNCTION public.madrasa_rel_public_branding()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_row public.madrasa_config%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.madrasa_config WHERE id = 'singleton';
  RETURN jsonb_build_object('madrasa', COALESCE(v_row.madrasa_name, 'Waqful Madinah'));
END;
$$;
GRANT EXECUTE ON FUNCTION public.madrasa_rel_public_branding() TO anon;

-- ── STUDENT LOCK HINTS (PIN ছাড়া) ─────────────
CREATE OR REPLACE FUNCTION public.madrasa_rel_student_lock_hints()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN (
    SELECT jsonb_agg(jsonb_build_object(
      'id', s.id,
      'waqfId', s.waqf_id,
      'name', s.name,
      'unreadCount', (
        SELECT COUNT(*) FROM public.messages m
        WHERE m.thread_id = s.id AND m.role = 'out' AND m.is_read = false
      )
    ))
    FROM public.students s
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.madrasa_rel_student_lock_hints() TO anon;

-- ── TEACHER BOOTSTRAP (PIN দিয়ে সব data) ──────
CREATE OR REPLACE FUNCTION public.madrasa_rel_teacher_bootstrap(p_teacher_pin text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_ok boolean;
BEGIN
  SELECT private.verify_teacher_pin(p_teacher_pin) INTO v_ok;
  IF NOT v_ok THEN RAISE EXCEPTION 'invalid_pin'; END IF;

  RETURN jsonb_build_object(
    'config', (SELECT row_to_json(c) FROM public.madrasa_config c WHERE id = 'singleton'),
    'students', (SELECT jsonb_agg(row_to_json(s)) FROM public.students s ORDER BY s.waqf_id),
    'messages', (SELECT jsonb_agg(row_to_json(m)) FROM public.messages m ORDER BY m.sent_at),
    'tasks', (SELECT jsonb_agg(row_to_json(t)) FROM public.tasks t ORDER BY t.created_at),
    'task_assignments', (SELECT jsonb_agg(row_to_json(ta)) FROM public.task_assignments ta),
    'goals', (SELECT jsonb_agg(row_to_json(g)) FROM public.goals g),
    'quizzes', (SELECT jsonb_agg(row_to_json(q)) FROM public.quizzes q ORDER BY q.created_at),
    'quiz_questions', (SELECT jsonb_agg(row_to_json(qq)) FROM public.quiz_questions qq ORDER BY qq.quiz_id, qq.sort_order),
    'quiz_assignees', (SELECT jsonb_agg(row_to_json(qa)) FROM public.quiz_assignees qa),
    'quiz_submissions', (SELECT jsonb_agg(row_to_json(qs)) FROM public.quiz_submissions qs),
    'documents', (SELECT jsonb_agg(row_to_json(d)) FROM public.documents d ORDER BY d.uploaded_at DESC),
    'academic_history', (SELECT jsonb_agg(row_to_json(ah)) FROM public.academic_history ah),
    'teacher_notes', (SELECT jsonb_agg(row_to_json(tn)) FROM public.teacher_notes tn)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.madrasa_rel_teacher_bootstrap(text) TO anon;

-- ── STUDENT BOOTSTRAP (waqf_id + PIN দিয়ে নিজের data) ──
CREATE OR REPLACE FUNCTION public.madrasa_rel_student_bootstrap(p_waqf text, p_pin text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_student public.students%ROWTYPE;
BEGIN
  SELECT * INTO v_student FROM public.students
  WHERE waqf_id = p_waqf AND pin = p_pin;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_credentials'; END IF;

  RETURN jsonb_build_object(
    'student', row_to_json(v_student),
    'config', (SELECT jsonb_build_object('madrasa', madrasa_name, 'teacher_name', teacher_name)
               FROM public.madrasa_config WHERE id = 'singleton'),
    'messages', (
      SELECT jsonb_agg(row_to_json(m))
      FROM public.messages m
      WHERE m.thread_id = v_student.id OR m.thread_id = '_bc'
      ORDER BY m.sent_at
    ),
    'tasks', (
      SELECT jsonb_agg(jsonb_build_object(
        'task', row_to_json(t),
        'assignment', row_to_json(ta)
      ))
      FROM public.task_assignments ta
      JOIN public.tasks t ON t.id = ta.task_id
      WHERE ta.student_id = v_student.id
    ),
    'goals', (SELECT jsonb_agg(row_to_json(g)) FROM public.goals g WHERE g.student_id = v_student.id),
    'quizzes', (
      SELECT jsonb_agg(jsonb_build_object(
        'quiz', row_to_json(q),
        'questions', (SELECT jsonb_agg(row_to_json(qq)) FROM public.quiz_questions qq WHERE qq.quiz_id = q.id ORDER BY qq.sort_order),
        'submission', (SELECT row_to_json(qs) FROM public.quiz_submissions qs WHERE qs.quiz_id = q.id AND qs.student_id = v_student.id)
      ))
      FROM public.quiz_assignees qa
      JOIN public.quizzes q ON q.id = qa.quiz_id
      WHERE qa.student_id = v_student.id
    ),
    'documents', (SELECT jsonb_agg(row_to_json(d)) FROM public.documents d WHERE d.student_id = v_student.id ORDER BY d.uploaded_at DESC),
    'academic_history', (SELECT jsonb_agg(row_to_json(ah)) FROM public.academic_history ah WHERE ah.student_id = v_student.id)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.madrasa_rel_student_bootstrap(text, text) TO anon;

-- ── TEACHER SAVE: single-row upserts ──────────
-- প্রতিটা write operation-এর জন্য আলাদা RPC

-- Student upsert
CREATE OR REPLACE FUNCTION public.madrasa_rel_upsert_student(
  p_teacher_pin text, p_student jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT private.verify_teacher_pin(p_teacher_pin) THEN RAISE EXCEPTION 'invalid_pin'; END IF;
  INSERT INTO public.students (id, waqf_id, name, cls, roll, pin, color, note,
    father_name, father_occupation, contact, district, upazila, blood_group, enrollment_date)
  VALUES (
    p_student->>'id', p_student->>'waqf_id', p_student->>'name', p_student->>'cls',
    p_student->>'roll', p_student->>'pin', p_student->>'color', p_student->>'note',
    p_student->>'father_name', p_student->>'father_occupation', p_student->>'contact',
    p_student->>'district', p_student->>'upazila', p_student->>'blood_group',
    NULLIF(p_student->>'enrollment_date', '')::date
  )
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name, cls = EXCLUDED.cls, roll = EXCLUDED.roll,
    pin = EXCLUDED.pin, note = EXCLUDED.note,
    father_name = EXCLUDED.father_name, father_occupation = EXCLUDED.father_occupation,
    contact = EXCLUDED.contact, district = EXCLUDED.district,
    upazila = EXCLUDED.upazila, blood_group = EXCLUDED.blood_group,
    enrollment_date = EXCLUDED.enrollment_date;
  RETURN jsonb_build_object('ok', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.madrasa_rel_upsert_student(text, jsonb) TO anon;

-- Student delete
CREATE OR REPLACE FUNCTION public.madrasa_rel_delete_student(
  p_teacher_pin text, p_student_id text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT private.verify_teacher_pin(p_teacher_pin) THEN RAISE EXCEPTION 'invalid_pin'; END IF;
  -- CASCADE দিয়ে সব related data মুছে যাবে (messages, tasks, goals, documents ইত্যাদি)
  DELETE FROM public.students WHERE id = p_student_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.madrasa_rel_delete_student(text, text) TO anon;

-- Message insert
CREATE OR REPLACE FUNCTION public.madrasa_rel_insert_message(
  p_pin text, p_role text, p_message jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_ok boolean := false;
BEGIN
  IF p_role = 'teacher' THEN
    v_ok := private.verify_teacher_pin(p_pin);
  ELSE
    v_ok := EXISTS (
      SELECT 1 FROM public.students
      WHERE waqf_id = (p_message->>'thread_id_waqf') AND pin = p_pin
    );
  END IF;
  IF NOT v_ok THEN RAISE EXCEPTION 'invalid_pin'; END IF;

  INSERT INTO public.messages (id, thread_id, role, type, text, extra, is_read, sent_at)
  VALUES (
    p_message->>'id',
    p_message->>'thread_id',
    p_message->>'role',
    COALESCE(p_message->>'type', 'text'),
    COALESCE(p_message->>'text', ''),
    COALESCE((p_message->'extra')::jsonb, '{}'::jsonb),
    COALESCE((p_message->>'is_read')::boolean, false),
    COALESCE((p_message->>'sent_at')::timestamptz, now())
  );
  RETURN jsonb_build_object('ok', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.madrasa_rel_insert_message(text, text, jsonb) TO anon;

-- Mark messages read
CREATE OR REPLACE FUNCTION public.madrasa_rel_mark_messages_read(
  p_pin text, p_role text, p_thread_id text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_ok boolean := false;
BEGIN
  IF p_role = 'teacher' THEN
    v_ok := private.verify_teacher_pin(p_pin);
  ELSE
    v_ok := EXISTS (SELECT 1 FROM public.students WHERE id = p_thread_id AND pin = p_pin);
  END IF;
  IF NOT v_ok THEN RAISE EXCEPTION 'invalid_pin'; END IF;

  UPDATE public.messages SET is_read = true
  WHERE thread_id = p_thread_id
    AND role = (CASE WHEN p_role = 'teacher' THEN 'in' ELSE 'out' END);
  RETURN jsonb_build_object('ok', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.madrasa_rel_mark_messages_read(text, text, text) TO anon;

-- Task upsert (teacher only)
CREATE OR REPLACE FUNCTION public.madrasa_rel_upsert_task(
  p_teacher_pin text, p_task jsonb, p_assignee_ids jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_sid text;
BEGIN
  IF NOT private.verify_teacher_pin(p_teacher_pin) THEN RAISE EXCEPTION 'invalid_pin'; END IF;
  INSERT INTO public.tasks (id, title, description, type, deadline, created_at)
  VALUES (
    p_task->>'id', p_task->>'title', COALESCE(p_task->>'description', ''),
    COALESCE(p_task->>'type', 'onetime'), NULLIF(p_task->>'deadline', '')::date,
    COALESCE(NULLIF(p_task->>'created_at','')::date, CURRENT_DATE)
  )
  ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title, description = EXCLUDED.description,
    type = EXCLUDED.type, deadline = EXCLUDED.deadline;

  FOR v_sid IN SELECT jsonb_array_elements_text(p_assignee_ids) LOOP
    INSERT INTO public.task_assignments (id, task_id, student_id, status)
    VALUES (gen_random_uuid()::text, p_task->>'id', v_sid, 'pending')
    ON CONFLICT (task_id, student_id) DO NOTHING;
  END LOOP;
  RETURN jsonb_build_object('ok', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.madrasa_rel_upsert_task(text, jsonb, jsonb) TO anon;

-- Task assignment status update
CREATE OR REPLACE FUNCTION public.madrasa_rel_update_task_status(
  p_pin text, p_role text, p_task_id text, p_student_id text, p_status text,
  p_completed_date text DEFAULT NULL, p_completed_time text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_ok boolean := false;
BEGIN
  IF p_role = 'teacher' THEN
    v_ok := private.verify_teacher_pin(p_pin);
  ELSE
    v_ok := EXISTS (SELECT 1 FROM public.students WHERE id = p_student_id AND pin = p_pin);
  END IF;
  IF NOT v_ok THEN RAISE EXCEPTION 'invalid_pin'; END IF;

  UPDATE public.task_assignments
  SET status = p_status,
      completed_date = NULLIF(p_completed_date, '')::date,
      completed_time = p_completed_time
  WHERE task_id = p_task_id AND student_id = p_student_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.madrasa_rel_update_task_status(text, text, text, text, text, text, text) TO anon;

-- Goal upsert
CREATE OR REPLACE FUNCTION public.madrasa_rel_upsert_goal(
  p_pin text, p_student_id text, p_goal jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_ok boolean;
BEGIN
  v_ok := EXISTS (SELECT 1 FROM public.students WHERE id = p_student_id AND pin = p_pin);
  IF NOT v_ok THEN RAISE EXCEPTION 'invalid_pin'; END IF;

  INSERT INTO public.goals (id, student_id, title, cat, deadline, note, done, created_at)
  VALUES (
    p_goal->>'id', p_student_id, p_goal->>'title',
    COALESCE(p_goal->>'cat', 'other'),
    NULLIF(p_goal->>'deadline', '')::date,
    COALESCE(p_goal->>'note', ''),
    COALESCE((p_goal->>'done')::boolean, false),
    COALESCE(NULLIF(p_goal->>'created_at','')::date, CURRENT_DATE)
  )
  ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title, cat = EXCLUDED.cat,
    deadline = EXCLUDED.deadline, note = EXCLUDED.note, done = EXCLUDED.done;
  RETURN jsonb_build_object('ok', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.madrasa_rel_upsert_goal(text, text, jsonb) TO anon;

-- Quiz upsert (teacher only)
CREATE OR REPLACE FUNCTION public.madrasa_rel_upsert_quiz(
  p_teacher_pin text, p_quiz jsonb, p_questions jsonb, p_assignee_ids jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_q jsonb; v_i integer := 0; v_sid text;
BEGIN
  IF NOT private.verify_teacher_pin(p_teacher_pin) THEN RAISE EXCEPTION 'invalid_pin'; END IF;

  INSERT INTO public.quizzes (id, title, subject, description, time_limit, pass_percent, deadline, created_at)
  VALUES (
    p_quiz->>'id', p_quiz->>'title', COALESCE(p_quiz->>'subject', ''),
    COALESCE(p_quiz->>'description', ''), COALESCE((p_quiz->>'time_limit')::integer, 30),
    COALESCE((p_quiz->>'pass_percent')::integer, 60),
    NULLIF(p_quiz->>'deadline', '')::date,
    COALESCE(NULLIF(p_quiz->>'created_at','')::date, CURRENT_DATE)
  )
  ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title, subject = EXCLUDED.subject,
    description = EXCLUDED.description, time_limit = EXCLUDED.time_limit,
    pass_percent = EXCLUDED.pass_percent, deadline = EXCLUDED.deadline;

  DELETE FROM public.quiz_questions WHERE quiz_id = p_quiz->>'id';
  FOR v_q IN SELECT * FROM jsonb_array_elements(p_questions) LOOP
    INSERT INTO public.quiz_questions (id, quiz_id, sort_order, type, text, options, correct_answer, marks, upload_instructions)
    VALUES (
      v_q->>'id', p_quiz->>'id', v_i,
      v_q->>'type', v_q->>'text',
      COALESCE((v_q->'options')::jsonb, '[]'::jsonb),
      v_q->>'correct_answer', COALESCE((v_q->>'marks')::integer, 1),
      v_q->>'upload_instructions'
    );
    v_i := v_i + 1;
  END LOOP;

  DELETE FROM public.quiz_assignees WHERE quiz_id = p_quiz->>'id';
  FOR v_sid IN SELECT jsonb_array_elements_text(p_assignee_ids) LOOP
    INSERT INTO public.quiz_assignees (quiz_id, student_id) VALUES (p_quiz->>'id', v_sid)
    ON CONFLICT DO NOTHING;
  END LOOP;
  RETURN jsonb_build_object('ok', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.madrasa_rel_upsert_quiz(text, jsonb, jsonb, jsonb) TO anon;

-- Quiz submission
CREATE OR REPLACE FUNCTION public.madrasa_rel_submit_quiz(
  p_student_pin text, p_student_id text, p_submission jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.students WHERE id = p_student_id AND pin = p_student_pin) THEN
    RAISE EXCEPTION 'invalid_pin';
  END IF;
  INSERT INTO public.quiz_submissions (id, quiz_id, student_id, student_name, answers, score, total, passed, needs_manual_grade, submitted_at)
  VALUES (
    p_submission->>'id', p_submission->>'quiz_id', p_student_id,
    COALESCE(p_submission->>'student_name', ''),
    COALESCE((p_submission->'answers')::jsonb, '{}'::jsonb),
    COALESCE((p_submission->>'score')::integer, 0),
    COALESCE((p_submission->>'total')::integer, 0),
    COALESCE((p_submission->>'passed')::boolean, false),
    COALESCE((p_submission->>'needs_manual_grade')::boolean, false),
    COALESCE((p_submission->>'submitted_at')::timestamptz, now())
  )
  ON CONFLICT (quiz_id, student_id) DO UPDATE SET
    answers = EXCLUDED.answers, score = EXCLUDED.score,
    total = EXCLUDED.total, passed = EXCLUDED.passed,
    needs_manual_grade = EXCLUDED.needs_manual_grade, submitted_at = EXCLUDED.submitted_at;
  RETURN jsonb_build_object('ok', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.madrasa_rel_submit_quiz(text, text, jsonb) TO anon;

-- Document insert
CREATE OR REPLACE FUNCTION public.madrasa_rel_insert_document(
  p_pin text, p_role text, p_doc jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_ok boolean := false;
BEGIN
  IF p_role = 'teacher' THEN
    v_ok := private.verify_teacher_pin(p_pin);
  ELSE
    v_ok := EXISTS (SELECT 1 FROM public.students WHERE id = (p_doc->>'student_id') AND pin = p_pin);
  END IF;
  IF NOT v_ok THEN RAISE EXCEPTION 'invalid_pin'; END IF;

  INSERT INTO public.documents (id, student_id, student_name, file_name, file_type, file_size, category, note, storage_path, file_url, is_read, uploaded_at)
  VALUES (
    p_doc->>'id', p_doc->>'student_id', COALESCE(p_doc->>'student_name', ''),
    p_doc->>'file_name', COALESCE(p_doc->>'file_type', ''),
    COALESCE((p_doc->>'file_size')::bigint, 0),
    COALESCE(p_doc->>'category', 'general'), COALESCE(p_doc->>'note', ''),
    p_doc->>'storage_path', p_doc->>'file_url',
    COALESCE((p_doc->>'is_read')::boolean, false),
    COALESCE((p_doc->>'uploaded_at')::timestamptz, now())
  )
  ON CONFLICT (id) DO UPDATE SET
    file_url = EXCLUDED.file_url, is_read = EXCLUDED.is_read;
  RETURN jsonb_build_object('ok', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.madrasa_rel_insert_document(text, text, jsonb) TO anon;

-- Teacher PIN update
CREATE OR REPLACE FUNCTION public.madrasa_rel_update_teacher_pin(
  p_old_pin text, p_new_pin text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT private.verify_teacher_pin(p_old_pin) THEN RAISE EXCEPTION 'invalid_pin'; END IF;
  UPDATE public.madrasa_config SET teacher_pin = p_new_pin, updated_at = now() WHERE id = 'singleton';
  RETURN jsonb_build_object('ok', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.madrasa_rel_update_teacher_pin(text, text) TO anon;

-- PWA subscription save
CREATE OR REPLACE FUNCTION public.madrasa_rel_save_pwa_subscription(
  p_id text, p_role text, p_subscription jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.pwa_subscriptions (id, role, subscription, updated_at)
  VALUES (p_id, p_role, p_subscription, now())
  ON CONFLICT (id) DO UPDATE SET subscription = EXCLUDED.subscription, updated_at = now();
  RETURN jsonb_build_object('ok', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.madrasa_rel_save_pwa_subscription(text, text, jsonb) TO anon;
```

---

### ফাইল: `supabase/009_data_migration.sql`

**এটা একবারই চালাতে হবে।** বিদ্যমান `app_kv` data নতুন tables-এ copy করবে।

```sql
-- ══════════════════════════════════════════════
-- 009_data_migration.sql
-- app_kv JSON blob → relational tables
-- একবারই চালাও, তারপর আর দরকার নেই
-- ══════════════════════════════════════════════

DO $$
DECLARE
  v_core jsonb;
  v_goals jsonb;
  v_exams jsonb;
  v_docs jsonb;
  v_academic jsonb;
  v_tnotes jsonb;
  v_teacher_pin jsonb;
  v_student jsonb;
  v_msg jsonb;
  v_task jsonb;
  v_goal jsonb;
  v_quiz jsonb;
  v_question jsonb;
  v_submission jsonb;
  v_doc jsonb;
  v_sid text;
  v_i integer;
BEGIN
  -- app_kv থেকে সব data পড়ো
  SELECT value INTO v_core FROM public.app_kv WHERE key = 'core';
  SELECT value INTO v_goals FROM public.app_kv WHERE key = 'goals';
  SELECT value INTO v_exams FROM public.app_kv WHERE key = 'exams';
  SELECT value INTO v_docs FROM public.app_kv WHERE key = 'docs_meta';
  SELECT value INTO v_academic FROM public.app_kv WHERE key = 'academic';
  SELECT value INTO v_tnotes FROM public.app_kv WHERE key = 'tnotes';
  SELECT value INTO v_teacher_pin FROM public.app_kv WHERE key = 'teacher_pin';

  IF v_core IS NULL THEN
    RAISE NOTICE 'app_kv "core" নেই — migration skip';
    RETURN;
  END IF;

  -- madrasa_config
  INSERT INTO public.madrasa_config (id, teacher_name, madrasa_name, teacher_pin)
  VALUES (
    'singleton',
    COALESCE(v_core->'teacher'->>'name', ''),
    COALESCE(v_core->'teacher'->>'madrasa', 'Waqful Madinah'),
    COALESCE(v_teacher_pin->>'pin', '1234')
  )
  ON CONFLICT (id) DO UPDATE SET
    teacher_name = EXCLUDED.teacher_name,
    madrasa_name = EXCLUDED.madrasa_name,
    teacher_pin = EXCLUDED.teacher_pin;

  -- students
  FOR v_student IN SELECT * FROM jsonb_array_elements(COALESCE(v_core->'students', '[]')) LOOP
    INSERT INTO public.students (id, waqf_id, name, cls, roll, pin, color, note,
      father_name, father_occupation, contact, district, upazila, blood_group, enrollment_date)
    VALUES (
      v_student->>'id', v_student->>'waqfId', v_student->>'name',
      COALESCE(v_student->>'cls', ''), COALESCE(v_student->>'roll', ''),
      v_student->>'pin', COALESCE(v_student->>'color', '#128C7E'),
      COALESCE(v_student->>'note', ''), COALESCE(v_student->>'fatherName', ''),
      COALESCE(v_student->>'fatherOccupation', ''), COALESCE(v_student->>'contact', ''),
      COALESCE(v_student->>'district', ''), COALESCE(v_student->>'upazila', ''),
      COALESCE(v_student->>'bloodGroup', ''),
      NULLIF(v_student->>'enrollmentDate', '')::date
    )
    ON CONFLICT (id) DO NOTHING;
  END LOOP;

  -- messages (chats)
  FOR v_sid IN SELECT jsonb_object_keys(COALESCE(v_core->'chats', '{}')) LOOP
    FOR v_msg IN SELECT * FROM jsonb_array_elements(COALESCE((v_core->'chats')->v_sid, '[]')) LOOP
      INSERT INTO public.messages (id, thread_id, role, type, text, extra, is_read, sent_at)
      VALUES (
        v_msg->>'id', v_sid,
        COALESCE(v_msg->>'role', 'out'),
        COALESCE(v_msg->>'type', 'text'),
        COALESCE(v_msg->>'text', ''),
        (v_msg - 'id' - 'role' - 'type' - 'text' - 'read' - 'time'),
        COALESCE((v_msg->>'read')::boolean, false),
        now()
      )
      ON CONFLICT (id) DO NOTHING;
    END LOOP;
  END LOOP;

  -- tasks + task_assignments
  FOR v_task IN SELECT * FROM jsonb_array_elements(COALESCE(v_core->'tasks', '[]')) LOOP
    INSERT INTO public.tasks (id, title, description, type, deadline, created_at)
    VALUES (
      v_task->>'id', v_task->>'title', COALESCE(v_task->>'desc', ''),
      COALESCE(v_task->>'type', 'onetime'),
      NULLIF(v_task->>'deadline', '')::date,
      COALESCE(NULLIF(v_task->>'created','')::date, CURRENT_DATE)
    )
    ON CONFLICT (id) DO NOTHING;

    FOR v_sid IN SELECT jsonb_object_keys(COALESCE(v_task->'assignees', '{}')) LOOP
      INSERT INTO public.task_assignments (id, task_id, student_id, status, completed_date, completed_time)
      VALUES (
        gen_random_uuid()::text, v_task->>'id', v_sid,
        COALESCE((v_task->'assignees')->>v_sid, 'pending'),
        NULLIF((v_task->'completedBy'->v_sid)->>'date', '')::date,
        (v_task->'completedBy'->v_sid)->>'time'
      )
      ON CONFLICT (task_id, student_id) DO NOTHING;
    END LOOP;
  END LOOP;

  -- goals
  IF v_goals IS NOT NULL THEN
    FOR v_sid IN SELECT jsonb_object_keys(v_goals) LOOP
      FOR v_goal IN SELECT * FROM jsonb_array_elements(COALESCE(v_goals->v_sid, '[]')) LOOP
        INSERT INTO public.goals (id, student_id, title, cat, deadline, note, done, created_at)
        VALUES (
          v_goal->>'id', v_sid, v_goal->>'title',
          COALESCE(v_goal->>'cat', 'other'),
          NULLIF(v_goal->>'deadline', '')::date,
          COALESCE(v_goal->>'note', ''),
          COALESCE((v_goal->>'done')::boolean, false),
          COALESCE(NULLIF(v_goal->>'created','')::date, CURRENT_DATE)
        )
        ON CONFLICT (id) DO NOTHING;
      END LOOP;
    END LOOP;
  END IF;

  -- quizzes + questions + assignees + submissions
  IF v_exams IS NOT NULL THEN
    v_i := 0;
    FOR v_quiz IN SELECT * FROM jsonb_array_elements(COALESCE(v_exams->'quizzes', '[]')) LOOP
      INSERT INTO public.quizzes (id, title, subject, description, time_limit, pass_percent, deadline, created_at)
      VALUES (
        v_quiz->>'id', v_quiz->>'title', COALESCE(v_quiz->>'subject', ''),
        COALESCE(v_quiz->>'desc', ''), COALESCE((v_quiz->>'timeLimit')::integer, 30),
        COALESCE((v_quiz->>'passPercent')::integer, 60),
        NULLIF(v_quiz->>'deadline', '')::date,
        COALESCE(NULLIF(v_quiz->>'created','')::date, CURRENT_DATE)
      )
      ON CONFLICT (id) DO NOTHING;

      v_i := 0;
      FOR v_question IN SELECT * FROM jsonb_array_elements(COALESCE(v_quiz->'questions', '[]')) LOOP
        INSERT INTO public.quiz_questions (id, quiz_id, sort_order, type, text, options, correct_answer, marks)
        VALUES (
          v_question->>'id', v_quiz->>'id', v_i,
          v_question->>'type', v_question->>'text',
          COALESCE((v_question->'options')::jsonb, '[]'::jsonb),
          v_question->>'correctAnswer', COALESCE((v_question->>'marks')::integer, 1)
        )
        ON CONFLICT (id) DO NOTHING;
        v_i := v_i + 1;
      END LOOP;

      FOR v_sid IN SELECT jsonb_array_elements_text(COALESCE(v_quiz->'assigneeIds', '[]')) LOOP
        INSERT INTO public.quiz_assignees (quiz_id, student_id) VALUES (v_quiz->>'id', v_sid)
        ON CONFLICT DO NOTHING;
      END LOOP;
    END LOOP;

    FOR v_submission IN SELECT * FROM jsonb_array_elements(COALESCE(v_exams->'submissions', '[]')) LOOP
      INSERT INTO public.quiz_submissions (id, quiz_id, student_id, student_name, answers, score, total, passed, needs_manual_grade)
      VALUES (
        v_submission->>'id', v_submission->>'quizId', v_submission->>'studentId',
        COALESCE(v_submission->>'studentName', ''),
        COALESCE((v_submission->'answers')::jsonb, '{}'::jsonb),
        COALESCE((v_submission->>'score')::integer, 0),
        COALESCE((v_submission->>'total')::integer, 0),
        COALESCE((v_submission->>'passed')::boolean, false),
        COALESCE((v_submission->>'needsManualGrade')::boolean, false)
      )
      ON CONFLICT (quiz_id, student_id) DO NOTHING;
    END LOOP;
  END IF;

  -- documents
  IF v_docs IS NOT NULL THEN
    FOR v_doc IN SELECT * FROM jsonb_array_elements(v_docs) LOOP
      INSERT INTO public.documents (id, student_id, student_name, file_name, file_type, file_size, category, note, storage_path, file_url, is_read)
      VALUES (
        v_doc->>'id', v_doc->>'studentId', COALESCE(v_doc->>'studentName', ''),
        v_doc->>'fileName', COALESCE(v_doc->>'fileType', ''),
        COALESCE((v_doc->>'fileSize')::bigint, 0),
        COALESCE(v_doc->>'category', 'general'), COALESCE(v_doc->>'note', ''),
        v_doc->>'storage_path', v_doc->>'fileUrl',
        COALESCE((v_doc->>'read')::boolean, false)
      )
      ON CONFLICT (id) DO NOTHING;
    END LOOP;
  END IF;

  -- academic_history
  IF v_academic IS NOT NULL THEN
    FOR v_sid IN SELECT jsonb_object_keys(v_academic) LOOP
      FOR v_doc IN SELECT * FROM jsonb_array_elements(COALESCE(v_academic->v_sid, '[]')) LOOP
        INSERT INTO public.academic_history (id, student_id, year_class, grade, added_at)
        VALUES (
          v_doc->>'id', v_sid, v_doc->>'yearClass', COALESCE(v_doc->>'grade', ''),
          COALESCE(NULLIF(v_doc->>'addedAt','')::date, CURRENT_DATE)
        )
        ON CONFLICT (id) DO NOTHING;
      END LOOP;
    END LOOP;
  END IF;

  -- teacher_notes
  IF v_tnotes IS NOT NULL THEN
    FOR v_sid IN SELECT jsonb_object_keys(v_tnotes) LOOP
      FOR v_doc IN SELECT * FROM jsonb_array_elements(COALESCE(v_tnotes->v_sid, '[]')) LOOP
        INSERT INTO public.teacher_notes (id, student_id, text, note_date, note_time)
        VALUES (
          v_doc->>'id', v_sid, v_doc->>'text',
          COALESCE(NULLIF(v_doc->>'date','')::date, CURRENT_DATE),
          COALESCE(v_doc->>'time', '')
        )
        ON CONFLICT (id) DO NOTHING;
      END LOOP;
    END LOOP;
  END IF;

  RAISE NOTICE 'Migration সম্পন্ন।';
END;
$$;
```

---

## ৪. `remote-sync.js` — নতুন version

বিদ্যমান `remote-sync.js` সম্পূর্ণ replace করবে। নতুন file-এর নাম `remote-sync.js` — একই নাম, কিন্তু ভেতরে relational RPC calls।

**গুরুত্বপূর্ণ নিয়ম নতুন `remote-sync.js` লেখার সময়:**

1. File max **400 লাইন** — প্রয়োজনে `remote-sync-write.js` আলাদা করো
2. `supabaseClient` variable name অপরিবর্তিত
3. `window.RemoteSync` object-এর **public API অপরিবর্তিত** রাখো — `api.js` যেভাবে call করে সেভাবেই করবে
4. নতুন RPC function names: `madrasa_rel_*` prefix

**`window.RemoteSync` এর public API যা অবশ্যই থাকতে হবে:**
```javascript
window.RemoteSync = {
  isRemote(),
  usesSecureKv(),
  mem: { core, goals, exams, docs, academic, tnotes, teacherPin, lockHints, loaded },
  bootstrap(),
  startRealtimeSync(),
  unlockTeacherWithPin(pin),
  unlockStudentWithWaqfPin(waqf, pin),
  refreshStudentLockHints(),
  schedule(key, getter),   // এখন individual table save trigger করবে
  flushKey(key, value),
  flushAllFromMem(),
  uploadFile(path, file),
  getSignedUrlForPath(path),
  consumeUploadResult(res),
  BUCKET,
}
```

**`mem` object-এর structure অপরিবর্তিত রাখো** — `api.js` `RS.mem.core`, `RS.mem.goals` ইত্যাদি সরাসরি পড়ে। নতুনতে `mem.core` এর মধ্যে students, chats, tasks থাকবে ঠিক আগের মতো — কিন্তু data আসবে relational tables থেকে assembled করে।

**`schedule(key, getter)` এর নতুন behavior:**
```
key = 'core'      → students + messages + tasks upsert
key = 'goals'     → goals upsert  
key = 'exams'     → quizzes + submissions upsert
key = 'docs_meta' → documents upsert
key = 'academic'  → academic_history upsert
key = 'tnotes'    → teacher_notes upsert
key = 'teacher_pin' → madrasa_rel_update_teacher_pin call
```

**Real-time:** Broadcast channel এর বদলে `postgres_changes` subscription নির্দিষ্ট tables-এ।

---

## ৫. `api.js` — পরিবর্তন কোথায়

`api.js` এর **বেশিরভাগ code অপরিবর্তিত থাকবে।** শুধু যেখানে `RS.schedule()` বা `RS.flushKey()` call হয় সেখানে নতুন key naming নিশ্চিত করো।

**যা পরিবর্তন করতে হবে না:**
- `Auth`, `Students`, `Messages`, `Tasks`, `Goals`, `Exams`, `Docs`, `AcademicHistory`, `TeacherNotes` modules-এর logic
- `esc()`, `showToast()`, `openModal()` ইত্যাদি helpers
- LocalStorage fallback সব

**`Messages.markRead()` এ একটা নতুন RPC call যোগ করো:**
```javascript
markRead(threadId, role) {
  // existing local logic...
  if (_useRemote && RS.markMessagesReadRemote) {
    RS.markMessagesReadRemote(threadId, role);
  }
}
```

---

## ৬. Edge Function — `notify-kv-push` আপডেট

বর্তমান Edge Function `app_kv` table-এর Webhook থেকে trigger হয়। নতুনতে `messages` table-এ INSERT হলে trigger হওয়া উচিত।

**Supabase Dashboard → Database → Webhooks এ:**
- পুরনো webhook: `app_kv` table → রেখে দাও (PWA subscriptions এখনো app_kv-তে থাকতে পারে যতদিন migration চলছে)
- নতুন webhook যোগ করো: `messages` table, event: INSERT → same Edge Function URL

**Edge Function এর ভেতরে** push subscription lookup logic আপডেট করো — `app_kv` এর `pwa_push_*` keys এর বদলে `pwa_subscriptions` table থেকে পড়বে।

---

## ৭. Deployment ধাপ

```
1. git checkout -b feature/relational-schema

2. SQL files তৈরি করো:
   supabase/006_relational_tables.sql
   supabase/007_relational_rls.sql
   supabase/008_relational_rpc.sql
   (009 migration পরে চালাবে)

3. Supabase SQL Editor-এ চালাও:
   006 → 007 → 008 (এই ক্রমে)

4. remote-sync.js নতুন version লেখো

5. api.js প্রয়োজনীয় আপডেট করো

6. Local-এ test করো (supabase-config.js দিয়ে)
   - Teacher login হয় কিনা
   - Student login হয় কিনা
   - Message পাঠানো যায় কিনা
   - Task create/complete হয় কিনা
   - File upload হয় কিনা

7. সব ঠিক থাকলে 009_data_migration.sql চালাও
   (এটা চালালে পুরনো data নতুন tables-এ copy হবে)

8. আবার test করো — পুরনো data দেখা যাচ্ছে কিনা

9. Edge Function webhook আপডেট করো

10. Push notification test করো

11. git add . && git commit -m "done: relational schema migration"

12. main-এ merge করার আগে উস্তাজকে জানাও
```

---

## ৮. Rollback পরিকল্পনা

যেকোনো সমস্যায়:
```bash
git checkout main
```
`app_kv` table অপরিবর্তিত থাকবে। পুরনো `main` branch-এর code সরাসরি কাজ করবে।

নতুন tables delete করতে হলে Supabase SQL Editor-এ:
```sql
DROP TABLE IF EXISTS public.pwa_subscriptions CASCADE;
DROP TABLE IF EXISTS public.teacher_notes CASCADE;
DROP TABLE IF EXISTS public.academic_history CASCADE;
DROP TABLE IF EXISTS public.documents CASCADE;
DROP TABLE IF EXISTS public.quiz_submissions CASCADE;
DROP TABLE IF EXISTS public.quiz_assignees CASCADE;
DROP TABLE IF EXISTS public.quiz_questions CASCADE;
DROP TABLE IF EXISTS public.quizzes CASCADE;
DROP TABLE IF EXISTS public.goals CASCADE;
DROP TABLE IF EXISTS public.task_assignments CASCADE;
DROP TABLE IF EXISTS public.tasks CASCADE;
DROP TABLE IF EXISTS public.messages CASCADE;
DROP TABLE IF EXISTS public.students CASCADE;
DROP TABLE IF EXISTS public.madrasa_config CASCADE;
```

---

## ৯. CLAUDE.md আপডেট করতে হবে

Migration শেষে `CLAUDE.md` এর "Deployment Context" section আপডেট করো:

- `app_kv` reference সরিয়ে নতুন table names যোগ করো
- নতুন RPC function names (`madrasa_rel_*`) উল্লেখ করো
- Migration SQL files (006-009) এর বিবরণ যোগ করো
- `remote-sync.js` এর নতুন behavior describe করো
