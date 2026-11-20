// Avisos de momentos calientes: quedan en la campana del panel y, si conectaste Telegram, te llegan al celular.
import type { Env } from "./crm.ts";
import { setting, setSetting } from "./auto.ts";
import { pushAll } from "./push.ts";
import { shortNumber } from "./lines.ts";

export type AlertKind = "respondio" | "demo_abierta" | "demo_chat" | "cita";
const ICON: Record<AlertKind, string> = { respondio: "💬", demo_abierta: "🔥", demo_chat: "🤖", cita: "📅" };

export async function notify(env: Env, lead: string, kind: AlertKind, text: string): Promise<void> {
  const l = await env.DB.prepare("SELECT l.name, l.city, l.line, li.label FROM leads l LEFT JOIN lines li ON li.number = l.line WHERE l.phone = ?")
    .bind(lead).first<{ name: string; city: string | null; line: string | null; label: string | null }>();
  const who = l ? `${l.name}${l.city ? ` (${l.city})` : ""}` : lead;
  const via = l?.line ? ` · 📞 ${l.label ?? "Línea"} (${shortNumber(l.line)})` : "";
  const line = `${ICON[kind]} ${who}: ${text}${via}`;
  await env.DB.prepare("INSERT INTO alerts (id, lead, kind, text, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), lead, kind, line, new Date().toISOString()).run();
  await pushAll(env).catch((e) => console.error("push", e));
  await telegram(env, `${line}\n\n${env.PUBLIC_URL}/panel#lead=${encodeURIComponent(lead)}`).catch((e) => console.error("telegram", e));
}

async function telegram(env: Env, text: string): Promise<void> {
  const chat = await setting(env, "telegram_chat");
  if (!env.TELEGRAM_BOT_TOKEN || !chat) return;
  await sendTo(env, chat, text);
}

async function sendTo(env: Env, chat: string, text: string): Promise<void> {
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
  });
  if (!r.ok) throw new Error(`Telegram → ${r.status}`);
}

/**
 * Elige a qué chat llegan los avisos. Sin `chatId`, busca el último chat privado que le escribió
 * al bot (tú, con /start). Si el bot es VISION, Telegram ya le entrega los mensajes al CRM por
 * webhook y getUpdates responde 409: entonces se pega el ID del chat (te lo da @userinfobot).
 * Solo se guarda después de que el mensaje de prueba llegó.
 */
export async function linkTelegram(env: Env, chatId?: string): Promise<{ ok: boolean; error?: string; name?: string; needsId?: boolean }> {
  if (!env.TELEGRAM_BOT_TOKEN) return { ok: false, error: "Falta el secreto TELEGRAM_BOT_TOKEN en Cloudflare (pon ahí el token del bot de VISION)" };
  let chat = String(chatId ?? "").trim();
  let name = "";
  if (chat) {
    if (!/^-?\d{5,20}$/.test(chat)) return { ok: false, needsId: true, error: "El ID de chat son solo números (te lo da @userinfobot en Telegram)" };
  } else {
    const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getUpdates?limit=50`);
    const d: any = await r.json().catch(() => ({}));
    if (r.status === 409 || d.error_code === 409) {
      return { ok: false, needsId: true, error: "Ese bot ya lo usa VISION. Pega tu ID de chat de Telegram (escríbele a @userinfobot y te lo da) y toca Conectar" };
    }
    if (!d.ok) return { ok: false, error: d.description ?? `Telegram → ${r.status}` };
    const msg = [...(d.result ?? [])].reverse().map((u: any) => u.message).find((m: any) => m?.chat?.type === "private");
    if (!msg) return { ok: false, needsId: true, error: "Escríbele /start a tu bot en Telegram y vuelve a tocar Conectar, o pega tu ID de chat" };
    chat = String(msg.chat.id);
    name = msg.chat.first_name ?? "";
  }
  try {
    await sendTo(env, chat, "✅ Listo. Aquí te avisaré cuando un prospecto responda, abra su demo, hable con el agente o agende.");
  } catch (e) {
    return { ok: false, needsId: true, error: `Telegram no pudo escribirte (${(e as Error).message}). Abre el bot y tócale Iniciar, y revisa el ID` };
  }
  await setSetting(env, "telegram_chat", chat);
  return { ok: true, name };
}

export async function listAlerts(env: Env) {
  const rows = await env.DB.prepare("SELECT id, lead, kind, text, seen, created_at FROM alerts ORDER BY created_at DESC LIMIT 30").all();
  const unseen = await env.DB.prepare("SELECT COUNT(*) n FROM alerts WHERE seen = 0").first<{ n: number }>();
  const push = await env.DB.prepare("SELECT COUNT(*) n FROM push_subs").first<{ n: number }>();
  return { items: rows.results, unseen: unseen?.n ?? 0, push: push?.n ?? 0, telegram: Boolean(env.TELEGRAM_BOT_TOKEN && (await setting(env, "telegram_chat"))), bot: Boolean(env.TELEGRAM_BOT_TOKEN) };
}

export async function markSeen(env: Env): Promise<void> {
  await env.DB.prepare("UPDATE alerts SET seen = 1 WHERE seen = 0").run();
}

/** Aviso que no es de un prospecto (p. ej. una línea que se cayó): campana, push y Telegram. */
export async function notifySystem(env: Env, kind: string, text: string): Promise<void> {
  await env.DB.prepare("INSERT INTO alerts (id, lead, kind, text, created_at) VALUES (?, '', ?, ?, ?)")
    .bind(crypto.randomUUID(), kind, text, new Date().toISOString()).run();
  await pushAll(env).catch((e) => console.error("push", e));
  await telegram(env, `${text}\n\n${env.PUBLIC_URL}/panel#envios`).catch((e) => console.error("telegram", e));
}
