// Demo personalizada: un link público con un chat de IA que atiende como el negocio del prospecto.
import type { Env } from "./crm.ts";
import { TONE } from "./brain.ts";
import { addNote } from "./store.ts";
import { shortName } from "./offers.ts";
import { notify } from "./alerts.ts";
import { compileDemoPrompt, splitAction, type Booking } from "./demoPrompt.ts";
import { complete } from "./llm.ts";
import { zoneFor } from "./auto.ts";
import { renderDemoPage } from "./demoPage.ts";

const now = () => new Date().toISOString();
const DAILY_LIMIT = 60; // mensajes por demo y día: tope de gasto si el link circula

export type Demo = {
  slug: string; lead: string; business: string; city: string | null; category: string | null;
  knowledge: string | null; services: string | null; hours: string | null; views: number; messages: number;
  rating: number | null; bookings: number;
};

function slugify(name: string): string {
  const base = name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32);
  return `${base || "demo"}-${crypto.randomUUID().slice(0, 4)}`;
}

/** Texto plano de su web (primeros ~6.000 caracteres) para que la IA conozca servicios, horario y tono. */
export async function readWebsite(url: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; HunterDemo/1.0)" }, redirect: "follow", cf: { cacheTtl: 3600 } } as RequestInit);
    if (!r.ok || !(r.headers.get("content-type") ?? "").includes("html")) return null;
    const html = (await r.text()).slice(0, 400_000);
    // Datos estructurados (dirección, teléfono, horario, reseñas) cuando la web los publica
    let ld = "";
    for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
      if (/LocalBusiness|telephone|openingHours|Dentist|MedicalBusiness|address/i.test(m[1])) ld += m[1].replace(/\s+/g, " ").trim() + "\n";
    }
    const text = html
      .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&[a-z#0-9]+;/gi, " ")
      .replace(/\s+/g, " ").trim();
    const body = text.length > 80 ? text.slice(0, 6000) : "";
    const out = (ld ? `Datos estructurados: ${ld.slice(0, 1500)}\n` : "") + body;
    return out.length > 80 ? out : null;
  } catch {
    return null;
  }
}

