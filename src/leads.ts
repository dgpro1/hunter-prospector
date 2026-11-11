// Canal 1 · Prospector: cola de leads del Cazador, cupo diario y aperturas personalizadas.
import type { Env } from "./crm.ts";
import { addNote, setStage } from "./store.ts";
import { toneFor } from "./brain.ts";
import { buildOpener, offerFor, OPENER_V } from "./offers.ts";

export type Lead = {
  phone: string; name: string; niche: string | null; city: string | null; web: string | null;
  category: string | null; rating: number | null; confidence: string | null; maps_url: string | null;
};

/** Solo dígitos con código de país, como los quiere wa.me. Null si no parece un número válido. */
export function normalizePhone(raw: unknown): string | null {
  const digits = String(raw ?? "").replace(/^.*wa\.me\//, "").replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15 ? digits : null;
}

/** Lee un CSV sencillo (con comillas) y devuelve objetos por cabecera. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((v) => v !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((v) => v !== "")) rows.push(row);
  const [head, ...body] = rows;
  if (!head) return [];
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), r[i] ?? ""])));
}

/** Convierte el archivo del Cazador (JSON o CSV) en leads con WhatsApp. */
export function parseHunt(text: string): Lead[] {
  let raw: any[];
  const trimmed = text.replace(/^﻿/, "").trim();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    const data = JSON.parse(trimmed);
    raw = Array.isArray(data) ? data : Array.isArray(data?.leads) ? data.leads : [];
  } else raw = parseCsv(trimmed);
  const out: Lead[] = [];
  for (const r of raw) {
    const phone = normalizePhone(r.whatsapp || r.enlace_whatsapp || r.whatsapp_osm);
    const name = String(r.nombre ?? "").trim();
    if (!phone || !name) continue;
    const rating = parseFloat(String(r.rating ?? "").replace(",", "."));
    out.push({
      phone, name,
      niche: r.nicho || null, city: r.ciudad || null, web: r.web || null, category: r.categoria || null,
      rating: Number.isFinite(rating) ? rating : null, confidence: r.confianza || null, maps_url: r.google_maps_url || null,
    });
  }
  return out;
}

/** Fecha de hoy en Bogotá (YYYY-MM-DD): el cupo se reinicia a medianoche de Daniel. */
export function today(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(date);
}

