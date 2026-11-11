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
  EVOLUTION_URL: string;
  EVOLUTION_INSTANCE: string;
  EVOLUTION_API_KEY: string;
  TELEGRAM_BOT_TOKEN?: string;
  VAPID_JWK?: string;
  PUBLIC_URL: string;
  SITE_MODEL?: string;            // modelo de OpenRouter para escribir las webs demo (si no, OPENROUTER_MODEL)
  SOCRATA_APP_TOKEN?: string;     // opcional: más cupo en data.ct.gov
};

async function call(env: Env, path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${env.CRM_BASE_URL}/api/v1/clients/${env.CRM_CLIENT_ID}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${env.CRM_API_TOKEN}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`CRM ${init.method ?? "GET"} ${path} → ${res.status}`);
  return res.json();
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