export async function createDemo(env: Env, leadId: string, opts: { services?: string; hours?: string } = {}): Promise<Demo> {
  const base = env.PUBLIC_URL ?? "";
  const lead = await env.DB.prepare("SELECT * FROM leads WHERE phone = ?").bind(leadId).first<any>();
  if (!lead) throw new Error("No existe el prospecto");
  const existing = await env.DB.prepare("SELECT * FROM demos WHERE lead = ?").bind(leadId).first<Demo>();
  const knowledge = existing?.knowledge ?? (await readWebsite(lead.web));
  if (existing) {
    await env.DB.prepare("UPDATE demos SET services = COALESCE(?, services), hours = COALESCE(?, hours), knowledge = ? WHERE slug = ?")
      .bind(opts.services ?? null, opts.hours ?? null, knowledge, existing.slug).run();
    return (await env.DB.prepare("SELECT * FROM demos WHERE slug = ?").bind(existing.slug).first<Demo>())!;
  }
  const slug = slugify(shortName(lead.name));
  await env.DB.prepare(
    `INSERT INTO demos (slug, lead, business, city, category, knowledge, services, hours, rating, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(slug, leadId, shortName(lead.name), lead.city, lead.category, knowledge, opts.services ?? null, opts.hours ?? null, lead.rating ?? null, now()).run();
  await addNote(env, leadId, `🔗 Demo creada${knowledge ? " (leyó su web)" : ""}: ${base}/demo/${slug}`);
  return (await env.DB.prepare("SELECT * FROM demos WHERE slug = ?").bind(slug).first<Demo>())!;
}

export async function getDemo(env: Env, slug: string): Promise<Demo | null> {
  return env.DB.prepare("SELECT * FROM demos WHERE slug = ?").bind(slug).first<Demo>();
}

/** Visita a la página (cuenta vistas; los avisos los manda el radar desde el navegador). */
export async function trackView(env: Env, d: Demo): Promise<void> {
  await env.DB.prepare("UPDATE demos SET views = views + 1, last_view_at = ? WHERE slug = ?").bind(now(), d.slug).run();
}

// ── Radar en vivo: el recorrido del prospecto dentro de la demo ─────────────

type Session = { id: string; slug: string; device: string | null; started_at: string; last_at: string; messages: number; voice: number; photos: number; resets: number; booked: string | null; transcript: string | null; summary_sent: number };

const sid = (v: unknown) => /^[a-z0-9-]{8,40}$/i.test(String(v ?? "")) ? String(v) : null;

async function session(env: Env, d: Demo, id: string, device?: string | null): Promise<{ s: Session; isNew: boolean }> {
  const ins = await env.DB.prepare("INSERT OR IGNORE INTO demo_sessions (id, slug, device, started_at, last_at) VALUES (?, ?, ?, ?, ?)")
    .bind(id, d.slug, device ?? null, now(), now()).run();
  const s = (await env.DB.prepare("SELECT * FROM demo_sessions WHERE id = ? AND slug = ?").bind(id, d.slug).first<Session>())!;
  return { s, isNew: (ins.meta?.changes ?? 0) > 0 };
}

function minutes(from: string, to = now()): string {
  const m = Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 60000));
  return m < 1 ? "menos de 1 min" : `${m} min`;
}

/** Eventos que manda la página: abrió, reinició, salió. */
export async function demoEvent(env: Env, d: Demo, body: any): Promise<void> {
  const id = sid(body?.session);
  if (!id || body?.own) return;
  const type = String(body?.type ?? "");
  const device = body?.device === "móvil" ? "móvil" : "PC";
  const { s, isNew } = await session(env, d, id, device);
  if (type === "abrio" && isNew) {
    const prev = await env.DB.prepare("SELECT COUNT(*) n FROM demo_sessions WHERE slug = ? AND id != ?").bind(d.slug, id).first<{ n: number }>();
    const n = (prev?.n ?? 0) + 1;
    const txt = n === 1 ? `abrió su demo por primera vez (desde ${device})` : `volvió a abrir su demo (visita ${n}, desde ${device})`;
    await addNote(env, d.lead, `👀 ${txt[0].toUpperCase()}${txt.slice(1)}`);
    await notify(env, d.lead, "demo_abierta", txt);
  } else if (type === "reinicio") {
    await env.DB.prepare("UPDATE demo_sessions SET resets = resets + 1, last_at = ? WHERE id = ?").bind(now(), id).run();
    if (s.messages > 0) {
      await addNote(env, d.lead, `🔄 Reinició el chat de la demo después de ${s.messages} mensaje${s.messages === 1 ? "" : "s"} (está probando otro caso)`);
      await notify(env, d.lead, "demo_chat", `reinició la conversación para probar otro caso`);
    }
  } else if (type === "salio") {
    await summarize(env, d, id);
  }
}

/** Al salir: un resumen de la visita para usar en la llamada. */
async function summarize(env: Env, d: Demo, id: string): Promise<void> {
  const s = await env.DB.prepare("SELECT * FROM demo_sessions WHERE id = ?").bind(id).first<Session>();
  if (!s || s.summary_sent || s.messages === 0) return;
  await env.DB.prepare("UPDATE demo_sessions SET summary_sent = 1 WHERE id = ?").bind(id).run();
  const lines: string[] = JSON.parse(s.transcript || "[]");
  const asked = lines.filter((l) => l.startsWith("Él:")).map((l) => l.slice(4)).slice(0, 6);
  const extras = [s.voice && `${s.voice} nota${s.voice === 1 ? "" : "s"} de voz`, s.photos && `${s.photos} foto${s.photos === 1 ? "" : "s"}`, s.resets && `reinició ${s.resets} ${s.resets === 1 ? "vez" : "veces"}`].filter(Boolean).join(", ");
  const head = `salió de la demo tras ${minutes(s.started_at, s.last_at)} y ${s.messages} mensaje${s.messages === 1 ? "" : "s"}${extras ? ` (${extras})` : ""}${s.booked ? `; agendó ${s.booked}` : "; no llegó a agendar"}`;
  const body = asked.length ? `\nLo que probó: ${asked.map((a) => `“${a.slice(0, 90)}”`).join(" · ")}` : "";
  await addNote(env, d.lead, `📊 Resumen de la visita: ${head}.${body}`);
  await notify(env, d.lead, "demo_chat", `${head}.${body}`);
}

// ── Notas de voz y fotos ──────────────────────────────────────────────────

const b64bytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

async function transcribe(env: Env, b64: string): Promise<string> {
  try {
    const out: any = await env.AI.run("@cf/openai/whisper-large-v3-turbo" as any, { audio: b64 });
    if (String(out?.text ?? "").trim()) return String(out.text).trim();
  } catch (e) { console.error("whisper turbo", e); }
  const out: any = await env.AI.run("@cf/openai/whisper" as any, { audio: [...b64bytes(b64)] });
  return String(out?.text ?? "").trim();
}

async function describeImage(env: Env, b64: string, mime: string, caption: string): Promise<string> {
  const prompt = "Describe en español, en una o dos frases y sin diagnosticar, qué muestra esta foto que un paciente le mandó a su clínica dental por WhatsApp (por ejemplo: dientes, encías, una prótesis, una radiografía, un documento)." + (caption ? ` El paciente escribió: "${caption}".` : "");
  for (const model of (env.VISION_MODELS || "nvidia/nemotron-3.5-super-vl:free,google/gemma-4-31b-it:free").split(",").map((m) => m.trim()).filter(Boolean)) {
    try {
      const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST", headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, max_tokens: 150, messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } }] }] }),
      });
      if (!r.ok) throw new Error(`${r.status}`);
      const t = String(((await r.json()) as any)?.choices?.[0]?.message?.content ?? "").trim();
      if (t) return t;
    } catch (e) { console.error("vision", model, e); }
  }
  return "";
}

type InMsg = { role: string; content: string; media_type?: string; media_base64?: string; media_mime?: string };

/** Convierte el último mensaje (nota de voz o foto) en texto que el agente entiende. */
async function readMedia(env: Env, m: InMsg): Promise<{ text: string; kind: "voz" | "foto" | null }> {
  const caption = String(m.content ?? "").trim();
  const b64 = String(m.media_base64 ?? "");
  if (!b64 || b64.length > 6_000_000) return { text: caption, kind: null };
  if (m.media_type === "audio") {
    const heard = await transcribe(env, b64).catch(() => "");
    return { text: heard ? `[Nota de voz] ${heard}` : "[Nota de voz que no se pudo escuchar: pídele con amabilidad que la escriba]", kind: "voz" };
  }
  if (m.media_type === "image") {
    const seen = await describeImage(env, b64, String(m.media_mime || "image/jpeg"), caption);
    return { text: `[Foto: ${seen || "no se pudo ver bien la imagen"}]${caption ? ` ${caption}` : ""}`, kind: "foto" };
  }
  return { text: caption, kind: null };
}

export async function demoChat(env: Env, d: Demo, history: InMsg[], own = false, sessionId?: unknown): Promise<{ text: string; booking: Booking | null; user_text: string }> {
  const today = new Date().toISOString().slice(0, 10);
  const used = await env.DB.prepare("SELECT COUNT(*) n FROM demo_messages WHERE slug = ? AND day = ?").bind(d.slug, today).first<{ n: number }>();
  if ((used?.n ?? 0) >= DAILY_LIMIT) return { text: "Por hoy la demo llegó a su límite de mensajes 🙏 Escríbele a Daniel y te la deja activa.", booking: null, user_text: "" };
  const last = history.at(-1);
  const media = last?.role === "user" && last.media_base64 ? await readMedia(env, last) : { text: String(last?.content ?? ""), kind: null };
  const msgs = history.slice(-12).map((m, i, all) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: (i === all.length - 1 && m.role === "user" ? media.text : String(m.content ?? "")).slice(0, 800),
  }));
  const split = splitAction(await complete(env, [{ role: "system", content: compileDemoPrompt({ ...d, tz: zoneFor(d.lead) }, TONE) }, ...msgs], 900, { models: env.DEMO_MODEL }));
  const text = split.text.replace(/\*\*(.+?)\*\*/g, "$1").replace(/__(.+?)__/g, "$1"); // WhatsApp no muestra markdown
  // Un modelo más débil a veces pone la etiqueta antes de tener el nombre: sin nombre real no hay cita.
  const name = String(split.booking?.client_name ?? "").trim();
  let booking = split.booking && name && !/^<|nombre|cliente|name/i.test(name) ? split.booking : null;
  // Ya agendada en la conversación: una confirmación repetida no es una cita nueva.
  const already = history.some((m) => m.role === "assistant" && /\[cita registrada: /.test(String(m.content ?? "")));
  if (booking && already && history.some((m) => m.role === "assistant" && String(m.content ?? "").includes(`[cita registrada: ${name}`))) booking = null;
  await env.DB.prepare("INSERT INTO demo_messages (slug, day, created_at) VALUES (?, ?, ?)").bind(d.slug, today, now()).run();
  const id = sid(sessionId);
  if (!own && id) {
    const { s } = await session(env, d, id);
    const lines: string[] = JSON.parse(s.transcript || "[]");
    lines.push(`Él: ${media.text.slice(0, 200)}`, `IA: ${text.slice(0, 200)}`);
    const what = booking ? [booking.client_name, booking.item_or_service, booking.datetime_or_details].filter(Boolean).join(" · ") : null;
    await env.DB.prepare("UPDATE demo_sessions SET messages = messages + 1, voice = voice + ?, photos = photos + ?, last_at = ?, transcript = ?, booked = COALESCE(?, booked) WHERE id = ?")
      .bind(media.kind === "voz" ? 1 : 0, media.kind === "foto" ? 1 : 0, now(), JSON.stringify(lines.slice(-24)), what, id).run();
    await env.DB.prepare("UPDATE demos SET messages = messages + 1 WHERE slug = ?").bind(d.slug).run();
    if (s.messages === 0) {
      await addNote(env, d.lead, `💬 Empezó a chatear con el agente: “${media.text.slice(0, 160)}”`);
      await notify(env, d.lead, "demo_chat", `empezó a chatear con el agente. Primer mensaje: “${media.text.slice(0, 140)}”`);
    } else if (media.kind) {
      await addNote(env, d.lead, media.kind === "voz" ? `🎤 Mandó una nota de voz: ${media.text.slice(14, 180)}` : `📸 Mandó una foto: ${media.text.slice(0, 180)}`);
    }
    if (booking) {
      await env.DB.prepare("UPDATE demos SET bookings = bookings + 1 WHERE slug = ?").bind(d.slug).run();
      await addNote(env, d.lead, `📅 Agendó una cita de prueba en la demo: ${what}`);
      await notify(env, d.lead, "cita", `cerró una cita en la demo (${what}) tras ${s.messages + 1} mensajes`);
    }
  }
  return { text, booking, user_text: media.text };
}

/** Página pública de la demo (sin contraseña). */
export function renderDemo(d: Demo, contact: string | null): string {
  return renderDemoPage(d, contact);
}
