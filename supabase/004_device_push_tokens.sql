-- Future: Capacitor (@capacitor/push-notifications) + FCM — store device tokens for server-side sends.
-- Not used by the web app yet. Wire via RPC + Edge Function (service role) when implementing push.

create table if not exists public.device_push_tokens (
  id uuid primary key default gen_random_uuid(),
  platform text,
  fcm_token text not null,
  student_waqf text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (fcm_token)
);

comment on table public.device_push_tokens is 'Reserved for FCM/Capacitor push — app does not read/write yet.';

alter table public.device_push_tokens enable row level security;

-- No anon policies: registration and sends will use service role or authenticated RPCs later.
