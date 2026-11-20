// Agente Cerrador: desde la primera respuesta de una persona toma el chat, envía la demo y lleva a una llamada con Daniel.
// Escribe como Daniel. Todo sale por el CRM (/reply) y la cita queda en el calendario del CRM, que la sube a Google Calendar.
import type { Env } from "./crm.ts";
import { bookCall, freeTimes, messages, reply } from "./crm.ts";
import type { Msg } from "./timer.ts";
import { toneFor } from "./brain.ts";
import { cleanHours, inWindow, setting, zoneFor, type Hours } from "./auto.ts";
import { addNote, setStage } from "./store.ts";
import { notify } from "./alerts.ts";
import { createDemo } from "./demo.ts";

export type Mode = "apagado" | "sombra" | "auto";
export type AgentStage = "conversando" | "demo_enviada" | "llamada_propuesta" | "agendada" | "traspaso" | "dormido" | "cerrado";
export type Action = "responder" | "enviar_demo" | "proponer_llamada" | "agendar" | "traspaso";
export type Decision = { action: Action; message: string; slot: number | null; price: boolean; reason: string };
export type State = {
  conversation_id: string; lead: string | null; stage: AgentStage; followups: number; price_asks: number;
  slots: string | null; handoff_reason: string | null; last_in_at: string | null; last_out_at: string | null;
  created_at: string; updated_at: string;
};

export const MODE_LABEL: Record<Mode, string> = { apagado: "Apagado", sombra: "Sombra (tú apruebas)", auto: "Automático" };
const ACTIONS: Action[] = ["responder", "enviar_demo", "proponer_llamada", "agendar", "traspaso"];
/** Días de espera antes de cada seguimiento sin respuesta: día 1, día 3 y día 7. */
export const FOLLOWUP_GAP_DAYS = [1, 2, 4];
/** Horario en que el agente escribe, en la hora del negocio. */
export const AGENT_HOURS: Hours = { from: 8, to: 21, days: [0, 1, 2, 3, 4, 5, 6] };
/** Horario de llamadas de Daniel (hora de Bogotá) cuando el CRM no puede dar la disponibilidad: 10 a 20 h, todos los días. */
export const CALL_HOURS: Hours = { from: 10, to: 20, days: [0, 1, 2, 3, 4, 5, 6] };
export const CALL_MINUTES = 15;
const DANIEL_TZ = "America/Bogota";

const now = () => new Date().toISOString();
const ts = (s: string | null | undefined) => (s ? Date.parse(s) : NaN);

export async function agentMode(env: Env): Promise<Mode> {
  const m = await setting(env, "agent_mode");
  return m === "sombra" || m === "auto" ? m : "apagado";
}

// ── Reglas sin IA ───────────────────────────────────────────────────────────

const BOT_QUESTION = /\b(eres|sos|es usted|hablo con|estoy hablando con|me responde|me contesta)\b[^?\n]{0,30}\b(un |una )?(bot|robot|ia|i\.a\.|inteligencia artificial|m[aá]quina|autom[aá]tico|chatbot|persona real|humano)\b|^\s*¿?\s*(bot|robot|chatbot)\s*\??\s*$/i;
const WANTS_PERSON = /(hablar|comunicarme|hablo|contactar)\s+con\s+(una persona|un humano|alguien real|un asesor|daniel en persona)/i;
const HOSTILE = /(denunci|abogad|demanda(r|rte|rlos)?\b|acoso|estafa|fraude|polic[ií]a|profeco|te voy a reportar|los voy a reportar|reportarte)/i;
export const PRICE = /(precio|cu[aá]nto (cuesta|cobra|vale|sale|es)|costo|tarifa|inversi[oó]n|mensualidad|cotizaci[oó]n|presupuesto)/i;

/** Casos en que el agente se calla y te pasa el chat, sin preguntarle a la IA. */
export function hardRule(text: string, state: Pick<State, "stage" | "price_asks">): string | null {
  if (state.stage === "agendada") return "escribió después de agendar la llamada";
  if (BOT_QUESTION.test(text)) return "preguntó si habla con un bot";
  if (WANTS_PERSON.test(text)) return "pidió hablar con una persona";
  if (HOSTILE.test(text)) return "mensaje molesto o legal";
  if (PRICE.test(text) && state.price_asks >= 2) return "insiste en el precio";
  return null;
}

