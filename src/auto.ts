// Envío automático del primer mensaje por el CRM Hunter AI (Canal 1), con interruptor, cupo, línea y horario local.
import { CrmError, crmLines, messages, startChat, type Env, type Line } from "./crm.ts";
import { lineLabel } from "./lines.ts";
import { addNote } from "./store.ts";
import { OPENER_V } from "./offers.ts";
import { fillToday, markLead, rewriteOpeners, today } from "./leads.ts";

/** Zona horaria del negocio según el prefijo del número (MX, ES, EE. UU., CO). */
export function zoneFor(phone: string): string {
  if (phone.startsWith("52")) return "America/Mexico_City";
  if (phone.startsWith("34")) return "Europe/Madrid";
  if (phone.startsWith("1")) return "America/New_York";
  return "America/Bogota";
}

/** ¿Es buena hora para escribirle? Lunes a sábado, de 9:00 a 18:59 en su hora local. */
/** Horario de envío en la hora local del negocio: de "from" a "to" (horas 0–24) los días "days" (0 = domingo). */
export type Hours = { from: number; to: number; days: number[] };
export const DEFAULT_HOURS: Hours = { from: 9, to: 19, days: [1, 2, 3, 4, 5, 6] };
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Valida un horario que llega del panel; null si no tiene sentido. */
export function cleanHours(raw: any): Hours | null {
  const from = Number(raw?.from), to = Number(raw?.to);
  const days = [...new Set((Array.isArray(raw?.days) ? raw.days : []).map(Number))].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort() as number[];
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to > 24 || from >= to || !days.length) return null;
  return { from, to, days };
}

export async function getHours(env: Env): Promise<Hours> {
  try { return cleanHours(JSON.parse((await setting(env, "send_hours")) || "null")) ?? DEFAULT_HOURS; } catch { return DEFAULT_HOURS; }
}

export function inWindow(phone: string, date = new Date(), hours: Hours = DEFAULT_HOURS): boolean {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zoneFor(phone), weekday: "short", hour: "numeric", hourCycle: "h23" }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  const day = WEEKDAY.indexOf(parts.find((p) => p.type === "weekday")?.value ?? "");
  return hours.days.includes(day) && hour >= hours.from && hour < hours.to;
}

