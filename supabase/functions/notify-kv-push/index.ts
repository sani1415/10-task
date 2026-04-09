import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import webPush from "npm:web-push@3.6.7";

const MAILTO = Deno.env.get("WEB_PUSH_CONTACT") || "mailto:admin@localhost";

function jsonResponse(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function isSubscriptionKvKey(key: string) {
  return key === "pwa_push_teacher" || key.startsWith("pwa_push_student_");
}

type SubJson = { endpoint?: string; keys?: { p256dh?: string; auth?: string } };

function pickSubscription(v: unknown): SubJson | null {
  if (!v || typeof v !== "object") return null;
  const o = v as { subscription?: SubJson };
  const s = o.subscription;
  if (s && typeof s.endpoint === "string" && s.endpoint.length > 0) return s;
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  const secret = (Deno.env.get("NOTIFY_WEBHOOK_SECRET") || "").trim();
  const auth = req.headers.get("authorization") || "";
  const hdr = (req.headers.get("x-notify-secret") || "").trim();
  const bearer = secret ? `Bearer ${secret}` : "";
  if (!secret || (auth !== bearer && hdr !== secret)) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  const vapidPublic = (Deno.env.get("VAPID_PUBLIC_KEY") || "").trim();
  const vapidPrivate = (Deno.env.get("VAPID_PRIVATE_KEY") || "").trim();
  if (!vapidPublic || !vapidPrivate) {
    return jsonResponse({ error: "vapid_not_configured" }, 500);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  const table = String(body.table || "");
  if (table !== "app_kv") return jsonResponse({ ok: true, skipped: "not_app_kv" });

  const record = body.record as Record<string, unknown> | undefined;
  const key = record?.key != null ? String(record.key) : "";
  if (isSubscriptionKvKey(key)) {
    return jsonResponse({ ok: true, skipped: "subscription_key" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(supabaseUrl, serviceKey);

  const { data: teacherRow } = await sb.from("app_kv").select("value").eq("key", "pwa_push_teacher").maybeSingle();
  const { data: studentRows, error: stErr } = await sb.from("app_kv").select("key,value").like("key", "pwa_push_student_%");
  if (stErr) console.error("student push rows:", stErr);

  const subs: SubJson[] = [];
  const add = (val: unknown) => {
    const s = pickSubscription(val);
    if (s) subs.push(s);
  };
  if (teacherRow?.value) add(teacherRow.value);
  for (const r of studentRows || []) add(r.value);

  webPush.setVapidDetails(MAILTO, vapidPublic, vapidPrivate);

  const payload = JSON.stringify({
    title: "Waqful Madinah",
    body: "নতুন আপডেট এসেছে। অ্যাপ খুলুন।",
    url: "./index.html",
    tag: "kv-" + (key || "sync").slice(0, 40),
  });

  let sent = 0;
  let failed = 0;
  for (const sub of subs) {
    try {
      await webPush.sendNotification(sub as Parameters<typeof webPush.sendNotification>[0], payload, {
        TTL: 3600,
      });
      sent++;
    } catch (e) {
      console.error("push failed", sub.endpoint?.slice(0, 48), e);
      failed++;
    }
  }

  return jsonResponse({ ok: true, sent, failed, targets: subs.length });
});