const norm = (s: string) => String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase().slice(0, 80);

/**
 * ¿Escribió Daniel en el chat? Un mensaje nuestro (saliente) posterior a que el agente tomó el chat
 * que no es ninguno de los que envió el agente. Mientras el CRM no avise de los mensajes enviados,
 * esta es la forma de no pisarte.
 */
export function danielSpoke(history: Msg[], since: string, ours: string[]): boolean {
  const mine = new Set(ours.map(norm));
  const from = ts(since);
  return history.some((m) =>
    (m.kind ?? "message") === "message" && m.role !== "user" && m.sender_type !== "ai" &&
    ts(m.created_at) > from && !mine.has(norm(m.content)));
}

// ── Horarios para la llamada ────────────────────────────────────────────────

function localParts(iso: string, tz: string) {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "numeric", hourCycle: "h23" }).formatToParts(new Date(iso));
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return { day: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) };
}

/** Elige hasta n horarios repartidos: el primero con al menos 90 min de margen y luego otras mitades del día. */
export function pickSlots(free: string[], at: Date, n = 3): string[] {
  const min = at.getTime() + 90 * 60_000;
  const picked: string[] = [];
  const used = new Set<string>();
  for (const s of [...free].sort((a, b) => ts(a) - ts(b))) {
    if (ts(s) < min) continue;
    const { day, hour } = localParts(s, DANIEL_TZ);
    const half = `${day}-${hour < 14 ? "am" : "pm"}`;
    if (used.has(half)) continue;
    used.add(half);
    picked.push(s);
    if (picked.length >= n) break;
  }
  return picked;
}

/** Cuadrícula de 30 min en el horario de llamadas de Daniel (Bogotá, UTC-5 sin horario de verano). */
export function gridTimes(at: Date, days: number, hours: Hours = CALL_HOURS): string[] {
  const out: string[] = [];
  const startDay = new Date(at.getTime() - 5 * 3600_000);
  for (let d = 0; d < days; d++) {
    const base = Date.UTC(startDay.getUTCFullYear(), startDay.getUTCMonth(), startDay.getUTCDate() + d);
    const weekday = new Date(base).getUTCDay();
    if (!hours.days.includes(weekday)) continue;
    for (let h = hours.from; h < hours.to; h += 0.5) out.push(new Date(base + (h + 5) * 3600_000).toISOString());
  }
  return out;
}

/** "jueves 26 de nov., 3:30 p. m." en la hora de quien lo lee. */
export function slotLabel(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("es-MX", { timeZone: tz, weekday: "long", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

export function zoneName(tz: string): string {
  return ({ "America/Mexico_City": "hora de México", "Europe/Madrid": "hora de España", "America/New_York": "hora del Este de EE. UU.", "America/Bogota": "hora de Colombia" } as Record<string, string>)[tz] ?? tz;
}

async function callHours(env: Env): Promise<Hours> {
  try { return cleanHours(JSON.parse((await setting(env, "agent_call_hours")) || "null")) ?? CALL_HOURS; } catch { return CALL_HOURS; }
}

/** Huecos libres para la llamada: los del calendario del CRM (con Google Calendar); si no responde, tu horario fijo. */
export async function callSlots(env: Env, at = new Date()): Promise<{ slots: string[]; source: "crm" | "horario" }> {
  const from = new Date(at.getTime() - 5 * 3600_000).toISOString().slice(0, 10);
  const to = new Date(at.getTime() + 4 * 86400_000).toISOString().slice(0, 10);
  try {
    const free = await freeTimes(env, from, to, CALL_MINUTES);
    const slots = pickSlots(free, at);
    if (slots.length) return { slots, source: "crm" };
  } catch (e) {
    console.error("freeTimes", e);
  }
  return { slots: pickSlots(gridTimes(at, 4, await callHours(env)), at), source: "horario" };
}

// ── Decidir ─────────────────────────────────────────────────────────────────

export type Llm = (system: string, convo: { role: string; content: string }[]) => Promise<string>;

export const openRouter = (env: Env): Llm => async (system, convo) => {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: env.OPENROUTER_MODEL, max_tokens: 500, messages: [{ role: "system", content: system }, ...convo] }),
  });
  if (!res.ok) throw new Error(`OpenRouter → ${res.status}`);
  return String(((await res.json()) as any)?.choices?.[0]?.message?.content ?? "");
};

