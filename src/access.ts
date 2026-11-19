// Revisión de alcance del token del CRM, solo lecturas. Se pide poniendo settings.access_check = 'pedido';
// el cron deja el resultado (sin el token) en settings.access_check_result.
import type { Env } from "./crm.ts";

async function get(env: Env, path: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${env.CRM_BASE_URL}/api/v1${path}`, { headers: { Authorization: `Bearer ${env.CRM_API_TOKEN}` } });
  return { status: res.status, body: await res.json().catch(() => null) };
}

export async function accessCheck(env: Env): Promise<void> {
  const asked = await env.DB.prepare("SELECT value FROM settings WHERE key = 'access_check'").first<{ value: string }>();
  if (asked?.value !== "pedido") return;
  const clients = await get(env, "/clients?limit=250");
  const out: any = { at: new Date().toISOString(), clients_status: clients.status, clients_detail: clients.body?.detail ?? null, clients: [] };
  const known = await env.DB.prepare("SELECT value FROM settings WHERE key = 'crm_client_id'").first<{ value: string }>();
  const list: any[] = clients.body?.data ?? (known?.value ? [{ id: known.value, name: "(aprendido del webhook)" }] : []);
  // Un cliente inventado: si el token está limitado a su cliente, el CRM lo rechaza.
  const other = await get(env, "/clients/00000000-0000-4000-8000-000000000000/conversations?limit=1");
  out.other_client = { status: other.status, detail: other.body?.detail ?? null };
  for (const c of list) {
    const ch = await get(env, `/clients/${c.id}/channels`);
    const conv = await get(env, `/clients/${c.id}/conversations?limit=1`);
    out.clients.push({
      id: c.id, name: c.name, slug: c.slug ?? c.portal_slug ?? null, agency_id: c.agency_id ?? null,
      channels_status: ch.status, channels_detail: ch.status >= 400 ? ch.body?.detail ?? null : null,
      channels: (ch.body?.data ?? []).map((x: any) => ({ type: x.type, label: x.label, connected: x.connected })),
      conversations_status: conv.status, conversations_total: conv.body?.total ?? null,
      conversations_detail: conv.status >= 400 ? conv.body?.detail ?? null : null,
    });
  }
  await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('access_check_result', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(JSON.stringify(out)).run();
  await env.DB.prepare("UPDATE settings SET value = 'hecho' WHERE key = 'access_check'").run();
}
