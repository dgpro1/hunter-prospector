// Canal 3 · Webs demo: negocios recién dados de alta en Connecticut → una web hecha para su negocio, pública en /w/<slug>.
// Todavía NO se envía ningún correo: aquí solo se traen las altas, se hacen las webs y se ven en el panel.
// Si el dueño pulsa "La quiero" y deja su WhatsApp, entra al CRM como ficha con origen "webdemo".
import type { Env } from "./crm.ts";
import { classifyRegistrations, fetchRegistrations, FREE_MAIL, type Candidate } from "./ctRegistry.ts";
import { brandName, buildSite, chooseTemplate, cleanSample, ENGINE_LABEL, pickEngine, writeTexts, type Engine } from "./sitegen.ts";
import { setting, setSetting } from "./auto.ts";
import { SITES } from "./sites/index.ts";
import { CSS, esc } from "./panel.ts";
import { normalizePhone } from "./leads.ts";
import { addNote } from "./store.ts";
import { notify } from "./alerts.ts";

const now = () => new Date().toISOString();
const html = (body: string, status = 200) => new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });

export function slugFor(name: string): string {
  const base = brandName(name).brand.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "") || "web";
  return `${base}-${crypto.randomUUID().slice(0, 4)}`;
}

// ─── 1. Traer altas ──────────────────────────────────────────────────────────

/** ¿Su dominio propio ya tiene una web que funciona? Entonces no le hace falta una demo. */
async function hasWebsite(email: string): Promise<boolean> {
  if (FREE_MAIL.test(email)) return false;
  const domain = email.split("@")[1];
  try {
    const r = await fetch(`https://${domain}`, { redirect: "follow", signal: AbortSignal.timeout(4000), headers: { "User-Agent": "Mozilla/5.0" } });
    return r.ok && (r.headers.get("content-type") ?? "").includes("text/html");
  } catch {
    return false;
  }
}

export type ImportResult = { raw: number; kept: number; added: number; repeated: number; withWeb: number; stats: Record<string, number> };