export async function importLeads(env: Env, leads: Lead[], batch: string): Promise<{ added: number; repeated: number; blocked: number }> {
  let added = 0, repeated = 0, blocked = 0;
  const at = new Date().toISOString();
  for (const l of leads) {
    const dnc = await env.DB.prepare("SELECT 1 FROM do_not_contact WHERE key = ?").bind(l.phone).first();
    if (dnc) { blocked++; continue; }
    const res = await env.DB.prepare(
      `INSERT OR IGNORE INTO leads (phone, name, niche, city, web, category, rating, confidence, maps_url, batch, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(l.phone, l.name, l.niche, l.city, l.web, l.category, l.rating, l.confidence, l.maps_url, batch, at, at).run();
    if (res.meta.changes) added++; else repeated++;
  }
  return { added, repeated, blocked };
}

export async function getQuota(env: Env): Promise<number> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'daily_quota'").first<{ value: string }>();
  const n = parseInt(row?.value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : 20;
}

export async function setQuota(env: Env, n: number): Promise<void> {
  const q = Math.max(1, Math.min(60, Math.round(n)));
  await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('daily_quota', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(String(q)).run();
}

/** Llena el cupo de hoy con los mejores de la cola (confianza alta y mejor rating primero) y les redacta la apertura. */
export async function fillToday(env: Env): Promise<number> {
  const day = today();
  const used = await env.DB.prepare("SELECT COUNT(*) AS n FROM leads WHERE day = ? AND status IN ('hoy','enviado')").bind(day).first<{ n: number }>();
  const room = (await getQuota(env)) - (used?.n ?? 0);
  if (room <= 0) return 0;
  const picked = await env.DB.prepare(
    `SELECT * FROM leads WHERE status = 'cola'
     ORDER BY CASE confidence WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END, COALESCE(rating, 0) DESC, created_at
     LIMIT ?`,
  ).bind(room).all<any>();
  const list = picked.results ?? [];
  // De 5 en 5 para no saturar OpenRouter ni el límite de subpeticiones.
  for (let i = 0; i < list.length; i += 5) {
    await Promise.all(list.slice(i, i + 5).map(async (lead: any, j: number) => {
      const variant = (i + j + (used?.n ?? 0)) % 2 === 0 ? "A" : "B";
      const opener = await composeOpener(env, lead, variant);
      await env.DB.prepare("UPDATE leads SET status = 'hoy', day = ?, variant = ?, opener = ?, opener_v = ? WHERE phone = ?")
        .bind(day, variant, opener, OPENER_V, lead.phone).run();
    }));
  }
  return list.length;
}

const VARIANT: Record<string, string> = {
  A: "Variante A (pregunta espejo): preséntate en una línea y haz UNA pregunta concreta sobre cómo atienden WhatsApp (fuera de horario, cuánto tardan, quién contesta). No ofrezcas nada todavía.",
  B: "Variante B (demo directa): preséntate en una línea y ofrece mostrarle gratis cómo un asistente contestaría a SUS clientes por WhatsApp en segundos. Termina con una pregunta de sí o no.",
};

/** Apertura con la fórmula de la oferta del nicho (sin IA: siempre igual de clara). */
export async function composeOpener(env: Env, lead: any, variant: string): Promise<string> {
  try {
    return buildOpener(lead, await offerFor(env, lead.niche), variant);
  } catch {
    return fallbackOpener(lead, variant);
  }
}

export async function writeOpener(env: Env, lead: any, variant: string): Promise<string> {
  const system = [
    "Eres Daniel, de Hunter AI. Escribes el PRIMER mensaje de WhatsApp a un negocio que encontraste en Google Maps.",
    "Honesto: di que eres Daniel de Hunter AI y que los encontraste en Google; nunca te hagas pasar por cliente.",
    "Máximo 3 frases cortas, cercano y premium, como mucho 1 emoji, sin precios, sin links, sin markdown.",
    toneFor(lead.phone),
    VARIANT[variant] ?? VARIANT.A,
    "Usa signos de apertura (¡ ¿). Escribe UN SOLO mensaje, de la variante indicada: sin títulos, sin etiquetas, sin opciones ni explicaciones.",
    "Devuelve solo el texto del mensaje.",
  ].join("\n");
  const about = [
    `Negocio: ${lead.name}`, lead.category && `Categoría: ${lead.category}`, lead.city && `Ciudad: ${lead.city}`,
    lead.rating && `Rating en Google: ${lead.rating}`, lead.web && `Web: ${lead.web}`,
  ].filter(Boolean).join("\n");
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: env.OPENROUTER_MODEL, max_tokens: 200, messages: [{ role: "system", content: system }, { role: "user", content: about }] }),
  });
  if (!res.ok) throw new Error(`OpenRouter → ${res.status}`);
  const data: any = await res.json();
  const text = cleanOpener(String(data?.choices?.[0]?.message?.content ?? ""));
  if (!text) throw new Error("vacío");
  return text;
}

/** Quita títulos, etiquetas y segundas versiones que a veces añade el modelo: deja un solo mensaje. */
export function cleanOpener(raw: string): string {
  const lines = raw.replace(/\*\*/g, "").split("\n")
    .filter((l) => !/^\s*#/.test(l) && !/^\s*(variante|opción|option)\b[^:]*:?\s*$/i.test(l.trim()))
    .map((l) => l.replace(/^\s*(variante|opción)\s*[ab12]?\s*[:\-–]\s*/i, ""));
  const paras = lines.join("\n").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  for (const p of paras) {
    if (out.length && /^(¡?hola|buen[oa]s)/i.test(p)) break; // empieza otra versión
    out.push(p);
  }
  return out.join("\n\n").replace(/^"|"$/g, "").trim();
}

export function fallbackOpener(lead: any, variant: string): string {
  const name = String(lead.name ?? "").split(/[|·-]/)[0].trim();
  return variant === "B"
    ? `Hola, ¿hablo con ${name}? Soy Daniel, de Hunter AI. Los encontré en Google y les preparé una idea: un asistente que contesta a sus clientes por WhatsApp en segundos, a cualquier hora. ¿Te la muestro?`
    : `Hola, ¿hablo con ${name}? Soy Daniel, de Hunter AI. Los encontré en Google y tengo una pregunta rápida: ¿quién les contesta el WhatsApp de noche y los fines de semana?`;
}

export async function markLead(env: Env, phone: string, action: "enviado" | "descartado" | "no_contactar", opener?: string): Promise<void> {
  const at = new Date().toISOString();
  if (action === "enviado") {
    await env.DB.prepare("UPDATE leads SET status = 'enviado', sent_at = ?, opener = COALESCE(?, opener), updated_at = ? WHERE phone = ?").bind(at, opener ?? null, at, phone).run();
    await setStage(env, phone, "contactado", "primer mensaje enviado");
  } else {
    await env.DB.prepare("UPDATE leads SET status = 'descartado', updated_at = ? WHERE phone = ?").bind(at, phone).run();
    await addNote(env, phone, action === "no_contactar" ? "Marcado como No contactar" : "Saltado en la cola");
    if (action === "no_contactar") {
      await env.DB.prepare("INSERT OR IGNORE INTO do_not_contact (key, reason, created_at) VALUES (?, ?, ?)").bind(phone, "descartado en la cola", at).run();
    }
  }
}

/** Reescribe las aperturas aún no enviadas (de a `max`). Devuelve cuántas quedan pendientes. */
export async function rewriteOpeners(env: Env, max = 10): Promise<number> {
  const rows = await env.DB.prepare("SELECT * FROM leads WHERE status = 'hoy' AND (opener_v IS NULL OR opener_v < ?) LIMIT ?").bind(OPENER_V, max).all<any>();
  for (let i = 0; i < (rows.results ?? []).length; i += 5) {
    await Promise.all((rows.results ?? []).slice(i, i + 5).map(async (lead: any) => {
      const variant = lead.variant ?? "A";
      const opener = await composeOpener(env, lead, variant);
      await env.DB.prepare("UPDATE leads SET opener = ?, opener_v = ? WHERE phone = ?").bind(opener, OPENER_V, lead.phone).run();
    }));
  }
  const left = await env.DB.prepare("SELECT COUNT(*) n FROM leads WHERE status = 'hoy' AND (opener_v IS NULL OR opener_v < ?)").bind(OPENER_V).first<{ n: number }>();
  return left?.n ?? 0;
}