export type Context = {
  business: string; phone: string; stage: AgentStage; demoUrl: string | null; demoViewed: boolean;
  slots: string[]; followup: number | null; summary?: string; priceAsks: number; cases?: string;
};

const STAGE_GOAL: Record<AgentStage, string> = {
  conversando: "Todavía no tiene la demo. Resuelve lo que pregunte y llévalo a aceptar ver su demo personalizada.",
  demo_enviada: "Ya tiene el link de su demo. Pregunta qué le pareció o anímalo a abrirla, y cuando muestre interés propón la llamada.",
  llamada_propuesta: "Ya le ofreciste horarios para la llamada. Ayúdalo a elegir uno; si elige, agenda.",
  agendada: "La llamada ya está agendada.",
  traspaso: "Daniel lleva este chat.",
  dormido: "No respondía; volvió a escribir. Retoma con calidez desde donde quedó.",
  cerrado: "Dijo que no le interesa.",
};

export function systemPrompt(c: Context): string {
  const tz = zoneFor(c.phone);
  const slots = c.slots.map((s, i) => `${i + 1}) ${slotLabel(s, tz)} (${zoneName(tz)})`).join("\n");
  return [
    "Eres Daniel, fundador de Hunter AI, y escribes tú mismo por WhatsApp a un negocio al que le escribiste primero.",
    "Vendes asistentes de IA para WhatsApp que responden en segundos 24/7, agendan citas directo en el calendario y hacen seguimiento a quien no responde, con un CRM detrás.",
    toneFor(c.phone),
    `Negocio: ${c.business}.`,
    "Meta de esta conversación: que acepte ver su demo personalizada y después agendar una llamada de 15 minutos contigo.",
    `Etapa: ${STAGE_GOAL[c.stage]}`,
    `Demo: ${c.demoUrl ? `ya se la enviaste (${c.demoViewed ? "ya la abrió" : "todavía no la abre"})` : "todavía no se la envías"}.`,
    c.followup !== null
      ? `Esto es un SEGUIMIENTO (#${c.followup + 1}): no ha respondido a tu último mensaje. Escribe un mensaje breve y amable que retome la conversación sin presionar ni reclamar. ${c.followup >= 2 ? "Es el último: déjale la puerta abierta." : ""}`
      : "",
    c.summary ? `Lo último que dijo el negocio: ${c.summary}` : "",
    c.cases ? `Datos verdaderos que puedes usar si vienen al caso: ${c.cases}` : "",
    "",
    "Reglas:",
    "- Responde a lo que realmente dijo. Corto: 1 a 3 frases, una sola pregunta o acción, máximo 1–2 emojis, sin listas ni markdown.",
    "- No repitas lo que ya dijiste en mensajes anteriores ni vuelvas a presentarte.",
    `- Nunca des precios por chat: di que depende de lo que necesite y que en la llamada de 15 minutos le das números exactos.${c.priceAsks >= 1 ? " Ya preguntó el precio antes: propón la llamada con horarios." : ""}`,
    "- Nunca inventes clientes, nombres, cifras, integraciones ni garantías. Si no sabes algo con certeza, di que se lo confirmas en la llamada.",
    "- Si propones la llamada, ofrece 2 de los horarios disponibles, escritos tal cual.",
    "",
    "Acciones (elige UNA):",
    "- responder: contestar y avanzar hacia la meta.",
    `- enviar_demo: cuando acepta ver la demo o muestra interés claro${c.demoUrl ? " o pide que se la reenvíes" : ""}. Escribe una frase cálida y {DEMO} donde va el link.`,
    "- proponer_llamada: cuando ya tiene la demo y muestra interés, pregunta el precio o pide hablar. Ofrece 2 horarios.",
    "- agendar: SOLO si eligió claramente uno de los horarios disponibles. Pon su número en \"slot\" y confirma día y hora en el mensaje. Si pide otro horario que no está en la lista, usa proponer_llamada con los más cercanos y NO confirmes nada.",
    "- traspaso: si se molesta, pide algo que no puedes resolver o el tema se sale de la venta. Deja \"message\" vacío.",
    "",
    slots ? `Horarios disponibles para la llamada:\n${slots}` : "No hay horarios disponibles ahora: si quiere llamada, dile que le confirmas el horario en un rato y usa traspaso.",
    "",
    'Responde SOLO con JSON: {"action":"responder|enviar_demo|proponer_llamada|agendar|traspaso","message":"texto listo para enviar","slot":null,"price":false,"reason":"por qué, en pocas palabras"}',
    '"price": true si en su último mensaje pregunta por precio o costo.',
  ].filter((l) => l !== "").join("\n");
}

