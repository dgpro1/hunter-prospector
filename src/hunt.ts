// Cazador dentro del worker: busca negocios en Google Maps (endpoint público, sin API key),
// se queda con los que tienen móvil (WhatsApp) y los mete en la cola. Portado de El Cazador 2.0.
import type { Env } from "./crm.ts";
import { importLeads, type Lead } from "./leads.ts";

type Pais = { code: string; name: string; dial: string; len: number[]; pre: string[]; lang: string };
export const PAISES: Record<string, Pais> = Object.fromEntries(([
  ["MX", "México", "52", [10], [..."123456789"], "es"],
  ["ES", "España", "34", [9], ["6", "7"], "es"],
  ["US", "Estados Unidos", "1", [10], [..."23456789"], "es"],
  ["CO", "Colombia", "57", [10], ["3"], "es"],
  ["CL", "Chile", "56", [9], ["9"], "es"],
  ["PE", "Perú", "51", [9], ["9"], "es"],
  ["AR", "Argentina", "54", [10], ["1", "2", "3"], "es"],
  ["EC", "Ecuador", "593", [9], ["9"], "es"],
  ["DO", "República Dominicana", "1", [10], ["8"], "es"],
  ["CR", "Costa Rica", "506", [8], ["6", "7", "8"], "es"],
  ["PA", "Panamá", "507", [8], ["6"], "es"],
] as const).map(([code, name, dial, len, pre, lang]) => [code, { code, name, dial, len: [...len], pre: [...pre], lang }]));

const BASURA = new Set(["34600000000", "34123456789", "1234567890", "0000000000", "1111111111", "5215555555555"]);

/** Móvil del país en formato wa.me (solo dígitos), o null si es fijo o basura. */
export function mobile(raw: string, p: Pais): string | null {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (!d || BASURA.has(d) || new Set(d).size <= 2) return null;
  const ok = (n: string) => p.len.includes(n.length) && p.pre.some((x) => n.startsWith(x));
  if (d.startsWith(p.dial)) {
    let rest = d.slice(p.dial.length);
    if (p.code === "AR" && rest.startsWith("9") && ok(rest.slice(1))) return p.dial + "9" + rest.slice(1);
    if (p.code === "MX" && rest.startsWith("1") && rest.length === 11) rest = rest.slice(1); // antiguo 521
    if (ok(rest)) return p.dial + (p.code === "AR" ? "9" : "") + rest;
  }
  const nat = d.replace(/^0+/, "");
  if (ok(nat)) return p.dial + (p.code === "AR" ? "9" : "") + nat;
  return null;
}

const g = (node: any, ...idx: number[]): any => {
  for (const i of idx) {
    if (node == null || typeof node !== "object") return undefined;
    node = node[i];
  }
  return node;
};

const BLOQUEADOS = ["facebook.", "instagram.", "google.", "goo.gl", "wa.me", "whatsapp.", "tiktok.", "youtube.", "twitter.", "x.com", "linktr.ee", "gstatic.", "ggpht.", "doctoralia.", "tripadvisor.", "yelp.", "booksy.", "fresha.", "treatwell."];

