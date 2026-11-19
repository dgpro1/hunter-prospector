// Vigila las líneas QR del CRM: guarda su estado y avisa cuando una se cae, vuelve o desaparece.
import { crmLines, type Env } from "./crm.ts";
import { setting, setSetting } from "./auto.ts";
import { notifySystem } from "./alerts.ts";

type Seen = Record<string, { label: string; number: string | null; connected: boolean }>;

const name = (l: { label: string; number: string | null }) => `${l.label}${l.number ? ` (…${l.number.slice(-4)})` : ""}`;

/** Compara las líneas del CRM con la última foto y avisa de cada cambio. Devuelve los avisos dados. */
export async function watchLines(env: Env): Promise<string[]> {
  if (!env.CRM_API_TOKEN) return [];
  const lines = await crmLines(env);
  const before: Seen = JSON.parse((await setting(env, "lines_state")) || "{}");
  const first = Object.keys(before).length === 0;
  const now: Seen = {};
  const said: string[] = [];
  for (const l of lines) {
    now[l.id] = { label: l.label, number: l.number, connected: l.connected };
    const prev = before[l.id];
    if (first) continue;
    if (prev?.connected && !l.connected) said.push(`🔴 Se desconectó la línea ${name(l)}. No saldrá nada por ella hasta que la reconectes en el CRM.`);
    else if (prev && !prev.connected && l.connected) said.push(`🟢 Volvió la línea ${name(l)}. Ya se puede enviar por ella.`);
    else if (!prev && l.connected) said.push(`🟢 Nueva línea conectada en el CRM: ${name(l)}.`);
  }
  if (!first) for (const [id, prev] of Object.entries(before)) {
    if (!now[id]) said.push(`🔴 La línea ${name(prev)} ya no está en el CRM. No saldrá nada por ella.`);
  }
  if (!first && lines.length && !lines.some((l) => l.connected) && Object.values(before).some((p) => p.connected)) {
    said.push("⏸️ No queda ninguna línea conectada: los envíos quedan en pausa hasta que reconectes una.");
  }
  await setSetting(env, "lines_state", JSON.stringify(now));
  await setSetting(env, "lines_checked_at", new Date().toISOString());
  for (const text of said) await notifySystem(env, "linea", text);
  return said;
}