/** Lee la respuesta JSON de la IA; cualquier cosa rara se vuelve un traspaso (mejor callar que decir algo malo). */
/** Cuando la IA confirma un horario sin decir su número: lo busca por día y hora en el texto (solo si es uno). */
export function matchSlot(message: string, slots: string[], tz: string): number | null {
  const hits = slots.map((s, i) => {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, day: "numeric", hour: "numeric", minute: "2-digit", hourCycle: "h12" }).formatToParts(new Date(s));
    const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
    const time = new RegExp(`\\b${g("hour")}(:${g("minute")})?\\s*(a\\.?\\s?m|p\\.?\\s?m|h\\b)`, "i");
    return new RegExp(`\\b${g("day")}\\b`).test(message) && time.test(message) ? i + 1 : 0;
  }).filter(Boolean);
  return hits.length === 1 ? hits[0] : null;
}

export function parseDecision(raw: string, slotCount: number, guess?: (message: string) => number | null): Decision {
  try {
    const json = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
    const action: Action = ACTIONS.includes(json.action) ? json.action : "traspaso";
    const message = String(json.message ?? "").trim();
    const n = Number(json.slot);
    let slot = Number.isInteger(n) && n >= 1 && n <= slotCount ? n : null;
    if (json.action === "agendar" && slot === null && guess) slot = guess(message);
    const d: Decision = { action, message, slot, price: Boolean(json.price), reason: String(json.reason ?? "").slice(0, 200) };
    // Quiso agendar pero no dijo cuál horario: no se confirma nada sin cita; lo revisas tú.
    if (d.action === "agendar" && d.slot === null) return { ...d, action: "traspaso", reason: "quiso agendar un horario que no está en la lista" };
    if (d.action !== "traspaso" && !d.message) return { ...d, action: "traspaso", reason: "la IA no escribió mensaje" };
    return d;
  } catch {
    return { action: "traspaso", message: "", slot: null, price: false, reason: "la IA respondió algo ilegible" };
  }
}

export async function decide(llm: Llm, c: Context, history: Msg[], autoTimes: string[] = []): Promise<Decision> {
  const convo = history
    .filter((m) => (m.kind ?? "message") === "message")
    .slice(-16)
    .map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: autoTimes.includes(m.created_at) ? `[AUTOMÁTICO] ${m.content}` : String(m.content ?? "") }));
  if (c.followup !== null) convo.push({ role: "user", content: "[Sin respuesta. Escribe el seguimiento.]" });
  return parseDecision(await llm(systemPrompt(c), convo), c.slots.length, (m) => matchSlot(m, c.slots, zoneFor(c.phone)));
}

/** Pone el link de la demo en el mensaje. */
export function withDemo(message: string, url: string): string {
  if (message.replaceAll("{DEMO}", "").trim().length < 12) return `¡Listo! Aquí tienes tu demo personalizada 👇\n${url}`;
  return message.includes("{DEMO}") ? message.replaceAll("{DEMO}", url) : `${message}\n${url}`;
}

// ── Estado ──────────────────────────────────────────────────────────────────