/** De la respuesta cruda de Maps a fichas de negocio. */
export function parseMaps(text: string, city: string, niche: string, p: Pais): { leads: Lead[]; total: number } {
  const nl = text.indexOf("\n");
  const data = JSON.parse(nl >= 0 ? text.slice(nl + 1) : text);
  const leads: Lead[] = [];
  let total = 0;
  for (const res of g(data, 0, 1) ?? []) {
    if (!Array.isArray(res)) continue;
    const ficha = res.find((c: any) => Array.isArray(c) && c.length > 30 && typeof c[11] === "string" && c[11].trim());
    if (!ficha) continue;
    total++;
    const raw = JSON.stringify(ficha);
    const phones = [...raw.matchAll(/"(\+\d[\d ().\-]{7,17})"/g)].map((m) => m[1]);
    const phone = phones.map((x) => mobile(x, p)).find(Boolean);
    if (!phone) continue;
    const web = [...raw.matchAll(/https?:\/\/[^"\\ ]{6,90}/g)].map((m) => m[0]).find((u) => !BLOQUEADOS.some((b) => u.toLowerCase().includes(b))) ?? null;
    const name = String(ficha[11]).trim();
    const address = typeof ficha[39] === "string" ? ficha[39] : "";
    const place = raw.match(/https:\/\/search\.google\.com\/local\/reviews\?placeid=([^&"]+)/)?.[1];
    const q = encodeURIComponent([name, address, city].filter(Boolean).join(", "));
    const rating = g(ficha, 4, 7);
    const cats = (g(ficha, 13) ?? []).filter((c: any) => typeof c === "string");
    leads.push({
      phone, name, niche, city, web, category: cats.slice(0, 3).join(", ") || null,
      rating: typeof rating === "number" ? rating : null, confidence: web ? "alta" : "media",
      maps_url: `https://www.google.com/maps/search/?api=1&query=${q}${place ? `&query_place_id=${place}` : ""}`,
    });
  }
  return { leads, total };
}

async function center(city: string, p: Pais): Promise<[number, number] | null> {
  const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(`${city}, ${p.name}`)}`, {
    headers: { "User-Agent": "hunter-prospector/1.0 (cloudflare worker)" },
  });
  if (!r.ok) return null;
  const d: any[] = await r.json();
  return d[0] ? [Number(d[0].lat), Number(d[0].lon)] : null;
}

const PB = (lat: number, lng: number, offset: number) =>
  `!4m12!1m3!1d20000!2d${lng}!3d${lat}!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!7i20!8i${offset}!10b1!12m3!1e3!2b1!3e3!2b1!5m1!1e2!10b1!16b1`;

/** Una cacería: hasta `pages` páginas de 20. Devuelve el resumen que se guarda en `hunts`. */
export async function hunt(env: Env, niche: string, city: string, country: string, pages = 3) {
  const p = PAISES[country] ?? PAISES.MX;
  const pt = await center(city, p);
  if (!pt) return { status: "error", error: `No encontré "${city}" en ${p.name}.`, found: 0, mobiles: 0, added: 0, repeated: 0 };
  let found = 0, mobiles = 0, added = 0, repeated = 0, error = "";
  const seen = new Set<string>();
  for (let page = 0; page < pages; page++) {
    const url = `https://www.google.com/search?tbm=map&authuser=0&hl=${p.lang}&gl=${p.code.toLowerCase()}&q=${encodeURIComponent(`${niche} en ${city}`)}&pb=${encodeURIComponent(PB(pt[0], pt[1], page * 20))}`;
    const r = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Referer: "https://www.google.com/maps/",
        "Accept-Language": `${p.lang}-${p.code},${p.lang};q=0.9`,
        Cookie: "SOCS=CAISHAgCEhJnd3NfMjAyNDA5MDMtMF9SQzEaAmVzIAEaBgiA_LyyBg; CONSENT=YES+",
      },
    });
    if (r.status === 429 || r.url.includes("/sorry/")) { error = "Google nos limitó; prueba en unos minutos."; break; }
    const text = await r.text();
    if (!r.ok || text.length < 5000) { if (page === 0) error = `Google no devolvió resultados (${r.status}).`; break; }
    let parsed;
    try { parsed = parseMaps(text, city, niche, p); } catch { error = "Google cambió el formato de respuesta."; break; }
    if (!parsed.total) break;
    found += parsed.total;
    const fresh = parsed.leads.filter((l) => !seen.has(l.phone) && seen.add(l.phone));
    mobiles += fresh.length;
    const res = await importLeads(env, fresh, `maps:${niche}@${city}`);
    added += res.added; repeated += res.repeated + res.blocked;
    if (parsed.total < 20) break;
  }
  return { status: error && !found ? "error" : "ok", error, found, mobiles, added, repeated };
}

/** Corre la cacería y deja el resultado en la tabla hunts. */
export async function runHunt(env: Env, id: string): Promise<void> {
  const h = await env.DB.prepare("SELECT * FROM hunts WHERE id = ?").bind(id).first<any>();
  if (!h) return;
  await env.DB.prepare("UPDATE hunts SET status = 'cazando' WHERE id = ?").bind(id).run();
  let r;
  try { r = await hunt(env, h.niche, h.city, h.country, h.pages ?? 3); }
  catch (e) { r = { status: "error", error: String(e), found: 0, mobiles: 0, added: 0, repeated: 0 }; }
  await env.DB.prepare("UPDATE hunts SET status = ?, error = ?, found = ?, mobiles = ?, added = ?, repeated = ?, finished_at = ? WHERE id = ?")
    .bind(r.status, r.error || null, r.found, r.mobiles, r.added, r.repeated, new Date().toISOString(), id).run();
}
