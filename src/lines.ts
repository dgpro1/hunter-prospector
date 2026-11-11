// Tus líneas de WhatsApp de prospección: cada número recibe un nombre corto (Línea 1, Línea 2…) que puedes cambiar.
import type { Env } from "./crm.ts";

export async function lineLabel(env: Env, number: string): Promise<string> {
  const n = number.replace(/\D/g, "");
  const row = await env.DB.prepare("SELECT label FROM lines WHERE number = ?").bind(n).first<{ label: string }>();
  if (row) return row.label;
  const c = await env.DB.prepare("SELECT COUNT(*) n FROM lines").first<{ n: number }>();
  const label = `Línea ${(c?.n ?? 0) + 1}`;
  await env.DB.prepare("INSERT OR IGNORE INTO lines (number, label, created_at) VALUES (?, ?, ?)").bind(n, label, new Date().toISOString()).run();
  return label;
}

export const shortNumber = (n: string) => `…${n.slice(-4)}`;

export async function listLines(env: Env) {
  const r = await env.DB.prepare(
    `SELECT li.number, li.label, COUNT(l.phone) chats,
       SUM(CASE WHEN l.replied_at IS NOT NULL THEN 1 ELSE 0 END) replied,
       ROUND(AVG(l.response_minutes)) avg_response,
       SUM(CASE WHEN l.stage IN ('demo','llamada','propuesta','ganado') THEN 1 ELSE 0 END) hot
     FROM lines li LEFT JOIN leads l ON l.line = li.number GROUP BY li.number ORDER BY li.created_at`,
  ).all();
  return r.results ?? [];
}

export async function renameLine(env: Env, number: string, label: string): Promise<void> {
  const clean = label.trim().slice(0, 30);
  if (!clean) throw new Error("Ponle un nombre");
  await env.DB.prepare("UPDATE lines SET label = ? WHERE number = ?").bind(clean, number.replace(/\D/g, "")).run();
}