export async function importCT(env: Env, { days = 7, latinOnly = false, max = 150 } = {}): Promise<ImportResult> {
  const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const rows = await fetchRegistrations(since, 2500, env.SOCRATA_APP_TOKEN);
  const { leads, stats } = classifyRegistrations(rows, { latinOnly });
  // Primero los de un sector con plantilla propia, luego el resto; dentro, los más nuevos
  const ranked = [...leads].sort((a, b) => Number(b.sector !== "otro") - Number(a.sector !== "otro") || String(b.registered).localeCompare(String(a.registered)));
  const known = new Set<string>();
  for (let i = 0; i < ranked.length; i += 90) {
    const ids = ranked.slice(i, i + 90).map((l) => l.ct_id);
    const r = await env.DB.prepare(`SELECT ct_id FROM webdemos WHERE ct_id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all<{ ct_id: string }>();
    for (const row of r.results) known.add(row.ct_id);
  }
  const fresh = ranked.filter((l) => !known.has(l.ct_id)).slice(0, max);
  // Revisar si ya tienen web: solo dominios propios y como mucho 25 por vuelta (límite de peticiones del worker)
  let checks = 0, withWeb = 0;
  const keep: Candidate[] = [];
  for (const l of fresh) {
    if (!FREE_MAIL.test(l.email) && checks < 25) {
      checks++;
      if (await hasWebsite(l.email)) { withWeb++; continue; }
    } else if (!FREE_MAIL.test(l.email)) continue;   // dominio propio sin revisar: mejor no arriesgar
    keep.push(l);
  }
  const at = now();
  const stmts = keep.map((l) => env.DB.prepare(
    `INSERT OR IGNORE INTO webdemos (slug, ct_id, name, email, city, zip, state, registered, naics, sector, latino, notes, audience, template, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'CT', ?, ?, ?, ?, ?, ?, ?, 'nueva', ?, ?)`,
  ).bind(slugFor(l.name), l.ct_id, l.name, l.email, l.city || null, l.zip || null, l.registered, l.naics || null, l.sector,
    l.latino ? 1 : 0, l.notes, l.latino ? "es" : "en", chooseTemplate({ sector: l.sector, naics: l.naics, name: l.name }), at, at));
  let added = 0;
  if (stmts.length) for (const r of await env.DB.batch(stmts)) added += r.meta.changes ?? 0;
  return { raw: stats.raw, kept: stats.kept, added, repeated: known.size, withWeb, stats };
}

// ─── 2. Hacer las webs ───────────────────────────────────────────────────────

/** Pone en cola las N mejores "nuevas" (sector con plantilla primero, las más recientes). */
/** "Solo latinos" viene encendido salvo que Daniel lo apague en el panel (settings.webs_latino = off). */
export const latinOnly = async (env: Env) => (await setting(env, "webs_latino")) !== "off";

export async function queueBest(env: Env, n: number): Promise<number> {
  const latin = await latinOnly(env);
  const r = await env.DB.prepare(
    `UPDATE webdemos SET status = 'en_cola', updated_at = ?1 WHERE slug IN (
       SELECT slug FROM webdemos WHERE status = 'nueva' AND (latino = 1 OR ?3 = 0) ORDER BY (sector != 'otro') DESC, registered DESC LIMIT ?2)`,
  ).bind(now(), Math.max(1, Math.min(50, n)), latin ? 1 : 0).run();
  return r.meta.changes ?? 0;
}

/** Hace UNA web de la cola (o la que se pida). Una por invocación: así cada web tiene su propio presupuesto de CPU. */
export async function generateOne(env: Env, slug?: string): Promise<{ slug?: string; ok: boolean; error?: string }> {
  // Una que se quedó "generando" más de 20 min murió a medias: vuelve a la cola
  await env.DB.prepare("UPDATE webdemos SET status = 'en_cola' WHERE status = 'generando' AND updated_at < ?").bind(new Date(Date.now() - 20 * 60e3).toISOString()).run();
  const row = slug
    ? await env.DB.prepare("SELECT * FROM webdemos WHERE slug = ?").bind(slug).first<any>()
    : await env.DB.prepare("SELECT * FROM webdemos WHERE status = 'en_cola' ORDER BY updated_at LIMIT 1").first<any>();
  if (!row) return { ok: false, error: "no hay webs en cola" };
  const claim = await env.DB.prepare("UPDATE webdemos SET status = 'generando', error = NULL, updated_at = ? WHERE slug = ? AND status != 'generando'").bind(now(), row.slug).run();
  if (!claim.meta.changes) return { slug: row.slug, ok: false, error: "ya se está haciendo" };
  try {
    const site = await buildSite(env, SITES, {
      name: row.name, city: row.city, state: row.state, email: row.email, sector: row.sector, naics: row.naics, registered: row.registered,
    }, row.audience === "es" ? "es" : "en", writeTexts, pickEngine(env, await setting(env, "webs_ia")));
    await env.DB.prepare("UPDATE webdemos SET status = 'lista', html = ?, template = ?, cost = ?, generated_at = ?, updated_at = ? WHERE slug = ?")
      .bind(site.html, site.template, site.usage.cost ?? null, now(), now(), row.slug).run();
    return { slug: row.slug, ok: true };
  } catch (e: any) {
    await env.DB.prepare("UPDATE webdemos SET status = 'error', error = ?, updated_at = ? WHERE slug = ?").bind(String(e?.message ?? e).slice(0, 300), now(), row.slug).run();
    return { slug: row.slug, ok: false, error: String(e?.message ?? e) };
  }
}

/**
 * Encargo dejado en settings (clave webs_encargo, JSON {"days":7,"n":10,"latino":false}): el cron lo hace una vez y lo borra.
 * Sirve para lanzar "trae altas y haz N webs" sin abrir el panel.
 */
export async function runOrder(env: Env): Promise<string | null> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'webs_encargo'").first<{ value: string }>();
  if (!row) return null;
  await env.DB.prepare("DELETE FROM settings WHERE key = 'webs_encargo'").run();
  const o = JSON.parse(row.value || "{}");
  const r = await importCT(env, { days: Number(o.days) || 14, latinOnly: o.latino === undefined ? await latinOnly(env) : Boolean(o.latino) });
  const queued = o.n === 0 ? 0 : await queueBest(env, Number(o.n) || 10);   // n: 0 → solo traer, sin hacer webs
  const msg = `encargo: ${r.raw} altas, ${r.kept} pasan filtros, ${r.added} nuevas, ${r.withWeb} con web; ${queued} en cola`;
  await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('webs_encargo_resultado', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(msg).run();
  return msg;
}

// ─── 3. Página pública ───────────────────────────────────────────────────────

/** Lo que convierte la web en "su demo": no se indexa, barra de muestra con "La quiero" y aviso de visita. */
export function decorate(page: string, d: { slug: string; name: string; audience: string }, preview: boolean): string {
  const en = d.audience !== "es";
  const brand = esc(brandName(d.name).brand);
  const bar = `
<style>
.hp-demo{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:2147483000;display:flex;align-items:center;gap:14px;max-width:calc(100vw - 24px);padding:10px 10px 10px 18px;border-radius:999px;background:rgba(17,17,17,.92);color:#fff;font:500 14px/1.3 system-ui,-apple-system,"Segoe UI",sans-serif;box-shadow:0 12px 32px -12px rgba(0,0,0,.55)}
.hp-demo span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hp-demo a{flex:none;padding:9px 16px;border-radius:999px;background:#ff6a00;color:#120800;font-weight:700;text-decoration:none}
.hp-demo button{flex:none;width:30px;height:30px;border:0;border-radius:50%;background:transparent;color:#fff;font-size:18px;line-height:1;cursor:pointer}
@media (max-width:760px){.hp-demo{bottom:88px;width:calc(100vw - 24px);border-radius:18px;font-size:12.5px;gap:8px;padding-left:14px}.hp-demo span{white-space:normal;line-height:1.35}}
</style>
<div class="hp-demo" role="complementary" aria-label="${en ? "Sample website" : "Web de muestra"}">
  <span>${en ? `Sample website made for ${brand} · photos and details are examples` : `Web de muestra hecha para ${brand} · fotos y datos de ejemplo`}</span>
  <a href="/w/${esc(d.slug)}/quiero">${en ? "I want it" : "La quiero"}</a>
  <button type="button" aria-label="${en ? "Close" : "Cerrar"}" onclick="this.parentNode.remove()">×</button>
</div>
${preview ? "" : `<script>setTimeout(function(){try{navigator.sendBeacon("/w/${esc(d.slug)}/visto")}catch(e){}},1500)</script>`}
`;
  return cleanSample(page, d.slug, brandName(d.name).brand, en)
    .replace(/<head([^>]*)>/i, (m) => `${m}\n<meta name="robots" content="noindex, nofollow">`)
    .replace(/<\/body>(?![\s\S]*<\/body>)/i, `${bar}</body>`);
}

export async function publicRoute(req: Request, env: Env, slug: string, sub: string | undefined): Promise<Response> {
  const d = await env.DB.prepare("SELECT slug, name, email, city, audience, status, html, views, lead FROM webdemos WHERE slug = ?").bind(slug).first<any>();
  if (!d || d.status !== "lista" || !d.html) return html("<h1>Not found</h1>", 404);
  const url = new URL(req.url);
  if (sub === "/visto" && req.method === "POST") {
    await env.DB.prepare("UPDATE webdemos SET views = views + 1, last_view_at = ? WHERE slug = ?").bind(now(), slug).run();
    if (!d.views && d.lead) await notify(env, d.lead, "demo_abierta", "abrió su web demo");
    return new Response(null, { status: 204 });
  }
  if (sub === "/quiero") return wantIt(req, env, d);
  return new Response(decorate(d.html, d, url.searchParams.has("yo")), {
    headers: { "Content-Type": "text/html; charset=utf-8", "X-Robots-Tag": "noindex, nofollow", "Cache-Control": "no-store" },
  });
}

/** "La quiero": deja su WhatsApp → ficha en el CRM con origen webdemo, etapa "respondió", nota y aviso. */
async function wantIt(req: Request, env: Env, d: any): Promise<Response> {
  const en = d.audience !== "es";
  const brand = esc(brandName(d.name).brand);
  const t = en
    ? { title: `Your website, ${brand}`, lead: "Leave your WhatsApp and we'll get it live with your real photos and details.", name: "Your name", phone: "WhatsApp (with area code)", send: "Send", ok: "Got it! We'll message you on WhatsApp shortly.", bad: "Please write a valid phone number with area code." }
    : { title: `Tu web, ${brand}`, lead: "Déjanos tu WhatsApp y la ponemos en línea con tus fotos y datos reales.", name: "Tu nombre", phone: "WhatsApp (con código de área)", send: "Enviar", ok: "¡Listo! Te escribimos por WhatsApp en breve.", bad: "Escribe un teléfono válido con código de área." };
  let msg = "";
  if (req.method === "POST") {
    const f = await req.formData();
    const who = String(f.get("name") ?? "").trim().slice(0, 80);
    let digits = String(f.get("phone") ?? "").replace(/\D/g, "");
    if (digits.length === 10) digits = "1" + digits;            // número de EE. UU. sin el 1
    const phone = normalizePhone(digits);
    if (!phone) msg = `<p class="muted" style="color:#ff6a6a">${t.bad}</p>`;
    else {
      const at = now();
      await env.DB.prepare(
        `INSERT OR IGNORE INTO leads (phone, name, city, niche, origin, stage, status, batch, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'webdemo', 'respondio', 'enviado', 'webdemo', ?, ?)`,
      ).bind(phone, brandName(d.name).brand, d.city ?? null, null, at, at).run();
      await env.DB.prepare("UPDATE webdemos SET lead = ?, updated_at = ? WHERE slug = ?").bind(phone, at, d.slug).run();
      await addNote(env, phone, `Pidió su web demo (${env.PUBLIC_URL}/w/${d.slug}). Nombre: ${who || "—"} · correo: ${d.email}`);
      await notify(env, phone, "respondio", `quiere su web demo${who ? ` (${who})` : ""}`);
      return html(shell(t.title, `<h1>${t.title}</h1><p>${t.ok}</p><p><a href="/w/${esc(d.slug)}">←</a></p>`));
    }
  }
  return html(shell(t.title, `<h1>${t.title}</h1><p>${t.lead}</p>${msg}
<form method="post" class="card"><label>${t.name}<input name="name" autocomplete="name"></label>
<label>${t.phone}<input name="phone" type="tel" required autocomplete="tel"></label><button>${t.send}</button></form>`));
}

const shell = (title: string, body: string) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${title}</title><style>${CSS}label{display:flex;flex-direction:column;gap:4px;color:var(--m);font-size:13px}input{background:#18130f;color:var(--fg);border:1px solid var(--l);border-radius:8px;padding:10px;font:inherit}</style></head><body><main>${body}</main></body></html>`;

// ─── 4. Panel ────────────────────────────────────────────────────────────────

const SECTOR: Record<string, string> = { construccion: "Construcción", limpieza: "Limpieza", jardineria: "Jardinería", belleza: "Belleza", comida: "Comida", transporte: "Transporte", taxes: "Impuestos", auto: "Auto", seguros: "Seguros", salud: "Salud", eventos: "Eventos", otro: "Otro" };
const STATUS: Record<string, string> = { nueva: "Nueva", en_cola: "En cola", generando: "Haciéndose…", lista: "Lista", error: "Error", descartada: "Descartada" };

export async function panelRoute(req: Request, url: URL, env: Env): Promise<Response> {
  const back = (m: string) => Response.redirect(new URL(`/panel/webs?m=${encodeURIComponent(m)}`, url).toString(), 303);
  if (req.method === "POST") {
    const f = await req.formData();
    if (url.pathname === "/panel/webs/traer") {
      try {
        const latin = f.get("latino") === "on";
        await setSetting(env, "webs_latino", latin ? "on" : "off");
        const r = await importCT(env, { days: Number(f.get("days") ?? 14) || 14, latinOnly: latin });
        return back(`Registro: ${r.raw} altas con correo, ${r.kept} pasan los filtros, ${r.added} nuevas en tu lista (${r.repeated} ya estaban, ${r.withWeb} ya tienen web).`);
      } catch (e: any) { return back(`No pude leer el registro: ${e.message}`); }
    }
    if (url.pathname === "/panel/webs/ia") {
      const e = String(f.get("ia") ?? "");
      if (e in ENGINE_LABEL) await setSetting(env, "webs_ia", e);
      const used = pickEngine(env, e);
      return back(used === e ? `Las webs se escriben ahora con ${ENGINE_LABEL[used]}.` : `Falta la clave de ese motor: se usa ${ENGINE_LABEL[used]}.`);
    }
    if (url.pathname === "/panel/webs/cola") {
      const n = await queueBest(env, Number(f.get("n") ?? 10) || 10);
      return back(`${n} webs en cola. Se hace una cada 3 minutos; recarga para ver cómo van.`);
    }
    const act = url.pathname.match(/^\/panel\/webs\/([a-z0-9-]+)\/(rehacer|descartar|cola)$/);
    if (act) {
      const [, slug, a] = act;
      const status = a === "descartar" ? "descartada" : "en_cola";
      await env.DB.prepare("UPDATE webdemos SET status = ?, updated_at = ? WHERE slug = ? AND status != 'generando'").bind(status, now(), slug).run();
      return back(a === "descartar" ? "Descartada." : "En cola: estará en unos minutos.");
    }
  }
  return html(await renderWebs(env, url.searchParams.get("m")));
}

async function renderWebs(env: Env, msg: string | null): Promise<string> {
  const counts = await env.DB.prepare("SELECT status, COUNT(*) n, SUM(COALESCE(cost,0)) c FROM webdemos GROUP BY status").all<{ status: string; n: number; c: number }>();
  const by = Object.fromEntries(counts.results.map((r) => [r.status, r]));
  const cost = counts.results.reduce((s, r) => s + (r.c ?? 0), 0);
  const ready = await env.DB.prepare("SELECT slug, name, email, city, sector, template, audience, views, lead, cost, generated_at FROM webdemos WHERE status = 'lista' ORDER BY generated_at DESC LIMIT 100").all<any>();
  const work = await env.DB.prepare("SELECT slug, name, city, sector, status, error, updated_at FROM webdemos WHERE status IN ('en_cola','generando','error') ORDER BY updated_at DESC LIMIT 50").all<any>();
  const latin = await latinOnly(env);
  const fresh = await env.DB.prepare(`SELECT slug, name, email, city, sector, registered, latino, notes FROM webdemos WHERE status = 'nueva' ${latin ? "AND latino = 1" : ""} ORDER BY (sector != 'otro') DESC, registered DESC LIMIT 40`).all<any>();
  const n = (k: string) => by[k]?.n ?? 0;
  const chosen = await setting(env, "webs_ia");
  const engine = pickEngine(env, chosen);
  const engineForm = `<form method="post" action="/panel/webs/ia" class="row" style="align-items:center;flex-wrap:wrap"><label>Motor de IA <select name="ia">${(Object.keys(ENGINE_LABEL) as Engine[]).map((k) => `<option value="${k}" ${k === engine ? "selected" : ""}>${esc(ENGINE_LABEL[k])}</option>`).join("")}</select></label><button class="ghost">Usar</button></form>${env.GEMINI_API_KEY ? "" : '<p class="muted">Para Gemini gratis: crea una clave en aistudio.google.com/apikey y guárdala en Cloudflare como secreto GEMINI_API_KEY.</p>'}`;
  const lang = (a: string) => (a === "es" ? "ES/EN" : "EN");
  const btn = (slug: string, a: string, label: string, ghost = true) => `<form method="post" action="/panel/webs/${esc(slug)}/${a}" style="display:inline"><button class="${ghost ? "ghost" : ""}" style="padding:4px 12px;font-size:13px">${label}</button></form>`;
  const readyRows = ready.results.map((d) => `<tr><td><b>${esc(brandName(d.name).brand)}</b><br><span class="muted">${esc(d.city ?? "")} · ${esc(SECTOR[d.sector] ?? d.sector)} · ${lang(d.audience)} · ${esc(d.email)}</span></td>
    <td>${d.views ? `👀 ${d.views}` : ""}${d.lead ? " 🔥 la pidió" : ""}</td>
    <td style="white-space:nowrap"><a href="/w/${esc(d.slug)}?yo=1" target="_blank">Ver web ↗</a> ${btn(d.slug, "rehacer", "Rehacer")} ${btn(d.slug, "descartar", "Descartar")}</td></tr>`).join("");
  const workRows = work.results.map((d) => `<tr><td>${esc(brandName(d.name).brand)} <span class="muted">${esc(d.city ?? "")} · ${esc(SECTOR[d.sector] ?? d.sector)}</span></td>
    <td>${esc(STATUS[d.status] ?? d.status)}${d.error ? `<br><span class="muted">${esc(d.error)}</span>` : ""}</td><td>${d.status === "error" ? btn(d.slug, "cola", "Reintentar") : ""}</td></tr>`).join("");
  const freshRows = fresh.results.map((d) => `<tr><td>${esc(brandName(d.name).brand)}<br><span class="muted">${esc(d.city ?? "")} · alta ${esc(d.registered ?? "")}${d.latino ? " · 🌎 latino" : ""}</span></td>
    <td>${esc(SECTOR[d.sector] ?? d.sector)}</td><td>${btn(d.slug, "cola", "Hacer web", false)} ${btn(d.slug, "descartar", "✕")}</td></tr>`).join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Webs demo · Prospector</title><style>${CSS}body{padding-top:calc(24px + env(safe-area-inset-top))}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px}.kpi{background:var(--s);border:1px solid var(--l);border-radius:14px;padding:12px}.kpi b{display:block;font-size:24px;color:var(--a)}
input,select{background:#18130f;color:var(--fg);border:1px solid var(--l);border-radius:8px;padding:6px 8px;font:inherit}label{color:var(--m);font-size:13px;display:inline-flex;gap:6px;align-items:center}
.msg{background:#2a1606;border:1px solid #6b3410;border-radius:12px;padding:10px 14px}
</style></head><body><main>
<h1 style="display:flex;justify-content:space-between;align-items:center;gap:8px">Prospector <span>· Webs demo</span><a href="/panel/webs" aria-label="Actualizar" style="margin-left:auto;font-size:20px;text-decoration:none">↻</a></h1>
<nav class="nav"><a href="/panel#inicio">Inicio</a><a href="/panel#pipeline">Pipeline</a><a href="/panel#envios">Envíos</a><a href="/panel/webs" class="on">Webs demo</a></nav>
${msg ? `<div class="msg">${esc(msg)}</div>` : ""}
<div class="kpis"><div class="kpi"><b>${n("nueva")}</b>Por hacer</div><div class="kpi"><b>${n("en_cola") + n("generando")}</b>Haciéndose</div><div class="kpi"><b>${n("lista")}</b>Listas</div><div class="kpi"><b>${n("error")}</b>Con error</div><div class="kpi"><b>$${cost.toFixed(2)}</b>Gastado en IA</div></div>
<div class="card"><b>1 · Traer negocios nuevos de Connecticut</b>
<p class="muted">Altas activas con correo del registro público (data.ct.gov). Quita gestorías, holdings y los que ya tienen web.</p>
<form method="post" action="/panel/webs/traer" class="row" style="flex-wrap:wrap;align-items:center"><label>Últimos <input name="days" type="number" value="14" min="1" max="30" style="width:70px"> días</label><label><input type="checkbox" name="latino" ${latin ? "checked" : ""}> Solo latinos (web bilingüe)</label><button>Traer altas</button></form></div>
<div class="card"><b>2 · Hacer webs</b><p class="muted">La IA adapta una plantilla a cada negocio (los latinos reciben web bilingüe). Una cada 3 minutos. Nada se envía por correo todavía.</p>
${engineForm}<form method="post" action="/panel/webs/cola" class="row" style="align-items:center"><label>Hacer las mejores <input name="n" type="number" value="10" min="1" max="50" style="width:70px"></label><button>Poner en cola</button></form></div>
<section><h2>Listas (${n("lista")})</h2><div class="t"><table>${readyRows || '<tr><td class="muted">Todavía no hay webs listas.</td></tr>'}</table></div></section>
${workRows ? `<section><h2>Haciéndose y errores</h2><div class="t"><table>${workRows}</table></div></section>` : ""}
<section><h2>Por hacer (${n("nueva")})</h2><div class="t"><table>${freshRows || '<tr><td class="muted">Trae altas del registro para empezar.</td></tr>'}</table></div></section>
</main></body></html>`;
}
