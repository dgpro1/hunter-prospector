// Vistas extra del panel: espejo de un chat del CRM y simulador de conversaciones.
import { BRANCH, COLORS, CSS, esc, nav } from "./panel.ts";
import { humanDuration } from "./timer.ts";

const EXTRA = `
.chat{background:var(--s);border:1px solid var(--l);border-radius:14px;padding:16px;display:flex;flex-direction:column;gap:8px;min-height:240px;max-height:60vh;overflow-y:auto}
.b{max-width:80%;padding:8px 12px;border-radius:12px;white-space:pre-wrap;word-wrap:break-word}
.b small{display:block;color:var(--m);font-size:11px;margin-top:2px}
.in{align-self:flex-start;background:#1d1813;border:1px solid var(--l)}
.out{align-self:flex-end;background:#3a1e08;border:1px solid #6b3410}
.act{align-self:center;color:var(--m);font-size:12px}
.chips{display:flex;gap:6px;flex-wrap:wrap}.chip{border:1px solid var(--l);border-radius:999px;padding:3px 10px;font-size:13px;display:inline-flex;gap:6px;align-items:center}
input[type=number]{width:90px;background:#18130f;color:var(--fg);border:1px solid var(--l);border-radius:8px;padding:6px}
label{font-size:13px;color:var(--m);display:flex;gap:8px;align-items:center}
`;

const page = (title: string, on: string, body: string) => `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · Prospector</title>
<style>${CSS}${EXTRA}</style></head><body><main><h1>Prospector <span>· Canal 2</span></h1>${nav(on)}${body}</main></body></html>`;

/** Espejo de un chat del CRM: se actualiza solo cada 10 s, con el borrador pendiente y una caja para escribir. */
export function renderChat(conversationId: string, prospect: any, pending: any): string {
  const id = esc(conversationId);
  const color = prospect?.color ?? "gris";
  const info = prospect
    ? `<div class="chips"><span class="chip"><i class="dot" style="background:${COLORS[color] ?? COLORS.gris}"></i>${
        prospect.response_minutes == null ? "sin respuesta" : "respondió en " + esc(humanDuration(prospect.response_minutes))
      }</span><span class="chip">${esc(prospect.who_replied ?? "")}</span><span class="chip">${esc(BRANCH[prospect.branch] ?? "")}</span><span class="chip">${esc(prospect.status)}</span></div>`
    : "";
  const draftBox = pending
    ? `<form class="card" method="post" action="/panel/drafts/${esc(pending.id)}/send"><input type="hidden" name="back" value="/panel/chat/${id}">
       <b>Borrador sugerido · ${esc(BRANCH[pending.branch] ?? pending.branch)}</b>
       <textarea name="text" rows="5">${esc(pending.text)}</textarea>
       <div class="row"><button>Enviar</button><button class="ghost" formaction="/panel/drafts/${esc(pending.id)}/discard">Descartar</button></div></form>`
    : `<form class="card" method="post" action="/panel/chat/${id}/reply"><b>Escribir</b>
       <textarea name="text" rows="3" placeholder="Tu mensaje sale por el CRM"></textarea><div class="row"><button>Enviar</button></div></form>`;
  return page("Chat", "panel", `
<section><h2>${esc(prospect?.contact_name || "Chat")}</h2>${info}</section>
<div class="chat" id="chat"><p class="muted">Cargando…</p></div>
${draftBox}
<script>
const box=document.getElementById("chat");
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[c]);
const who={ai:"IA del CRM",human:"Tú",system:"Sistema",visitor:"Negocio"};
async function load(){
  try{
    const r=await fetch("/panel/chat/${id}/messages.json",{cache:"no-store"});
    if(!r.ok)throw new Error(r.status);
    const list=await r.json();
    const atBottom=box.scrollHeight-box.scrollTop-box.clientHeight<40;
    box.innerHTML=list.map(m=>(m.kind&&m.kind!=="message")
      ?'<div class="act">'+esc(m.content||m.kind)+'</div>'
      :'<div class="b '+(m.role==="user"?"in":"out")+'">'+esc(m.content)+'<small>'+esc(who[m.sender_type]||m.sender_type)+' · '+new Date(m.created_at).toLocaleString()+'</small></div>').join("")||'<p class="muted">Sin mensajes.</p>';
    if(atBottom||!box.dataset.ready){box.scrollTop=box.scrollHeight;box.dataset.ready=1}
  }catch(e){box.innerHTML='<p class="muted">No pude leer el chat del CRM ('+esc(e.message)+').</p>'}
}
load();setInterval(load,10000);
</script>`);
}

