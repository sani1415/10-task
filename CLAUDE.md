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
- **Backend:** With `supabase-config.js` (URL + anon key) + scripts in HTML, data syncs via **Supabase** (`app_kv` JSON + Storage bucket `waqf-files`). Without that file, the app falls back to **LocalStorage** (single-browser).
- **Production DB:** Run `supabase/001_app_kv_and_storage.sql`, **`002_production_rpc_rls.sql`**, **`003_madrasa_student_lock_hints.sql`**, then **`005_pwa_student_push_kv.sql`** (student Web Push KV keys), then optionally **`004_device_push_tokens.sql`** (placeholder for future FCM/Capacitor). After 002, direct `app_kv` REST access is denied; the app uses PIN-gated RPCs (`madrasa_*`). Student lock screen “অপেক্ষারত” uses **`madrasa_student_lock_hints`** (names + waqf + unread counts only, no PINs). `teacher.html` / `student.html` set `window.__MADRASA_ROLE__` — required for secure remote mode. Omitting the role flag keeps legacy direct KV (dev only).
- **Vercel:** Set env `SUPABASE_URL` and `SUPABASE_ANON_KEY`. Optional: **`PWA_VAPID_PUBLIC_KEY`** (Web Push subscription). Build runs `npm run build` → writes `supabase-config.js` and **`pwa-config.js`** (VAPID public only). If env is missing and the target file already exists locally, each script leaves it unchanged.
- **Storage:** Bucket `waqf-files` is private after 002; uploads use signed URLs (short TTL). Document previews use `API.Docs.resolveFileUrl()`. Document **metadata** lives in KV (`docs_meta`); file **bytes** are only in Storage (not in `app_kv`). Per-file upload limit **10 MB** (`API.MAX_UPLOAD_BYTES`, enforced in `api.js` + `remote-sync.js`). Multiple selected **images** are merged to one PDF in the browser (`pdf-merge.js`, jsPDF from CDN in `student.html` / `teacher.html`).
- **Teacher → ছাত্র প্রোফাইল:** `API.Students.clearAllRelatedData(sid)` keeps the row (name/waqf/pin) but wipes chat, tasks, quiz submissions, doc metadata, goals, academic history, teacher notes. `API.Students.deleteCompletely(sid)` removes the student and the same data; `getNextWaqfId()` reuses the smallest free `waqf_NNN` number. **Student profile body** uses **layout 2** (settings-style rows, `profile-v2-*` in `style.css`). Optional other demos: **`teacher-profile-prototypes.html`**.
- **Security note:** PINs are verified on the server for KV RPCs, but anyone with the anon key can still call student/teacher RPCs by brute force — protect the anon key, use HTTPS, and treat this as appropriate for a small trusted cohort (not open internet anonymity).
- `supabase-config.js` is **gitignored**; copy from `supabase-config.example.js` for local dev. Never commit real keys.
- **In-app instant sync:** `remote-sync.js` subscribes to Supabase Realtime **Broadcast** on channel `madrasa_kv_sync` (event `kv`). After remote saves it pings the channel; other tabs/devices run `pullRemoteSnapshot` and dispatch `madrasa-remote-sync`. This is not OS push — it requires the page open and online.
- **PWA (`sw.js`, `manifest.webmanifest`, `pwa-notify.js`):** Full static shell cache for `index.html` / `teacher.html` / `student.html`, shared JS/CSS, CDN bundles (Supabase client, jsPDF), and config files. **`API.Pwa.registerServiceWorker()`** + **`API.Pwa.enableNotificationsAfterAuth(role, { waqfId })`** run after init / login. **Foreground:** if Notification permission is granted and the tab is in the background, `madrasa-remote-sync` can show a short Bengali “নতুন আপডেট” hint (throttled). **Web Push:** client subscribes with **`window.__PWA_VAPID_PUBLIC_KEY__`** (`pwa-config.js` / Vercel `PWA_VAPID_PUBLIC_KEY`) and saves subscriptions to **`app_kv`** keys **`pwa_push_teacher`** and **`pwa_push_student_<waqf>`** (needs **`005_pwa_student_push_kv.sql`**).
- **Background push (app closed):** Edge Function **`notify-kv-push`** (`supabase/functions/notify-kv-push/index.ts`) — `POST` with shared secret, reads Database Webhook payload for **`app_kv`**; skips rows whose `key` is `pwa_push_*`; loads all stored push subscriptions and sends a Bengali notification via **`web-push`**. **Supabase Dashboard → Edge Functions → Secrets:** set **`VAPID_PUBLIC_KEY`** and **`VAPID_PRIVATE_KEY`** (same pair as the client; **never commit** the private key), **`NOTIFY_WEBHOOK_SECRET`** (long random string), optional **`WEB_PUSH_CONTACT`** (`mailto:…` for VAPID). **Database → Webhooks:** on table **`public.app_kv`**, events **Insert** + **Update**, URL **`https://<project-ref>.supabase.co/functions/v1/notify-kv-push`**, header **`Authorization: Bearer <NOTIFY_WEBHOOK_SECRET>`** (same value as the secret, without duplicating the word `Bearer` in the secret field — the function expects `Authorization: Bearer` + secret). If the private key is ever leaked, generate a **new** VAPID pair, update Vercel + Supabase secrets, redeploy the site, and have users open the app once to re-subscribe. **`004_device_push_tokens.sql`** remains for a future **FCM/Capacitor** path.

## Self-Maintenance
After every feature, update this CLAUDE.md if any rule changed; include that update in your own commit when you commit.
