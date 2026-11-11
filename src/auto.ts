// Envío automático del primer mensaje por Evolution (Canal 1), con interruptor, cupo y horario local.
import type { Env } from "./crm.ts";
import { fillToday, markLead, today } from "./leads.ts";

/** Zona horaria del negocio según el prefijo del número (MX, ES, EE. UU., CO). */
export function zoneFor(phone: string): string {
  if (phone.startsWith("52")) return "America/Mexico_City";
  if (phone.startsWith("34")) return "Europe/Madrid";
  if (phone.startsWith("1")) return "America/New_York";
  return "America/Bogota";
}

/** ¿Es buena hora para escribirle? Lunes a sábado, de 9:00 a 18:59 en su hora local. */
export function inWindow(phone: string, date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zoneFor(phone), weekday: "short", hour: "numeric", hourCycle: "h23" }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  const day = parts.find((p) => p.type === "weekday")?.value;
  return day !== "Sun" && hour >= 9 && hour < 19;
}

export async function setting(env: Env, key: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export async function setSetting(env: Env, key: string, value: string): Promise<void> {
  await env.DB.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(key, value).run();
}

export const evolutionReady = (env: Env) => Boolean(env.EVOLUTION_URL && env.EVOLUTION_INSTANCE && env.EVOLUTION_API_KEY);

/** Envía un texto desde el número QR. El CRM lo ve como mensaje tuyo desde el teléfono y abre el chat. */
export async function sendFirst(env: Env, phone: string, text: string): Promise<void> {
  const res = await fetch(`${env.EVOLUTION_URL.replace(/\/$/, "")}/message/sendText/${encodeURIComponent(env.EVOLUTION_INSTANCE)}`, {
    method: "POST",
    headers: { apikey: env.EVOLUTION_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ number: phone, text, delay: 1500, linkPreview: false }),
  });
  if (!res.ok) throw new Error(`Evolution → ${res.status} ${(await res.text()).slice(0, 200)}`);
}

/** Cada 10 min: si está encendido y toca, manda UN mensaje y programa el siguiente con una pausa al azar. */
export async function tick(env: Env, date = new Date()): Promise<string> {
  if ((await setting(env, "auto")) !== "on") return "apagado";
  if (!evolutionReady(env)) return "sin Evolution";
  const day = today(date);
  if ((await setting(env, "filled_day")) !== day) {
    await fillToday(env);
    await setSetting(env, "filled_day", day);
  }
  const next = await setting(env, "next_send_at");
  if (next && Date.parse(next) > date.getTime()) return "esperando pausa";
  const pending = await env.DB.prepare("SELECT * FROM leads WHERE status = 'hoy' AND day = ? ORDER BY rowid").bind(day).all<any>();
  const lead = (pending.results ?? []).find((l: any) => inWindow(l.phone, date));
  if (!lead) return "nadie en horario";
  try {
    await sendFirst(env, lead.phone, lead.opener);
    await markLead(env, lead.phone, "enviado");
  } catch (e) {
    await setSetting(env, "last_error", `${date.toISOString()} ${String(e)}`);
    // Si falla, se apaga solo para no insistir con un número caído o bloqueado.
    await setSetting(env, "auto", "off");
    return "error";
  }
  const gapMin = 12 + Math.floor(Math.random() * 14); // 12–25 min entre mensajes
  await setSetting(env, "next_send_at", new Date(date.getTime() + gapMin * 60000).toISOString());
  return `enviado ${lead.phone}`;
}