/** Simulador: escribes tú y "el negocio", y el worker responde con su cerebro real, sin tocar el CRM. */
export function renderSim(): string {
  return page("Simulador", "sim", `
<section class="card"><b>Simulador de conversación</b>
<p class="muted" style="margin:0">Escribe tu apertura como <b>Tú</b>, luego contesta como <b>Negocio</b>. El worker usa el mismo cronómetro, clasificador y redactor que con un chat real, pero no toca el CRM ni guarda nada.</p></section>
<div class="chat" id="chat"><p class="muted">Empieza con tu apertura.</p></div>
<div class="card">
  <textarea id="txt" rows="3" placeholder="Escribe un mensaje…"></textarea>
  <label>El negocio tarda <input type="number" id="delay" value="45" min="0"> minutos en contestar</label>
  <div class="row"><button id="me">Enviar como Tú</button><button class="ghost" id="biz">Responder como Negocio</button><button class="ghost" id="reset">Reiniciar</button></div>
</div>
<div class="card" id="out" hidden></div>
<script>
const msgs=[];let clock=Date.now()-3*864e5;
const $=id=>document.getElementById(id);
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[c]);
const COLORS=${JSON.stringify(COLORS)};const BRANCH=${JSON.stringify(BRANCH)};
function draw(){
  $("chat").innerHTML=msgs.map(m=>'<div class="b '+(m.role==="user"?"in":"out")+'">'+esc(m.content)+'<small>'+(m.role==="user"?"Negocio":"Tú")+' · '+new Date(m.created_at).toLocaleString()+'</small></div>').join("")||'<p class="muted">Empieza con tu apertura.</p>';
  $("chat").scrollTop=$("chat").scrollHeight;
}
function add(role){
  const t=$("txt").value.trim();if(!t)return null;
  clock+= role==="user" ? Math.max(0,+$("delay").value||0)*6e4 : 6e4;
  msgs.push({role,sender_type:role==="user"?"visitor":"human",kind:"message",created_at:new Date(clock).toISOString(),content:t});
  $("txt").value="";draw();return t;
}
async function ask(){
  const out=$("out");out.hidden=false;out.innerHTML='<p class="muted">El worker está pensando…</p>';
  try{
    const r=await fetch("/panel/simular/api",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({messages:msgs})});
    const d=await r.json();
    if(!r.ok){out.innerHTML='<p class="muted">'+esc(d.error||r.status)+'</p>';return}
    out.innerHTML='<div class="chips"><span class="chip"><i class="dot" style="background:'+(COLORS[d.color]||COLORS.gris)+'"></i>'+esc(d.time)+'</span><span class="chip">contestó: '+esc(d.who)+'</span><span class="chip">intención: '+esc(d.intent)+'</span><span class="chip">rama: '+esc(BRANCH[d.branch]||d.branch)+'</span></div>'
      +'<textarea id="dr" rows="5">'+esc(d.draft)+'</textarea><div class="row"><button id="use">Usar como mi respuesta</button></div>';
    $("use").onclick=()=>{$("txt").value=$("dr").value;add("assistant");out.hidden=true};
  }catch(e){out.innerHTML='<p class="muted">Error: '+esc(e.message)+'</p>'}
}
$("me").onclick=()=>add("assistant");
$("biz").onclick=()=>{if(!msgs.length){alert("Primero escribe tu apertura como Tú");return}if(add("user"))ask()};
$("reset").onclick=()=>{msgs.length=0;clock=Date.now()-3*864e5;$("out").hidden=true;draw()};
</script>`);
}
