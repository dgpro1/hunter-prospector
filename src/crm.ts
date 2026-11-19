// Cliente mínimo de la API v1 del CRM Hunter AI.
import type { Msg } from "./timer.ts";

export type Env = {
  DB: D1Database;
  AI: Ai;
  CRM_BASE_URL: string;
  CRM_CLIENT_ID: string;
  CRM_API_TOKEN: string;
  CRM_WEBHOOK_SECRET: string;
  CRM_STAGES: string;
  OPENROUTER_API_KEY: string;
  OPENROUTER_MODEL: string;
  CLASSIFY_MODEL: string;
  PANEL_PASSWORD: string;
  TELEGRAM_BOT_TOKEN?: string;
  VAPID_JWK?: string;
  PUBLIC_URL: string;
  SITE_MODEL?: string;            // modelo de OpenRouter para escribir las webs demo (si no, OPENROUTER_MODEL)
  SOCRATA_APP_TOKEN?: string;
  GEMINI_API_KEY?: string;        // clave gratis de Google AI Studio para escribir las webs demo
  GEMINI_API_KEY_2?: string;
  GEMINI_API_KEY_3?: string;
  GEMINI_MODEL?: string;     // opcional: más cupo en data.ct.gov
};

/** Error del CRM con su código HTTP y, si lo trae, el código de error (ej. "not_on_whatsapp"). */
export class CrmError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function call(env: Env, path: string, init: RequestInit = {}): Promise<any> {
  await ensureClientId(env);
  const res = await fetch(`${env.CRM_BASE_URL}/api/v1/clients/${env.CRM_CLIENT_ID}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${env.CRM_API_TOKEN}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    const body: any = await res.json().catch(() => ({}));
    // La API v1 responde {title, status, detail, code?}: code trae el motivo (ej. "not_on_whatsapp").
    const detail = body?.detail;
    const code = String(body?.code ?? "");
    const text = typeof detail === "string" ? detail : "";
    throw new CrmError(res.status, code, `CRM ${init.method ?? "GET"} ${path} → ${res.status}${text ? ` ${text.slice(0, 160)}` : ""}`);
  }
  return res.json();
}

/**
 * UUID del cliente de prospección: el de wrangler.toml, el aprendido del primer webhook
 * o, si el token solo ve un cliente, ese.
 */
export async function ensureClientId(env: Env): Promise<void> {
  if (env.CRM_CLIENT_ID) return;
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'crm_client_id'").first<{ value: string }>();
  if (row?.value) { env.CRM_CLIENT_ID = row.value; return; }
  const res = await fetch(`${env.CRM_BASE_URL}/api/v1/clients`, { headers: { Authorization: `Bearer ${env.CRM_API_TOKEN}` } });
  const list: any[] = res.ok ? ((await res.json()) as any)?.data ?? [] : [];
  if (list.length !== 1) throw new CrmError(0, "no_client", "Falta el cliente del CRM (CRM_CLIENT_ID)");
  env.CRM_CLIENT_ID = String(list[0].id);
  await env.DB.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('crm_client_id', ?)").bind(env.CRM_CLIENT_ID).run();
}

/** Una línea de WhatsApp QR del cliente en el CRM. */
export type Line = { id: string; label: string; number: string | null; connected: boolean };

/** Tus líneas QR conectadas al cliente de prospección (permiso channels.read). */
export async function crmLines(env: Env): Promise<Line[]> {
  const page = await call(env, "/channels");
  return (page.data ?? [])
    .filter((c: any) => c.type === "whatsapp_qr")
    .map((c: any) => {
      const number = String(c.phone_number ?? "").replace(/\D/g, "") || null;
      return { id: String(c.id), label: String(c.label ?? number ?? "Línea"), number, connected: Boolean(c.connected) };
    });
}

/**
 * Escribe primero a un número desde una línea QR, por el CRM. El CRM comprueba que el número
 * tenga WhatsApp, abre la conversación en modo humano y devuelve su id.
 * Endpoint del CRM: POST /api/v1/clients/{client}/conversations/start (rama claude/project-thread-s1v1ch de hunterai).
 */
export async function startChat(
  env: Env, channelId: string, phone: string, content: string, idempotencyKey: string,
): Promise<{ conversationId: string; lineNumber: string | null }> {
  const r = await call(env, "/conversations/start", {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ channel_id: channelId, phone, content, mode: "human" }),
  });
  return { conversationId: String(r.id ?? r.conversation_id), lineNumber: String(r.line_number ?? "").replace(/\D/g, "") || null };
}

export async function messages(env: Env, conversationId: string): Promise<Msg[]> {
  const page = await call(env, `/conversations/${conversationId}/messages?limit=200`);
  return page.data as Msg[];
}

/** Deja el chat en manos humanas para que el agente del CRM no responda: lo maneja el worker. */
export async function holdForWorker(env: Env, conversationId: string): Promise<void> {
  await call(env, `/conversations/${conversationId}/mode`, { method: "PATCH", body: JSON.stringify({ mode: "human" }) });
}

export async function reply(env: Env, conversationId: string, content: string, idempotencyKey: string): Promise<void> {
  await call(env, `/conversations/${conversationId}/reply`, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ content }),
  });
}

/** Mueve el chat a una etapa por su nombre lógico ("respondio", "perdido"…), si está configurada. */
export async function moveStage(env: Env, conversationId: string, stage: string): Promise<void> {
  let stages: Record<string, string> = {};
  try { stages = JSON.parse(env.CRM_STAGES || "{}"); } catch { return; }
  const id = stages[stage];
  if (!id) return;
  await call(env, `/conversations/${conversationId}/pipeline`, {
    method: "PATCH",
    body: JSON.stringify({ pipeline_stage_id: id }),
  });
}

/** Teléfono (solo dígitos) de un contacto del CRM. Necesita el permiso contacts.read; si no lo hay, null. */
export async function contactPhone(env: Env, contactId: string): Promise<string | null> {
  const c = await call(env, `/contacts/${contactId}`);
  const digits = String(c?.phone ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits : null;
}

/** Verifica la firma HMAC-SHA256 (hex) que el CRM pone en X-Signature. */
export async function verifySignature(secret: string, raw: ArrayBuffer, signature: string | null): Promise<boolean> {
  if (!signature || !secret) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, raw));
  const hex = [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (hex.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}