export async function getState(env: Env, conversationId: string): Promise<State | null> {
  return env.DB.prepare("SELECT * FROM agent_state WHERE conversation_id = ?").bind(conversationId).first<State>();
}

async function ensureState(env: Env, conversationId: string, lead: string): Promise<State> {
  await env.DB.prepare("INSERT OR IGNORE INTO agent_state (conversation_id, lead, created_at, updated_at) VALUES (?, ?, ?, ?)")
    .bind(conversationId, lead, now(), now()).run();
  return (await getState(env, conversationId))!;
}

async function patch(env: Env, conversationId: string, fields: Partial<State>): Promise<void> {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  await env.DB.prepare(`UPDATE agent_state SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE conversation_id = ?`)
    .bind(...keys.map((k) => (fields as any)[k]), now(), conversationId).run();
}

async function ourTexts(env: Env, conversationId: string): Promise<string[]> {
  const r = await env.DB.prepare("SELECT content FROM agent_sent WHERE conversation_id = ?").bind(conversationId).all<{ content: string }>();
  return (r.results ?? []).map((x) => x.content);
}

/** El agente se calla en este chat y te avisa (con lo que sugeriría responder, si lo hay). */
export async function handoff(env: Env, conversationId: string, lead: string, reason: string, suggestion = ""): Promise<void> {
  await patch(env, conversationId, { stage: "traspaso", handoff_reason: reason });
  await env.DB.prepare("UPDATE drafts SET status = 'descartado' WHERE conversation_id = ? AND status IN ('pendiente', 'programado')").bind(conversationId).run();
  if (suggestion) {
    await env.DB.prepare("INSERT INTO drafts (id, conversation_id, branch, text, created_at) VALUES (?, ?, 'agente:traspaso', ?, ?)")
      .bind(crypto.randomUUID(), conversationId, suggestion, now()).run();
  }
  await addNote(env, lead, `🙋 El agente te pasó el chat: ${reason}`);
  await notify(env, lead, "traspaso", `el agente te pasó el chat (${reason})${suggestion ? `. Sugiere: “${suggestion.slice(0, 160)}”` : ""}`);
}

// ── Turno del agente ────────────────────────────────────────────────────────

type Turn = {
  conversationId: string; lead: string; history: Msg[]; text: string; summary?: string; autoTimes?: string[];
  mode: Mode; llm?: Llm; followup?: number | null;
};

async function leadInfo(env: Env, lead: string) {
  const l = await env.DB.prepare("SELECT name, phone FROM leads WHERE phone = ?").bind(lead).first<{ name: string; phone: string }>();
  const d = await env.DB.prepare("SELECT slug, views FROM demos WHERE lead = ?").bind(lead).first<{ slug: string; views: number }>();
  return { business: l?.name ?? "el negocio", demoUrl: d ? `${env.PUBLIC_URL}/demo/${d.slug}` : null, demoViewed: Boolean(d?.views) };
}

/**
 * Responde un mensaje de una persona (o escribe un seguimiento). En modo sombra deja un borrador
 * para que lo apruebes; en automático lo programa con una pausa humana de 1 a 4 minutos.
 */
