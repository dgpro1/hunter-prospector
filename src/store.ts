// El Prospector como CRM: etapas, notas e historial de cada ficha (tabla leads).
import type { Env } from "./crm.ts";
import { contactPhone } from "./crm.ts";

export const STAGES = ["nuevo", "contactado", "respondio", "demo", "llamada", "propuesta", "ganado", "perdido"] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABEL: Record<Stage, string> = {
  nuevo: "Por contactar", contactado: "Contactado", respondio: "Respondió", demo: "Demo",
  llamada: "Llamada", propuesta: "Propuesta", ganado: "Ganado", perdido: "Perdido",
};

const now = () => new Date().toISOString();

export async function addNote(env: Env, lead: string, text: string, kind: "nota" | "sistema" = "sistema"): Promise<void> {
  await env.DB.prepare("INSERT INTO notes (id, lead, kind, text, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), lead, kind, text, now()).run();
}

export async function setStage(env: Env, lead: string, stage: Stage, why?: string): Promise<void> {
  const cur = await env.DB.prepare("SELECT stage FROM leads WHERE phone = ?").bind(lead).first<{ stage: string }>();
  if (!cur || cur.stage === stage) return;
  await env.DB.prepare("UPDATE leads SET stage = ?, updated_at = ? WHERE phone = ?").bind(stage, now(), lead).run();
  await addNote(env, lead, `${STAGE_LABEL[cur.stage as Stage] ?? cur.stage} → ${STAGE_LABEL[stage]}${why ? ` · ${why}` : ""}`);
}

/**
 * Une el chat que respondió con su ficha: por conversación, luego por teléfono (si la integración
 * tiene contacts.read) y si no, crea una ficha nueva de origen "anuncio" (Canal 2).
 */
export async function leadForChat(env: Env, data: any): Promise<string> {
  const conv = String(data.conversation_id);
  const byConv = await env.DB.prepare("SELECT phone FROM leads WHERE conversation_id = ?").bind(conv).first<{ phone: string }>();
  if (byConv) return byConv.phone;
  const phone = data.contact_id ? await contactPhone(env, data.contact_id).catch(() => null) : null;
  if (phone) {
    const byPhone = await env.DB.prepare("SELECT phone FROM leads WHERE phone = ?").bind(phone).first<{ phone: string }>();
    if (byPhone) {
      await env.DB.prepare("UPDATE leads SET conversation_id = ?, contact_id = ?, updated_at = ? WHERE phone = ?")
        .bind(conv, data.contact_id ?? null, now(), phone).run();
      return phone;
    }
  }
  const key = phone ?? `c-${conv}`;
  await env.DB.prepare(
    `INSERT OR IGNORE INTO leads (phone, name, origin, conversation_id, contact_id, status, stage, created_at, updated_at, batch)
     VALUES (?, ?, 'anuncio', ?, ?, 'enviado', 'contactado', ?, ?, 'canal-2')`,
  ).bind(key, data.contact_name || `Chat #${data.number ?? ""}`, conv, data.contact_id ?? null, now(), now()).run();
  await addNote(env, key, "Ficha creada desde un chat de anuncio (Canal 2)");
  return key;
}
