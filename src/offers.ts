// Oferta por nicho: "Ayudo a {nicho} a {resultado} en {plazo} sin {lo que más odian}".
// La apertura se arma con esta fórmula; cada nicho tiene sus variables, editables en el panel.
import type { Env } from "./crm.ts";
import { TONE } from "./brain.ts";

export const OPENER_V = 3; // versión de la fórmula: las aperturas más viejas se reescriben

export type Offer = {
  niche_key: string; niche: string; result: string; timeframe: string; pain: string;
  question_a: string | null; cta_b: string | null; status: "aprobada" | "sugerida";
};

export const nicheKey = (s: unknown) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** "Clínica Dental Comfortdent | Dra. X - Implantes" → "Clínica Dental Comfortdent" */
export function shortName(name: string): string {
  const s = String(name ?? "").split(/\s[|·–—-]\s|[|(]/)[0].trim();
  return s.length > 48 ? s.slice(0, 48).replace(/\s+\S*$/, "") : s;
}

export const DEFAULT_A = "¿Hoy quién les contesta el WhatsApp cuando están llenos o fuera de horario?";
export const defaultB = (short: string) => `¿Te muestro en 2 minutos cómo se vería en ${short}?`;

export function buildOpener(lead: { name: string }, o: Pick<Offer, "niche" | "result" | "timeframe" | "pain" | "question_a" | "cta_b">, variant: string): string {
  const short = shortName(lead.name);
  const pain = o.pain.replace(/^sin\s+/i, "");
  const pitch = `Hola, ¿hablo con ${short}? Soy Daniel y ayudo a ${o.niche} a ${o.result.replace(/^a\s+/i, "")} en ${o.timeframe.replace(/^en\s+/i, "")} sin ${pain}.`;
  const close = variant === "B" ? (o.cta_b?.replaceAll("{negocio}", short) || defaultB(short)) : (o.question_a || DEFAULT_A);
  return `${pitch}\n\n${close}`;
}

export async function listOffers(env: Env): Promise<Offer[]> {
  const r = await env.DB.prepare("SELECT * FROM offers ORDER BY status = 'aprobada', niche").all<Offer>();
  return r.results ?? [];
}

export async function saveOffer(env: Env, o: Partial<Offer> & { niche: string }): Promise<Offer> {
  const key = nicheKey(o.niche);
  await env.DB.prepare(
    `INSERT INTO offers (niche_key, niche, result, timeframe, pain, question_a, cta_b, status, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
     ON CONFLICT(niche_key) DO UPDATE SET niche = ?2, result = ?3, timeframe = ?4, pain = ?5, question_a = ?6, cta_b = ?7, status = ?8, updated_at = ?9`,
  ).bind(key, o.niche.trim(), (o.result ?? "").trim(), (o.timeframe ?? "").trim(), (o.pain ?? "").trim(),
    o.question_a?.trim() || null, o.cta_b?.trim() || null, o.status ?? "aprobada", new Date().toISOString()).run();
  // Las aperturas de ese nicho que aún no salieron se rehacen con la oferta nueva.
  await env.DB.prepare("UPDATE leads SET opener_v = NULL WHERE status IN ('hoy','cola') AND opener IS NOT NULL").run();
  return (await env.DB.prepare("SELECT * FROM offers WHERE niche_key = ?").bind(key).first<Offer>())!;
}

/** La oferta del nicho; si no hay, la IA propone una (queda como "sugerida" para que la revises). */
export async function offerFor(env: Env, niche: string | null): Promise<Offer> {
  const label = (niche || "negocios locales").trim();
  const key = nicheKey(label);
  const found = await env.DB.prepare("SELECT * FROM offers WHERE niche_key = ?").bind(key).first<Offer>();
  if (found) return found;
  const s = await suggestOffer(env, label).catch(() => null);
  return saveOffer(env, {
    niche: label,
    result: s?.result || "atender cada mensaje de WhatsApp en segundos",
    timeframe: s?.timeframe || "30 días",
    pain: s?.pain || "contratar a más personal",
    status: "sugerida",
  });
}

export async function suggestOffer(env: Env, niche: string): Promise<{ result: string; timeframe: string; pain: string }> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: env.OPENROUTER_MODEL, max_tokens: 200,
      messages: [{
        role: "system",
        content: [
          "Completa la fórmula de oferta: 'Ayudo a {nicho} a {resultado} en {plazo} sin {lo que más odian}'.",
          "Vendemos un asistente de IA en WhatsApp + CRM que contesta al instante, agenda citas y hace seguimiento.",
          "resultado: empieza con verbo en infinitivo, concreto y medible, realista (nada exagerado). plazo: corto, ej. '60 días'. lo que más odian: lo que ese nicho detesta hacer o pagar, sin la palabra 'sin'.",
          TONE,
          'Responde SOLO JSON: {"result":"...","timeframe":"...","pain":"..."}',
        ].join("\n"),
      }, { role: "user", content: `Nicho: ${niche}` }],
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter → ${res.status}`);
  const raw = String(((await res.json()) as any)?.choices?.[0]?.message?.content ?? "");
  const j = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
  return { result: String(j.result ?? ""), timeframe: String(j.timeframe ?? ""), pain: String(j.pain ?? "") };
}
