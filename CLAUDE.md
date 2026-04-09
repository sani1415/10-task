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
- **Production DB:** Run `supabase/001_app_kv_and_storage.sql` then **`supabase/002_production_rpc_rls.sql`**. After 002, direct `app_kv` REST access is denied; the app uses PIN-gated RPCs (`madrasa_*`). `teacher.html` / `student.html` set `window.__MADRASA_ROLE__` — required for secure remote mode. Omitting the role flag keeps legacy direct KV (dev only).
- **Vercel:** Set env `SUPABASE_URL` and `SUPABASE_ANON_KEY`. Build runs `npm run build` → writes `supabase-config.js`. If env is missing and `supabase-config.js` already exists locally, the script leaves it unchanged.
- **Storage:** Bucket `waqf-files` is private after 002; uploads use signed URLs (short TTL). Document previews use `API.Docs.resolveFileUrl()`.
- **Security note:** PINs are verified on the server for KV RPCs, but anyone with the anon key can still call student/teacher RPCs by brute force — protect the anon key, use HTTPS, and treat this as appropriate for a small trusted cohort (not open internet anonymity).
- `supabase-config.js` is **gitignored**; copy from `supabase-config.example.js` for local dev. Never commit real keys.
- Real-time tab sync is not implemented yet (no Supabase Realtime subscription).
- Do NOT add notification logic that depends on push/server events until explicitly requested

## Self-Maintenance
After every feature, update this CLAUDE.md if any rule changed; include that update in your own commit when you commit.
