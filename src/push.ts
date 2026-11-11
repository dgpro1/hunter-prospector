// Notificaciones push al celular (PWA instalada). Se envían SIN contenido (no hace falta cifrar):
// el service worker pide el último aviso al panel y lo muestra.
import type { Env } from "./crm.ts";

const b64u = (b: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(b instanceof Uint8Array ? b : new Uint8Array(b)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

function jwk(env: Env): JsonWebKey | null {
  try { return env.VAPID_JWK ? JSON.parse(env.VAPID_JWK) : null; } catch { return null; }
}

/** Clave pública VAPID (punto sin comprimir 0x04‖x‖y) en base64url, para el navegador. */
export function vapidPublic(env: Env): string | null {
  const k = jwk(env);
  if (!k?.x || !k?.y) return null;
  const raw = new Uint8Array(65);
  raw[0] = 4; raw.set(fromB64u(k.x), 1); raw.set(fromB64u(k.y), 33);
  return b64u(raw);
}

async function vapidJwt(env: Env, aud: string): Promise<string> {
  const k = jwk(env)!;
  const key = await crypto.subtle.importKey("jwk", { ...k, key_ops: ["sign"] }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const enc = (o: object) => b64u(new TextEncoder().encode(JSON.stringify(o)));
  const body = `${enc({ typ: "JWT", alg: "ES256" })}.${enc({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.PUBLIC_URL })}`;
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(body));
  return `${body}.${b64u(sig)}`;
}

export async function saveSubscription(env: Env, sub: any): Promise<void> {
  if (!sub?.endpoint || !/^https:\/\//.test(sub.endpoint)) throw new Error("Suscripción inválida");
  await env.DB.prepare("INSERT INTO push_subs (endpoint, created_at) VALUES (?, ?) ON CONFLICT(endpoint) DO NOTHING")
    .bind(sub.endpoint, new Date().toISOString()).run();
}

/** Despierta a todos los celulares suscritos. */
export async function pushAll(env: Env): Promise<number> {
  const pub = vapidPublic(env);
  if (!pub) return 0;
  const subs = await env.DB.prepare("SELECT endpoint FROM push_subs").all<{ endpoint: string }>();
  let sent = 0;
  for (const { endpoint } of subs.results) {
    try {
      const jwt = await vapidJwt(env, new URL(endpoint).origin);
      const r = await fetch(endpoint, { method: "POST", headers: { TTL: "86400", Urgency: "high", Authorization: `vapid t=${jwt}, k=${pub}`, "Content-Length": "0" } });
      if (r.status === 404 || r.status === 410) await env.DB.prepare("DELETE FROM push_subs WHERE endpoint = ?").bind(endpoint).run();
      else if (r.ok) sent++;
      else console.error("push", r.status, await r.text().catch(() => ""));
    } catch (e) {
      console.error("push", e);
    }
  }
  return sent;
}
