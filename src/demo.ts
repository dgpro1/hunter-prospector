// Demo personalizada: un link público con un chat de IA que atiende como el negocio del prospecto.
import type { Env } from "./crm.ts";
import { TONE } from "./brain.ts";
import { addNote } from "./store.ts";
import { shortName } from "./offers.ts";

const now = () => new Date().toISOString();
const DAILY_LIMIT = 60; // mensajes por demo y día: tope de gasto si el link circula

export type Demo = {
  slug: string; lead: string; business: string; city: string | null; category: string | null;
  knowledge: string | null; services: string | null; hours: string | null; views: number; messages: number;
};

function slugify(name: string): string {
  const base = name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32);
  return `${base || "demo"}-${crypto.randomUUID().slice(0, 4)}`;
}

/** Texto plano de su web (primeros ~6.000 caracteres) para que la IA conozca servicios, horario y tono. */
export async function readWebsite(url: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; HunterDemo/1.0)" }, redirect: "follow", cf: { cacheTtl: 3600 } } as RequestInit);
    if (!r.ok || !(r.headers.get("content-type") ?? "").includes("html")) return null;
    const html = (await r.text()).slice(0, 400_000);
    const text = html
      .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&[a-z#0-9]+;/gi, " ")
      .replace(/\s+/g, " ").trim();
    return text.length > 80 ? text.slice(0, 6000) : null;
  } catch {
    return null;
  }
}

