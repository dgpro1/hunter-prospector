// Panel del Prospector: borradores por aprobar y sus prospectos con el semáforo.
import { humanDuration } from "./timer.ts";

export const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
export const COLORS: Record<string, string> = { verde: "#35c47c", amarillo: "#f2b33d", naranja: "#ff6a00", rojo: "#ff4d4d", gris: "#8a8079" };
export const BRANCH: Record<string, string> = {
  tarde: "Respondió tarde", rapido: "Respondió rápido", equipo: "Contestó el equipo",
  dueno: "Contestó el dueño", seguimiento: "Seguimiento", cierre: "No le interesa",
};

export const CSS = `
:root{--bg:#050505;--s:#100d0a;--l:#2b231d;--fg:#f6efe8;--m:#a59a90;--a:#ff6a00}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif;padding:24px max(16px,env(safe-area-inset-left))}
main{max-width:860px;margin:auto;display:flex;flex-direction:column;gap:24px}h1{margin:0;font-size:24px}h1 span{color:var(--a)}
.card{background:var(--s);border:1px solid var(--l);border-radius:14px;padding:16px;display:flex;flex-direction:column;gap:10px}
.head{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.muted{color:var(--m);font-size:13px}
.dot{width:10px;height:10px;border-radius:50%;display:inline-block}
textarea{width:100%;background:#18130f;color:var(--fg);border:1px solid var(--l);border-radius:10px;padding:10px;font:inherit}
.row{display:flex;gap:8px}button{background:var(--a);color:#120800;border:0;border-radius:999px;padding:8px 18px;font-weight:600;cursor:pointer}
button.ghost{background:transparent;color:var(--a);border:1px solid var(--a)}
.t{overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:14px}td{padding:8px;border-bottom:1px solid var(--l)}
.nav{display:flex;gap:8px;flex-wrap:wrap}.nav a{color:var(--a);text-decoration:none;border:1px solid var(--l);border-radius:999px;padding:6px 14px;font-size:14px}.nav a.on{background:var(--a);color:#120800;border-color:var(--a)}
a{color:var(--a)}
`;

export const nav = (on: string) => `<nav class="nav"><a href="/panel" class="${on === "panel" ? "on" : ""}">Bandeja</a><a href="/panel/simular" class="${on === "sim" ? "on" : ""}">Simulador</a></nav>`;

export function renderPanel(drafts: any[], prospects: any[], crmBase: string): string {
  const dot = (c: string) => `<i class="dot" style="background:${COLORS[c] ?? COLORS.gris}"></i>`;
  const time = (m: number | null) => (m === null || m === undefined ? "sin respuesta" : humanDuration(m));
  const cards = drafts.map((d) => `
    <form class="card" method="post" action="/panel/drafts/${esc(d.id)}/send">
      <div class="head">${dot(d.color)}<b><a href="/panel/chat/${esc(d.conversation_id)}">${esc(d.contact_name || "Sin nombre")}</a></b><span class="muted">#${esc(d.number)} · ${esc(BRANCH[d.branch] ?? d.branch)} · respondió en ${esc(time(d.response_minutes))}</span></div>
      <textarea name="text" id="t-${esc(d.id)}" rows="6">${esc(d.text)}</textarea>
      <div class="row"><button type="submit">Enviar</button>
      <button type="submit" class="ghost" formaction="/panel/drafts/${esc(d.id)}/discard">Descartar</button></div>
    </form>`).join("") || `<p class="muted">No hay respuestas por aprobar.</p>`;
  const rows = prospects.map((p) => `<tr><td>${dot(p.color)}</td><td><a href="/panel/chat/${esc(p.conversation_id)}">${esc(p.contact_name || "Sin nombre")}</a></td>
    <td>${esc(time(p.response_minutes))}</td><td>${esc(p.who_replied ?? "")}</td><td>${esc(BRANCH[p.branch] ?? "")}</td><td>${esc(p.status)}</td></tr>`).join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Prospector · Hunter AI</title>
<style>${CSS}</style></head><body><main>
<h1>Prospector <span>· Canal 2</span></h1>${nav("panel")}
<section><h2>Respuestas por aprobar (${drafts.length})</h2>${cards}</section>
<section><h2>Prospectos</h2><div class="t"><table>${rows || '<tr><td class="muted">Todavía no hay prospectos.</td></tr>'}</table></div></section>
<p class="muted">Los chats viven en el CRM: <a style="color:var(--a)" href="${esc(crmBase)}">${esc(crmBase)}</a></p>
</main></body></html>`;
}
