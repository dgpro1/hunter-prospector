// API JSON del panel (la app de una sola página la consume).
import type { Env } from "./crm.ts";
import { evolutionReady, setting } from "./auto.ts";
import { getQuota, normalizePhone, today } from "./leads.ts";
import { addNote, setStage, STAGES, STAGE_LABEL, type Stage } from "./store.ts";
import { PAISES } from "./hunt.ts";

const now = () => new Date().toISOString();
const BOG = "'-5 hours'"; // Bogotá no tiene horario de verano
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

export async function api(req: Request, url: URL, env: Env): Promise<Response> {
  const path = url.pathname.replace(/^\/panel\/api/, "");
  if (path === "/state") return json(await state(env));
  if (path === "/leads") return json(await leads(env));
  if (path === "/today") {
    const r = await env.DB.prepare("SELECT * FROM leads WHERE day = ? ORDER BY status = 'enviado', rowid").bind(today()).all();
    return json(r.results ?? []);
  }
  if (path === "/drafts") {
    const r = await env.DB.prepare(
      `SELECT d.*, l.phone AS lead, l.name, l.city, l.color, l.response_minutes FROM drafts d
       LEFT JOIN leads l ON l.conversation_id = d.conversation_id
       WHERE d.status = 'pendiente' ORDER BY d.created_at DESC LIMIT 50`,
    ).all();
    return json(r.results ?? []);
  }
  if (path === "/lead" && req.method === "POST") return createLead(req, env);
  const m = path.match(/^\/lead\/([\w-]+)$/);
  if (m) return req.method === "POST" ? updateLead(req, env, m[1]) : json(await leadDetail(env, m[1]));
  return json({ error: "No encontrado" }, 404);
}

async function state(env: Env) {
  const db = env.DB;
  const day = today();
  const [stages, k, series, colors, variants, niches, activity, agenda, hunts, drafts, sentToday] = await Promise.all([
    db.prepare("SELECT stage, COUNT(*) n, COALESCE(SUM(value),0) v FROM leads WHERE status != 'descartado' GROUP BY stage").all<any>(),
    db.prepare(
      `SELECT COUNT(*) total,
         SUM(CASE WHEN sent_at IS NOT NULL OR stage != 'nuevo' THEN 1 ELSE 0 END) contacted,
         SUM(CASE WHEN replied_at IS NOT NULL THEN 1 ELSE 0 END) replied,
         SUM(CASE WHEN stage IN ('demo','llamada','propuesta') THEN 1 ELSE 0 END) hot,
         SUM(CASE WHEN stage = 'ganado' THEN 1 ELSE 0 END) won,
         COALESCE(SUM(CASE WHEN stage = 'ganado' THEN value END),0) won_value,
         COALESCE(SUM(CASE WHEN stage NOT IN ('ganado','perdido') THEN value END),0) pipeline_value,
         SUM(CASE WHEN status = 'cola' THEN 1 ELSE 0 END) queued,
         SUM(CASE WHEN next_at IS NOT NULL AND next_at < ? AND stage NOT IN ('ganado','perdido') THEN 1 ELSE 0 END) overdue,
         AVG(response_minutes) avg_response
       FROM leads WHERE status != 'descartado'`,
    ).bind(now()).first<any>(),
    db.prepare(
      `SELECT d, SUM(s) sent, SUM(r) replies FROM (
         SELECT date(sent_at, ${BOG}) d, 1 s, 0 r FROM leads WHERE sent_at >= date('now','-14 days')
         UNION ALL SELECT date(replied_at, ${BOG}) d, 0 s, 1 r FROM leads WHERE replied_at >= date('now','-14 days')
       ) GROUP BY d ORDER BY d`,
    ).all<any>(),
    db.prepare("SELECT color, COUNT(*) n FROM leads WHERE color IS NOT NULL GROUP BY color").all<any>(),
    db.prepare(
      `SELECT variant, COUNT(*) sent, SUM(CASE WHEN replied_at IS NOT NULL THEN 1 ELSE 0 END) replied
       FROM leads WHERE variant IS NOT NULL AND sent_at IS NOT NULL GROUP BY variant`,
    ).all<any>(),
    db.prepare(
      `SELECT COALESCE(niche,'(sin nicho)') niche, COUNT(*) n, SUM(CASE WHEN replied_at IS NOT NULL THEN 1 ELSE 0 END) replied
       FROM leads WHERE status != 'descartado' GROUP BY niche ORDER BY n DESC LIMIT 6`,
    ).all<any>(),
    db.prepare(
      `SELECT n.text, n.kind, n.created_at, n.lead, l.name FROM notes n LEFT JOIN leads l ON l.phone = n.lead
       ORDER BY n.created_at DESC LIMIT 12`,
    ).all<any>(),
    db.prepare(
      `SELECT phone, name, next_at, next_text, stage FROM leads
       WHERE next_at IS NOT NULL AND stage NOT IN ('ganado','perdido') ORDER BY next_at LIMIT 8`,
    ).all<any>(),
    db.prepare("SELECT * FROM hunts ORDER BY created_at DESC LIMIT 8").all<any>(),
    db.prepare("SELECT COUNT(*) n FROM drafts WHERE status = 'pendiente'").first<any>(),
    db.prepare("SELECT COUNT(*) n FROM leads WHERE day = ? AND status = 'enviado'").bind(day).first<any>(),
  ]);
  return {
    day,
    stages: STAGES.map((s) => {
      const row = (stages.results ?? []).find((r: any) => r.stage === s);
      return { key: s, label: STAGE_LABEL[s], n: row?.n ?? 0, value: row?.v ?? 0 };
    }),
    kpis: k,
    series: series.results ?? [],
    colors: colors.results ?? [],
    variants: variants.results ?? [],
    niches: niches.results ?? [],
    activity: activity.results ?? [],
    agenda: agenda.results ?? [],
    hunts: hunts.results ?? [],
    drafts: drafts?.n ?? 0,
    sending: {
      sentToday: sentToday?.n ?? 0,
      quota: await getQuota(env),
      auto: (await setting(env, "auto")) === "on",
      ready: evolutionReady(env),
      nextAt: (await setting(env, "next_send_at")) || null,
      lastError: (await setting(env, "last_error")) || null,
    },
    countries: Object.values(PAISES).map((p) => [p.code, p.name]),
  };
}

