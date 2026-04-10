# Waqful Madinah — CLAUDE.md

## Architecture Rules
- ALL data logic in `api.js` only — HTML files just call `API.*`
- ALL shared CSS in `style.css` — theme overrides in HTML `<style>` are OK
- Never access localStorage directly in HTML — always use `API.DB.get()`
- `api.js` is backend-swappable — never hardcode storage logic in HTML

## Coding Rules
- Always use `esc()` for user data rendered in HTML
- All user-facing text must be in Bengali
- Supabase client must always be named `supabaseClient`
- Vanilla JS only (no React/Vue). **Exception:** minimal `package.json` + `npm run build` for Vercel config injection only.

## File Size Limits
- `api.js` → max 800 lines, split into modules if exceeded
- `style.css` → max 500 lines
- `teacher.html` / `student.html` → max 600 lines, move excess JS to `api.js`
- Any new `.js` file → max 400 lines

## Git Rules
- **Do not run `git commit` or `git push` unless the user explicitly asks.** The maintainer commits locally.
- After editing, give a **summary of changes first** (what/why, files touched). The user will stage and commit.
- **Optional** commit message style when you commit yourself: `before: [short description]` / `done: [short description]` for checkpoints around a change.

## Deployment Context
- Teacher uses ONE device, students use SEPARATE devices
- **Backend:** With `supabase-config.js` (URL + anon key) + scripts in HTML, data syncs via **Supabase** (relational tables + Storage bucket `waqf-files`). Without that file, the app falls back to **LocalStorage** (single-browser).
- **Production DB — migration order:**
  1. `001_app_kv_and_storage.sql` — legacy KV table + storage bucket
  2. `002_production_rpc_rls.sql` — RLS + legacy PIN-gated RPCs (`madrasa_*`)
  3. `003_madrasa_student_lock_hints.sql` — lock screen RPC
  4. `004_device_push_tokens.sql` — placeholder for future FCM/Capacitor
  5. `005_pwa_student_push_kv.sql` — legacy Web Push KV keys
  6. `006_relational_tables.sql` — 13 relational tables replacing `app_kv` blobs
  7. `007_relational_rls.sql` — RLS on all new tables (deny all direct REST)
  8. `008_relational_rpc.sql` — PIN-gated RPCs (`madrasa_rel_*` prefix); also needs `private` schema (`CREATE SCHEMA IF NOT EXISTS private`)
  9. `009_data_migration.sql` — one-time copy of `app_kv` data into relational tables
- **Relational tables:** `madrasa_config`, `students`, `messages`, `tasks`, `task_assignments`, `goals`, `quizzes`, `quiz_questions`, `quiz_assignees`, `quiz_submissions`, `documents`, `academic_history`, `teacher_notes`, `pwa_subscriptions`. All have RLS enabled; zero direct REST access — everything goes through `madrasa_rel_*` RPCs.
- **RPC functions (`madrasa_rel_*`, all `GRANT EXECUTE TO anon`):**
  - `madrasa_rel_public_branding()` — no PIN
  - `madrasa_rel_student_lock_hints()` — no PIN
  - `madrasa_rel_teacher_bootstrap(pin)` — returns all data assembled
  - `madrasa_rel_student_bootstrap(waqf, pin)` — returns student's own data only
  - Write: `upsert_student`, `delete_student`, `insert_message`, `mark_messages_read`, `upsert_task`, `update_task_status`, `upsert_goal`, `upsert_quiz`, `submit_quiz`, `insert_document`, `update_teacher_pin`, `save_pwa_subscription`