export async function agentTurn(env: Env, t: Turn): Promise<Decision | null> {
  const state = await ensureState(env, t.conversationId, t.lead);
  if (state.stage === "traspaso" || state.stage === "cerrado") return null;
  const isFollowup = t.followup !== undefined && t.followup !== null;
  if (!isFollowup) await patch(env, t.conversationId, { last_in_at: now(), followups: 0, ...(state.stage === "dormido" ? { stage: "conversando" as AgentStage } : {}) });
  if (danielSpoke(t.history, state.created_at, await ourTexts(env, t.conversationId))) {
    await handoff(env, t.conversationId, t.lead, "tú escribiste en el chat");
    return null;
  }
  if (!isFollowup) {
    const rule = hardRule(t.text, state);
    if (rule) {
      await handoff(env, t.conversationId, t.lead, rule);
      return null;
    }
  }
  const info = await leadInfo(env, t.lead);
  const { slots } = await callSlots(env);
  const cases = (await setting(env, "agent_cases")) ?? "";
  const ctx: Context = {
    business: info.business, phone: t.lead, stage: state.stage === "dormido" ? "conversando" : state.stage, demoUrl: info.demoUrl,
    demoViewed: info.demoViewed, slots, followup: isFollowup ? t.followup! : null, summary: t.summary, priceAsks: state.price_asks, cases,
  };
  const d = await decide(t.llm ?? openRouter(env), ctx, t.history, t.autoTimes);
  if (d.price) await patch(env, t.conversationId, { price_asks: state.price_asks + 1 });
  if (d.action === "traspaso") {
    await handoff(env, t.conversationId, t.lead, d.reason || "la IA prefirió no responder", d.message);
    return d;
  }
  let text = d.message;
  const payload: Record<string, unknown> = { reason: d.reason };
  if (d.action === "enviar_demo") {
    const demo = await createDemo(env, t.lead);
    text = withDemo(text, `${env.PUBLIC_URL}/demo/${demo.slug}`);
  }
  if (d.action === "proponer_llamada") payload.slots = slots;
  if (d.action === "agendar") payload.start = slots[d.slot! - 1];
  await queue(env, t.conversationId, t.lead, d.action, text, payload, t.mode);
  return { ...d, message: text };
}