export async function createDemo(env: Env, leadId: string, opts: { services?: string; hours?: string } = {}): Promise<Demo> {
  const lead = await env.DB.prepare("SELECT * FROM leads WHERE phone = ?").bind(leadId).first<any>();
  if (!lead) throw new Error("No existe el prospecto");
  const existing = await env.DB.prepare("SELECT * FROM demos WHERE lead = ?").bind(leadId).first<Demo>();
  const knowledge = existing?.knowledge ?? (await readWebsite(lead.web));
  if (existing) {
    await env.DB.prepare("UPDATE demos SET services = COALESCE(?, services), hours = COALESCE(?, hours), knowledge = ? WHERE slug = ?")
      .bind(opts.services ?? null, opts.hours ?? null, knowledge, existing.slug).run();
    return (await env.DB.prepare("SELECT * FROM demos WHERE slug = ?").bind(existing.slug).first<Demo>())!;
  }
  const slug = slugify(shortName(lead.name));
  await env.DB.prepare(
    `INSERT INTO demos (slug, lead, business, city, category, knowledge, services, hours, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(slug, leadId, shortName(lead.name), lead.city, lead.category, knowledge, opts.services ?? null, opts.hours ?? null, now()).run();
  await addNote(env, leadId, `Demo creada${knowledge ? " (leyó su web)" : ""}: /demo/${slug}`);
  return (await env.DB.prepare("SELECT * FROM demos WHERE slug = ?").bind(slug).first<Demo>())!;
}

export async function getDemo(env: Env, slug: string): Promise<Demo | null> {
  return env.DB.prepare("SELECT * FROM demos WHERE slug = ?").bind(slug).first<Demo>();
}

/** Primera visita: aviso en el CRM (señal de interés). */
export async function trackView(env: Env, d: Demo): Promise<void> {
  await env.DB.prepare("UPDATE demos SET views = views + 1, last_view_at = ? WHERE slug = ?").bind(now(), d.slug).run();
  if (d.views === 0) await addNote(env, d.lead, "🔥 Abrió la demo por primera vez");
}

function systemPrompt(d: Demo): string {
  return [
    `Eres el asistente de WhatsApp de ${d.business}${d.category ? ` (${d.category})` : ""}${d.city ? ` en ${d.city}` : ""}.`,
    "Atiendes a pacientes o clientes: respondes al instante, con calidez, resuelves dudas y tu objetivo es AGENDAR una cita (pide nombre, servicio y día/hora preferidos y confirma).",
    "Mensajes cortos como en WhatsApp (1–3 frases), máximo 1 emoji, sin markdown.",
    TONE,
    "Usa solo la información del negocio que tienes abajo. Si no sabes un dato (precio exacto, disponibilidad real), dilo con naturalidad y ofrece que el equipo lo confirme; nunca inventes precios.",
    "Esto es una DEMO: si preguntan quién te hizo o cómo funciona, di que eres un asistente de IA creado por Hunter AI para mostrar cómo se vería en su negocio.",
    d.services ? `Servicios: ${d.services}` : "",
    d.hours ? `Horario: ${d.hours}` : "",
    d.knowledge ? `Información de su web:\n${d.knowledge}` : "No tienes su web: usa conocimiento general del giro sin inventar datos concretos.",
  ].filter(Boolean).join("\n");
}

export async function demoChat(env: Env, d: Demo, history: { role: string; content: string }[], own = false): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  const used = await env.DB.prepare("SELECT COUNT(*) n FROM demo_messages WHERE slug = ? AND day = ?").bind(d.slug, today).first<{ n: number }>();
  if ((used?.n ?? 0) >= DAILY_LIMIT) return "Por hoy la demo llegó a su límite de mensajes 🙏 Escríbele a Daniel y te la deja activa.";
  const msgs = history.slice(-12).map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content ?? "").slice(0, 800) }));
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: env.OPENROUTER_MODEL, max_tokens: 250, messages: [{ role: "system", content: systemPrompt(d) }, ...msgs] }),
  });
  if (!res.ok) throw new Error(`OpenRouter → ${res.status}`);
  const text = String(((await res.json()) as any)?.choices?.[0]?.message?.content ?? "").trim();
  await env.DB.prepare("INSERT INTO demo_messages (slug, day, created_at) VALUES (?, ?, ?)").bind(d.slug, today, now()).run();
  if (!own) {
    await env.DB.prepare("UPDATE demos SET messages = messages + 1 WHERE slug = ?").bind(d.slug).run();
    if (d.messages === 0) await addNote(env, d.lead, "💬 Empezó a probar la demo");
  }
  return text;
}

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Página pública de la demo (sin contraseña). */
export function renderDemo(d: Demo, contact: string | null): string {
  const initials = d.business.split(/\s+/).filter((w) => /^[A-Za-zÁÉÍÓÚÑ0-9]/.test(w)).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  const chips = ["Hola, ¿tienen citas esta semana?", "¿Qué servicios manejan?", "¿Cuál es su horario?", "Quiero agendar una valoración"];
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(d.business)} · Asistente con IA</title><meta name="robots" content="noindex">
<meta property="og:title" content="${esc(d.business)} · así contestaría tu asistente con IA"><meta property="og:description" content="Demo creada por Hunter AI para ${esc(d.business)}">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
:root{--bg:#0b141a;--panel:#111b21;--in:#202c33;--out:#005c4b;--fg:#e9edef;--mut:#8696a0;--a:#ff6a00}
*{box-sizing:border-box;margin:0}html,body{height:100%}
body{background:#050505;color:var(--fg);font:15px/1.45 Inter,system-ui,sans-serif;display:flex;justify-content:center}
.app{width:100%;max-width:480px;height:100dvh;display:flex;flex-direction:column;background:var(--bg);background-image:radial-gradient(rgba(255,255,255,.025) 1px,transparent 1px);background-size:18px 18px;border-left:1px solid #1d272d;border-right:1px solid #1d272d}
header{display:flex;align-items:center;gap:12px;padding:12px 16px;background:var(--panel);border-bottom:1px solid #1d272d}
.av{width:42px;height:42px;border-radius:50%;background:linear-gradient(135deg,#ffb27a,var(--a));display:grid;place-items:center;font-weight:700;color:#1a0b00;flex:none}
header b{display:block;font-size:16px}header small{color:#25d366;font-size:12.5px}
.banner{margin:12px auto 4px;max-width:88%;text-align:center;font-size:12px;color:#ffd7b8;background:rgba(255,106,0,.12);border:1px solid rgba(255,106,0,.3);border-radius:10px;padding:6px 10px}
#log{flex:1;overflow-y:auto;padding:10px 14px 14px;display:flex;flex-direction:column;gap:6px}
.m{max-width:82%;padding:7px 10px 18px;border-radius:10px;position:relative;white-space:pre-wrap;word-wrap:break-word;font-size:14.5px;animation:pop .18s ease-out}
.m time{position:absolute;right:8px;bottom:3px;font-size:10.5px;color:rgba(233,237,239,.6)}
.in{align-self:flex-start;background:var(--in);border-top-left-radius:2px}.out{align-self:flex-end;background:var(--out);border-top-right-radius:2px}
.typing{align-self:flex-start;background:var(--in);border-radius:10px;padding:10px 14px;display:flex;gap:4px}
.typing i{width:7px;height:7px;border-radius:50%;background:var(--mut);animation:b 1s infinite}.typing i:nth-child(2){animation-delay:.15s}.typing i:nth-child(3){animation-delay:.3s}
@keyframes b{0%,60%,100%{opacity:.3;transform:translateY(0)}30%{opacity:1;transform:translateY(-3px)}}
@keyframes pop{from{opacity:0;transform:translateY(6px)}}
.chips{display:flex;gap:6px;overflow-x:auto;padding:6px 12px;scrollbar-width:none}
.chips button{flex:none;background:#1a252c;color:var(--fg);border:1px solid #2a3942;border-radius:999px;padding:6px 12px;font:inherit;font-size:13px;cursor:pointer}
form{display:flex;gap:8px;padding:8px 10px calc(8px + env(safe-area-inset-bottom));background:var(--panel)}
input{flex:1;background:#2a3942;border:0;border-radius:22px;padding:11px 16px;color:var(--fg);font:inherit;outline:none}
form button{width:44px;height:44px;border-radius:50%;border:0;background:#00a884;color:#fff;font-size:18px;cursor:pointer}
.cta{display:block;text-align:center;font-size:12.5px;color:var(--mut);padding:8px 12px;background:#0d1418;border-top:1px solid #1d272d}
.cta a{color:var(--a);font-weight:600;text-decoration:none}
</style></head><body><div class="app">
<header><div class="av">${esc(initials || "IA")}</div><div><b>${esc(d.business)}</b><small>en línea · responde al instante</small></div></header>
<div id="log"><div class="banner">✨ Demo creada por Hunter AI para ${esc(d.business)}. Escribe como si fueras un paciente.</div></div>
<div class="chips" id="chips">${chips.map((c) => `<button type="button">${esc(c)}</button>`).join("")}</div>
<form id="f"><input id="t" placeholder="Escribe un mensaje" autocomplete="off" maxlength="600"><button aria-label="Enviar">➤</button></form>
<div class="cta">¿Lo quieres así en tu WhatsApp? ${contact ? `<a href="https://wa.me/${esc(contact)}?text=${encodeURIComponent(`Hola Daniel, vi la demo de ${d.business}`)}">Habla con Daniel</a>` : "Respóndele a Daniel por WhatsApp"}</div>
</div><script>
const log=document.getElementById("log"),t=document.getElementById("t"),hist=[];
const hm=()=>new Date().toLocaleTimeString([], {hour:"numeric",minute:"2-digit"});
function add(role,text){const d=document.createElement("div");d.className="m "+(role==="user"?"out":"in");d.textContent=text;const tm=document.createElement("time");tm.textContent=hm();d.appendChild(tm);log.appendChild(d);log.scrollTop=log.scrollHeight;hist.push({role,content:text})}
async function send(text){
  text=text.trim();if(!text)return;add("user",text);t.value="";document.getElementById("chips").style.display="none";
  const ty=document.createElement("div");ty.className="typing";ty.innerHTML="<i></i><i></i><i></i>";log.appendChild(ty);log.scrollTop=log.scrollHeight;
  try{const r=await fetch(location.pathname+"/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({messages:hist,own:new URLSearchParams(location.search).has("yo")})});const d=await r.json();ty.remove();add("assistant",d.text||"Perdón, tuve un problema. ¿Me repites?")}
  catch(e){ty.remove();add("assistant","Perdón, se me fue la señal. ¿Me lo repites?")}
}
document.getElementById("f").onsubmit=e=>{e.preventDefault();send(t.value)};
document.querySelectorAll("#chips button").forEach(b=>b.onclick=()=>send(b.textContent));
const BIZ=${JSON.stringify(d.business).replace(/</g, "\\u003c")};
setTimeout(()=>add("assistant","¡Hola! 👋 Gracias por escribir a "+BIZ+". ¿En qué te puedo ayudar hoy?"),500);
</script></body></html>`;
}