export async function setting(env: Env, key: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export async function setSetting(env: Env, key: string, value: string): Promise<void> {
  await env.DB.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(key, value).run();
}

/** El envío sale por el CRM: basta con el token de la integración. Nada de Evolution aquí. */
export const sendReady = (env: Env) => Boolean(env.CRM_API_TOKEN);

/**
 * Línea por la que sale el próximo mensaje. Ajuste "send_line": el id de una línea fija,
 * o vacío / "rotar" para turnarse entre todas las líneas QR conectadas.
 */
export async function pickLine(env: Env): Promise<Line> {
  const lines = (await crmLines(env)).filter((l) => l.connected);
  if (!lines.length) throw new CrmError(0, "no_line", "No hay ninguna línea QR conectada en el CRM");
  const chosen = (await setting(env, "send_line")) || "rotar";
  if (chosen !== "rotar") {
    const line = lines.find((l) => l.id === chosen);
    if (!line) throw new CrmError(0, "line_off", "La línea elegida no está conectada en el CRM");
    return line;
  }
  const cursor = Number((await setting(env, "line_cursor")) || 0);
  await setSetting(env, "line_cursor", String(cursor + 1));
  return lines[cursor % lines.length];
}

/** Escribe primero por el CRM y deja la ficha unida a la conversación y a la línea. */
export async function sendFirst(env: Env, phone: string, text: string): Promise<void> {
  const line = await pickLine(env);
  const { conversationId, lineNumber } = await startChat(env, line.id, phone, text, `apertura-${phone}`);
  const num = lineNumber ?? line.number;
  await env.DB.prepare("UPDATE leads SET conversation_id = COALESCE(?, conversation_id), line = COALESCE(line, ?) WHERE phone = ?")
    .bind(conversationId || null, num, phone).run();
  const label = num ? await lineLabel(env, num) : line.label;
  await addNote(env, phone, `📞 Primer mensaje por ${label}${num ? ` (…${num.slice(-4)})` : ""}, vía CRM`);
}

/** Traduce un error de envío a algo que se entienda en el panel. */
export function sendErrorText(e: unknown): string {
  if (e instanceof CrmError && e.status === 404 && /conversations\/start/.test(e.message) && !/line/i.test(e.message)) {
    return "El CRM todavía no tiene el endpoint para escribir primero (POST /conversations/start). Mientras, usa “Abrir en WhatsApp”.";
  }
  if (e instanceof CrmError && e.code === "no_line") return "No hay ninguna línea QR conectada en el CRM. Los envíos esperan hasta que reconectes una.";
  if (e instanceof CrmError && e.code === "line_off") return "La línea elegida está desconectada en el CRM. Los envíos esperan; no se usa otro número.";
  if (e instanceof CrmError && e.status === 404) return "La línea elegida ya no existe en el CRM. Elige otra en Envíos.";
  if (e instanceof CrmError && e.status === 403) return "La integración del CRM no tiene permiso (necesita inbox.reply y channels.read).";
  return String(e instanceof Error ? e.message : e);
}

/** Cada 10 min: si está encendido y toca, manda UN mensaje y programa el siguiente con una pausa al azar. */
export async function tick(env: Env, date = new Date()): Promise<string> {
  // Aperturas viejas por reescribir (cambio de tono): 10 por vuelta, antes de enviar nada.
  const pendingRewrite = await env.DB.prepare("SELECT 1 FROM leads WHERE status = 'hoy' AND (opener_v IS NULL OR opener_v < ?) LIMIT 1").bind(OPENER_V).first();
  if (pendingRewrite) return `reescribiendo, faltan ${await rewriteOpeners(env, 40)}`;
  if ((await setting(env, "auto")) !== "on") return "apagado";
  if (!sendReady(env)) return "sin CRM";
  const day = today(date);
  if ((await setting(env, "filled_day")) !== day) {
    await fillToday(env);
    await setSetting(env, "filled_day", day);
  }
  const next = await setting(env, "next_send_at");
  if (next && Date.parse(next) > date.getTime()) return "esperando pausa";
  const pending = await env.DB.prepare("SELECT * FROM leads WHERE status = 'hoy' AND day = ? ORDER BY rowid").bind(day).all<any>();
  const hours = await getHours(env);
  const lead = (pending.results ?? []).find((l: any) => inWindow(l.phone, date, hours));
  if (!lead) return "nadie en horario";
  try {
    await sendFirst(env, lead.phone, lead.opener);
    await markLead(env, lead.phone, "enviado");
  } catch (e) {
    if (e instanceof CrmError && e.code === "not_on_whatsapp") {
      // El número no tiene WhatsApp: se salta sin gastar cupo ni apagar el envío.
      await markLead(env, lead.phone, "descartado");
      await addNote(env, lead.phone, "Sin WhatsApp (lo comprobó el CRM antes de enviar)");
      return `sin WhatsApp ${lead.phone}`;
    }
    if (e instanceof CrmError && ["no_line", "line_off"].includes(e.code)) {
      // La línea elegida (o todas) está caída: se espera sin apagar el envío ni gastar el lead.
      // El vigilante de líneas ya avisó; en cuanto vuelva, sigue solo. Nunca se cambia de número.
      await setSetting(env, "last_error", `${date.toISOString()} ${sendErrorText(e)}`);
      return "línea caída, en pausa";
    }
    await setSetting(env, "last_error", `${date.toISOString()} ${sendErrorText(e)}`);
    // Si falla, se apaga solo para no insistir con un número caído o bloqueado.
    await setSetting(env, "auto", "off");
    return "error";
  }
  // Ajuste "send_gap": minutos entre mensajes en total (todas las líneas), con ±3 min al azar para no parecer robot.
  const base = Math.min(120, Math.max(5, Number((await setting(env, "send_gap")) || 15)));
  const gapMin = base - 3 + Math.random() * 6;
  await setSetting(env, "next_send_at", new Date(date.getTime() + gapMin * 60000).toISOString());
  return `enviado ${lead.phone}`;
}

/**
 * One-off test send: the "send_test" setting names one lead's phone. The cron sends that
 * lead's opener once, clears the setting before sending, and leaves the outcome in "send_test_result".
 */
export async function sendTest(env: Env): Promise<string | null> {
  const phone = await setting(env, "send_test");
  if (!phone) return null;
  await setSetting(env, "send_test", "");
  const lead = await env.DB.prepare("SELECT phone, opener FROM leads WHERE phone = ?").bind(phone).first<any>();
  let result: string;
  if (!lead) result = `sin lead ${phone}`;
  else {
    try {
      await sendFirst(env, lead.phone, lead.opener);
      await markLead(env, lead.phone, "enviado");
      const row = await env.DB.prepare("SELECT conversation_id, line FROM leads WHERE phone = ?").bind(phone).first<any>();
      result = `enviado ${phone} conv=${row?.conversation_id ?? ""} line=${row?.line ?? ""}`;
    } catch (e) {
      result = `error ${e instanceof CrmError ? `${e.status} ${e.code} ` : ""}${sendErrorText(e)}`;
    }
  }
  await setSetting(env, "send_test_result", `${new Date().toISOString()} ${result}`);
  return result;
}

/**
 * Revisión pedida a mano (ajuste "verify_sent" = "pedido"): para cada lead enviado por el CRM mira
 * cómo quedó su primer mensaje (delivery_status de WhatsApp) y deja el resultado en "verify_sent_result".
 */
export async function verifySent(env: Env): Promise<void> {
  if ((await setting(env, "verify_sent")) !== "pedido") return;
  await setSetting(env, "verify_sent", "hecho");
  const rows = await env.DB.prepare("SELECT phone, name, conversation_id FROM leads WHERE conversation_id IS NOT NULL AND status = 'enviado'").all<any>();
  const out: any[] = [];
  for (const l of rows.results ?? []) {
    try {
      const msgs: any[] = await messages(env, l.conversation_id);
      const first = msgs.find((m) => m.role !== "user" && (m.kind ?? "message") === "message");
      out.push({ phone: l.phone, name: l.name, status: first?.delivery_status ?? null, error: first?.delivery_error ?? null, ext: Boolean(first?.external_message_id), replies: msgs.filter((m) => m.role === "user").length });
    } catch (e) {
      out.push({ phone: l.phone, name: l.name, fail: String(e instanceof Error ? e.message : e).slice(0, 120) });
    }
  }
  await setSetting(env, "verify_sent_result", JSON.stringify({ at: new Date().toISOString(), out }));
}