async function queue(env: Env, conversationId: string, lead: string, action: Action, text: string, payload: Record<string, unknown>, mode: Mode) {
  await env.DB.prepare("UPDATE drafts SET status = 'descartado' WHERE conversation_id = ? AND status IN ('pendiente', 'programado')").bind(conversationId).run();
  const auto = mode === "auto";
  const delay = (60 + Math.floor(Math.random() * 180)) * 1000;
  await env.DB.prepare("INSERT INTO drafts (id, conversation_id, branch, text, status, created_at, action, payload, send_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), conversationId, `agente:${action}`, text, auto ? "programado" : "pendiente", now(), action, JSON.stringify(payload), new Date(Date.now() + delay).toISOString()).run();
  if (!auto) await notify(env, lead, "agente", `el agente propone (${action.replace("_", " ")}): “${text.slice(0, 200)}”. Apruébalo en el panel`);
}

/**
 * Envía un borrador del agente (aprobado por ti o programado) y aplica su acción. La cita se crea
 * ANTES de confirmar por chat: si el CRM no puede agendar, no se promete nada y te pasa el chat.
 */
export async function sendDraft(env: Env, row: any, text: string): Promise<boolean> {
  const payload = JSON.parse(row.payload || "{}");
  const state = await getState(env, row.conversation_id);
  const lead = state?.lead ?? (await env.DB.prepare("SELECT phone FROM leads WHERE conversation_id = ?").bind(row.conversation_id).first<{ phone: string }>())?.phone ?? "";
  if (row.action === "agendar") {
    const info = await leadInfo(env, lead);
    try {
      await bookCall(env, {
        title: `Llamada Hunter AI · ${info.business}`, start: payload.start, minutes: CALL_MINUTES, conversationId: row.conversation_id,
        notes: `Agendada por el agente. Demo: ${info.demoUrl ?? "sin demo"}. Tel: +${lead}`,
      });
    } catch (e) {
      await env.DB.prepare("UPDATE drafts SET status = 'fallido' WHERE id = ?").bind(row.id).run();
      await handoff(env, row.conversation_id, lead, `no pude agendar en el calendario (${(e as Error).message.slice(0, 120)})`, text);
      return false;
    }
  }
  await reply(env, row.conversation_id, text, row.id);
  await env.DB.prepare("UPDATE drafts SET status = 'enviado', text = ?, sent_at = ? WHERE id = ?").bind(text, now(), row.id).run();
  await env.DB.prepare("INSERT INTO agent_sent (conversation_id, content, created_at) VALUES (?, ?, ?)").bind(row.conversation_id, text, now()).run();
  const next: Partial<State> = { last_out_at: now() };
  if (row.action === "enviar_demo") { next.stage = "demo_enviada"; await setStage(env, lead, "demo", "el agente envió la demo"); }
  if (row.action === "proponer_llamada") { next.stage = "llamada_propuesta"; next.slots = JSON.stringify(payload.slots ?? []); }
  if (row.action === "agendar") {
    next.stage = "agendada";
    await setStage(env, lead, "llamada", "agendó llamada con el agente");
    await notify(env, lead, "cita", `agendó la llamada contigo: ${slotLabel(payload.start, DANIEL_TZ)} (hora de Colombia)`);
  }
  if (payload.followup) next.followups = Number(payload.followup);
  await patch(env, row.conversation_id, next);
  await addNote(env, lead, `🧠 El agente respondió: “${text.slice(0, 140)}”`);
  return true;
}

/**
 * Cada 3 minutos: envía lo programado que ya toca (en automático) y escribe los seguimientos
 * del día 1, 3 y 7 a quien dejó de responder.
 */
export async function agentCron(env: Env, at = new Date()): Promise<string> {
  const mode = await agentMode(env);
  if (mode === "apagado") {
    await env.DB.prepare("UPDATE drafts SET status = 'pendiente' WHERE status = 'programado'").run();
    return "apagado";
  }
  if (mode === "sombra") await env.DB.prepare("UPDATE drafts SET status = 'pendiente' WHERE status = 'programado'").run();
  let sent = 0;
  let follow = 0;
  const due = await env.DB.prepare("SELECT * FROM drafts WHERE status = 'programado' AND send_at <= ? ORDER BY send_at LIMIT 3").bind(at.toISOString()).all<any>();
  for (const row of due.results ?? []) {
    const st = await getState(env, row.conversation_id);
    const lead = st?.lead ?? "";
    if (!inWindow(lead, at, AGENT_HOURS)) continue;
    const history = await messages(env, row.conversation_id);
    // Llegó algo nuevo del negocio después de redactar: ese turno ya dejó su propio borrador.
    if (history.some((m) => m.role === "user" && ts(m.created_at) > ts(row.created_at))) {
      await env.DB.prepare("UPDATE drafts SET status = 'descartado' WHERE id = ?").bind(row.id).run();
      continue;
    }
    if (st && danielSpoke(history, st.created_at, await ourTexts(env, row.conversation_id))) {
      await handoff(env, row.conversation_id, lead, "tú escribiste en el chat");
      continue;
    }
    if (await sendDraft(env, row, row.text)) sent++;
  }
  // Seguimientos: hablamos nosotros de último y pasó el plazo.
  const quiet = await env.DB.prepare(
    `SELECT s.* FROM agent_state s WHERE s.stage IN ('conversando', 'demo_enviada', 'llamada_propuesta') AND s.last_out_at IS NOT NULL
       AND (s.last_in_at IS NULL OR s.last_out_at > s.last_in_at)
       AND NOT EXISTS (SELECT 1 FROM drafts d WHERE d.conversation_id = s.conversation_id AND d.status IN ('pendiente', 'programado'))
     ORDER BY s.last_out_at LIMIT 20`,
  ).all<State>();
  for (const s of quiet.results ?? []) {
    if (follow >= 2) break;
    if (s.followups >= FOLLOWUP_GAP_DAYS.length) {
      await patch(env, s.conversation_id, { stage: "dormido" });
      if (s.lead) await addNote(env, s.lead, "💤 Sin respuesta tras 3 seguimientos: el agente lo deja dormido");
      continue;
    }
    if (at.getTime() - ts(s.last_out_at) < FOLLOWUP_GAP_DAYS[s.followups] * 86400_000) continue;
    if (!s.lead || !inWindow(s.lead, at, AGENT_HOURS)) continue;
    const history = await messages(env, s.conversation_id);
    const d = await agentTurn(env, { conversationId: s.conversation_id, lead: s.lead, history, text: "", mode, followup: s.followups });
    if (d && d.action !== "traspaso") {
      await env.DB.prepare("UPDATE drafts SET payload = json_set(COALESCE(payload, '{}'), '$.followup', ?) WHERE conversation_id = ? AND status IN ('pendiente', 'programado')")
        .bind(s.followups + 1, s.conversation_id).run();
      follow++;
    }
  }
  return `agente ${mode}: ${sent} enviados, ${follow} seguimientos`;
}