- **`remote-sync.js` + `remote-sync-write.js`:** Together replace the old single-file sync. `remote-sync.js` (≤400 lines) handles bootstrap, assembly, schedule/flush, realtime; `remote-sync-write.js` (≤400 lines) handles all relational write operations. `window.RemoteSync` public API is **unchanged** — same method names, same `mem` object shape (`core`, `goals`, `exams`, `docs`, `academic`, `tnotes`, `teacherPin`, `lockHints`, `loaded`). Bootstrap assembles relational rows back into the old blob format so `api.js` reads identically. `schedule(key, getter)` routes to `madrasa_rel_*` RPCs instead of `app_kv` upserts. `markMessagesReadRemote(threadId, role)` is a new method called from `Messages.markRead()` in `api.js`. Load order: `remote-sync-write.js` before `remote-sync.js`.
- **In-app instant sync:** `remote-sync.js` subscribes to Supabase Realtime **`postgres_changes`** on `messages`, `students`, `tasks`, `task_assignments` tables (channel `madrasa_rel_changes`). On change, calls `pullRemoteSnapshot` and dispatches `madrasa-remote-sync`. Realtime must be enabled on those tables (added to `supabase_realtime` publication). This is not OS push — it requires the page open and online.
- **Vercel:** Set env `SUPABASE_URL` and `SUPABASE_ANON_KEY`. Optional: **`PWA_VAPID_PUBLIC_KEY`** (Web Push subscription). Build runs `npm run build` → writes `supabase-config.js` and **`pwa-config.js`** (VAPID public only). If env is missing and the target file already exists locally, each script leaves it unchanged.
- **Storage:** Bucket `waqf-files` is private; uploads use signed URLs (short TTL). Document previews use `API.Docs.resolveFileUrl()`. Document **metadata** lives in the `documents` table; file **bytes** are only in Storage. Per-file upload limit **10 MB** (`API.MAX_UPLOAD_BYTES`, enforced in `api.js` + `remote-sync.js`). Multiple selected **images** are merged to one PDF in the browser (`pdf-merge.js`, jsPDF from CDN in `student.html` / `teacher.html`).
- **Teacher → ছাত্র প্রোফাইল:** `API.Students.clearAllRelatedData(sid)` keeps the row (name/waqf/pin) but wipes chat, tasks, quiz submissions, doc metadata, goals, academic history, teacher notes. `API.Students.deleteCompletely(sid)` removes the student and the same data (CASCADE in DB); `getNextWaqfId()` reuses the smallest free `waqf_NNN` number. **Student profile body** uses **layout 2** (settings-style rows, `profile-v2-*` in `style.css`).
- **Security note:** PINs are verified on the server via `private.verify_teacher_pin()` for all `madrasa_rel_*` RPCs, but anyone with the anon key can still call RPCs by brute force — protect the anon key, use HTTPS, and treat this as appropriate for a small trusted cohort (not open internet anonymity).
- `supabase-config.js` is **gitignored**; copy from `supabase-config.example.js` for local dev. Never commit real keys.
- **Web Push subscriptions:** Stored in `pwa_subscriptions` table (`id = 'teacher'` or student `waqf_id`, `role`, `subscription` jsonb). Legacy `app_kv.pwa_push_*` keys still work as fallback until users re-open the app. Save via `madrasa_rel_save_pwa_subscription(id, role, subscription)` RPC.
- **Background push (app closed):** Edge Function **`notify-kv-push`** (`supabase/functions/notify-kv-push/index.ts`) handles two webhooks: (1) **`messages` table INSERT** — routes by `role`: `'in'` notifies teacher, `'out'` notifies the target student (or all students for `_bc`); (2) **`app_kv` table** — legacy path, fires only when `core._notifyAt` changes. Subscriptions read from `pwa_subscriptions` first, `app_kv` fallback. **Supabase Dashboard → Edge Functions → Secrets:** `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `NOTIFY_WEBHOOK_SECRET`, optional `WEB_PUSH_CONTACT`. **Database → Webhooks:** two webhooks to the same Edge Function URL — one on `public.messages` (INSERT), one on `public.app_kv` (Insert + Update). Header `Authorization: Bearer <NOTIFY_WEBHOOK_SECRET>`. If the private key is ever leaked, generate a new VAPID pair, update Vercel + Supabase secrets, redeploy, and have users open the app once to re-subscribe.

## Self-Maintenance
After every feature, update this CLAUDE.md if any rule changed; include that update in your own commit when you commit.