async function leads(env: Env) {
  const r = await env.DB.prepare(
    `SELECT phone, name, city, niche, rating, stage, origin, color, value, next_at, next_text, status, sent_at, replied_at,
            response_minutes, variant, conversation_id, updated_at
     FROM leads WHERE status != 'descartado' ORDER BY updated_at DESC LIMIT 1500`,
  ).all();
  return r.results ?? [];
}

async function leadDetail(env: Env, id: string) {
  const lead = await env.DB.prepare("SELECT * FROM leads WHERE phone = ?").bind(id).first<any>();
  if (!lead) return { error: "No existe" };
  const notes = await env.DB.prepare("SELECT * FROM notes WHERE lead = ? ORDER BY created_at DESC LIMIT 100").bind(id).all();
  const draft = lead.conversation_id
    ? await env.DB.prepare("SELECT * FROM drafts WHERE conversation_id = ? AND status = 'pendiente' ORDER BY created_at DESC").bind(lead.conversation_id).first()
    : null;
  return { lead, notes: notes.results ?? [], draft };
}

async function updateLead(req: Request, env: Env, id: string): Promise<Response> {
  const b: any = await req.json().catch(() => ({}));
  const exists = await env.DB.prepare("SELECT phone FROM leads WHERE phone = ?").bind(id).first();
  if (!exists) return json({ error: "No existe" }, 404);
  if (b.stage && (STAGES as readonly string[]).includes(b.stage)) await setStage(env, id, b.stage as Stage);
  const sets: string[] = [], vals: unknown[] = [];
  if ("value" in b) { sets.push("value = ?"); vals.push(b.value === "" || b.value == null ? null : Number(b.value)); }
  if ("next_at" in b) { sets.push("next_at = ?"); vals.push(b.next_at || null); }
  if ("next_text" in b) { sets.push("next_text = ?"); vals.push(String(b.next_text ?? "").slice(0, 200) || null); }
  if ("name" in b && String(b.name).trim()) { sets.push("name = ?"); vals.push(String(b.name).trim().slice(0, 120)); }
  if (sets.length) {
    await env.DB.prepare(`UPDATE leads SET ${sets.join(", ")}, updated_at = ? WHERE phone = ?`).bind(...vals, now(), id).run();
    if ("next_at" in b && b.next_at) await addNote(env, id, `Próxima acción: ${b.next_text || "seguimiento"} · ${String(b.next_at).slice(0, 16).replace("T", " ")}`);
    if ("value" in b && b.value) await addNote(env, id, `Valor del trato: ${Number(b.value).toLocaleString("es-CO")} USD`);
  }
  if (b.note && String(b.note).trim()) await addNote(env, id, String(b.note).trim().slice(0, 2000), "nota");
  return json(await leadDetail(env, id));
}

async function createLead(req: Request, env: Env): Promise<Response> {
  const b: any = await req.json().catch(() => ({}));
  const name = String(b.name ?? "").trim();
  const phone = normalizePhone(b.phone);
  if (!name || !phone) return json({ error: "Pon nombre y un WhatsApp con código de país." }, 400);
  const at = now();
  const r = await env.DB.prepare(
    `INSERT OR IGNORE INTO leads (phone, name, city, niche, origin, stage, status, batch, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'manual', 'nuevo', 'cola', 'manual', ?, ?)`,
  ).bind(phone, name, b.city || null, b.niche || null, at, at).run();
  if (!r.meta.changes) return json({ error: "Ese número ya está en tu CRM." }, 409);
  await addNote(env, phone, "Ficha creada a mano");
  return json(await leadDetail(env, phone));
}
