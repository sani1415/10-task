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
type SubRow = { key: string; value: unknown };

function pickSubscription(v: unknown): SubJson | null {
  if (!v || typeof v !== "object") return null;
  const o = v as { subscription?: SubJson };
  const s = o.subscription;
  if (s && typeof s.endpoint === "string" && s.endpoint.length > 0) return s;
  return null;
}

/**
 * Decide who triggered the change and who should be notified.
 *
 * Keys written ONLY by students: core (chat/task status), goals, exams, docs_meta, academic, tnotes
 * Keys written ONLY by teacher:  core (teacher writes tasks/students), goals (teacher can set), exams,
 *                                 docs_meta, academic, tnotes, teacher_pin
 *
 * Because both sides write to "core" we look at the OLD vs NEW value to guess the actor,
 * but that's complex. Instead we use a simpler rule:
 *   - "tnotes" / "teacher_pin" → only teacher writes → notify STUDENTS
 *   - all other keys (core, goals, exams, docs_meta, academic) → could be either →
 *     notify BOTH sides (teacher + students) but use a different message body per audience.
 *
 * This means teacher always sees a ping when data changes (even their own saves) but
 * students only see a ping when relevant teacher-side keys change.
 * For a small cohort this is acceptable and simple.
 */
function resolveAudience(key: string): "teacher_only" | "students_only" | "both" {
  if (key === "tnotes" || key === "teacher_pin") return "students_only";
  // "core" contains chat messages + tasks + student list — both sides care
  return "both";
}

function makePayload(title: string, body: string, key: string, target: "teacher" | "student"): string {
  return JSON.stringify({
    title,
    body,
    url: target === "teacher" ? "./teacher.html" : "./student.html",
    tag: "kv-" + target + "-" + key.slice(0, 30),
  });
}

async function sendPush(sub: SubJson, payload: string, vapidPublic: string, vapidPrivate: string) {
  webPush.setVapidDetails(MAILTO, vapidPublic, vapidPrivate);
  await webPush.sendNotification(
    sub as Parameters<typeof webPush.sendNotification>[0],
    payload,
    { TTL: 3600 }
  );
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

  const { data: teacherRow } = await sb
    .from("app_kv").select("value").eq("key", "pwa_push_teacher").maybeSingle();
  const { data: studentRows } = await sb
    .from("app_kv").select("key,value").like("key", "pwa_push_student_%");

  const teacherSub = teacherRow?.value ? pickSubscription(teacherRow.value) : null;
  const studentSubs: SubJson[] = (studentRows as SubRow[] || [])
    .map((r) => pickSubscription(r.value))
    .filter((s): s is SubJson => s !== null);

  const audience = resolveAudience(key);

  // Notification text per audience
  const teacherPayload = makePayload(
    "Waqful Madinah",
    "ছাত্রের নতুন আপডেট এসেছে।",
    key,
    "teacher"
  );
  const studentPayload = makePayload(
    "Waqful Madinah",
    "শিক্ষকের নতুন আপডেট এসেছে। অ্যাপ খুলুন।",
    key,
    "student"
  );

  let sent = 0;
  let failed = 0;

  async function trySend(sub: SubJson, payload: string) {
    try {
      await sendPush(sub, payload, vapidPublic, vapidPrivate);
      sent++;
    } catch (e) {
      console.error("push failed", sub.endpoint?.slice(0, 48), e);
      failed++;
    }
  }

  if (audience === "both" || audience === "students_only") {
    for (const sub of studentSubs) await trySend(sub, studentPayload);
  }
  if (audience === "both" || audience === "teacher_only") {
    if (teacherSub) await trySend(teacherSub, teacherPayload);
  }

  return jsonResponse({ ok: true, sent, failed,
    teacher_targets: teacherSub ? 1 : 0,
    student_targets: studentSubs.length,
    audience,
  });
});
