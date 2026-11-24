// Página pública de la demo: un WhatsApp Web (PC) / WhatsApp móvil con el agente de la clínica.
// Modelo visual: la demo "vendermas" de Daniel (barra de venta arriba, barra lateral con
// superpoderes y preguntas de prueba en PC, cabecera verde y ficha deslizable en móvil,
// notas de voz, fotos y la tarjeta "detrás de cámaras" cuando se agenda).

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const ICON = {
  reset: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>',
  search: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
  info: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
  emoji: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>',
  clip: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>',
  mic: '<svg id="iMic" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>',
  plane: '<svg id="iPlane" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style="display:none;margin-left:2px"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>',
  trash: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>',
};

export function renderDemoPage(d: { business: string; category: string | null; city: string | null }, contact: string | null): string {
  const initials = d.business.split(/\s+/).filter((w) => /^[A-Za-zÁÉÍÓÚÑ0-9]/.test(w)).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "IA";
  const prompts: [string, string, string][] = [
    ["👋", "¿Qué tratamientos tienen y qué precios manejan?", "Hola, ¿qué tratamientos tienen y qué precios manejan?"],
    ["📅", "Quiero agendar una valoración", "Hola, me gustaría agendar una cita de valoración para esta semana."],
    ["🦷", "Me duele una muela", "Hola, me duele una muela desde hace unos días, ¿me pueden atender?"],
    ["📍", "¿Dónde están y qué pagos aceptan?", "¿Dónde están ubicados y qué formas de pago aceptan?"],
  ];
  const chips = (short: boolean) => prompts.map(([i, label, text]) => `<button class="chip" data-text="${esc(text)}">${i} “${esc(short ? label.split(" y ")[0] : label)}”</button>`).join("");
  const wa = contact ? `https://wa.me/${esc(contact)}?text=${encodeURIComponent(`Hola Daniel, probé la demo de IA de ${d.business} y quiero activarlo en mi WhatsApp real.`)}` : "#";
  const sub = [d.category, d.city].filter(Boolean).join(" · ");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,viewport-fit=cover">
<title>${esc(d.business)} · Asistente de WhatsApp con IA</title><meta name="robots" content="noindex">
<meta property="og:title" content="${esc(d.business)} · así contestaría tu WhatsApp con IA"><meta property="og:description" content="Demo en vivo creada por Hunter AI para ${esc(d.business)}">
<meta name="theme-color" content="#075E54">
<style>
*{box-sizing:border-box;margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-tap-highlight-color:transparent}
html,body{height:100%;height:100dvh;overflow:hidden;background:#d1d7db}
body{display:flex;flex-direction:column;position:fixed;inset:0}
.banner{flex-shrink:0;background:linear-gradient(90deg,#128C7E,#075E54);color:#fff;height:42px;padding:0 16px;display:flex;align-items:center;justify-content:space-between;font-size:13px;font-weight:500;box-shadow:0 2px 4px rgba(0,0,0,.15);z-index:100}
.banner-l{display:flex;align-items:center;gap:8px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;min-width:0}
.banner-l span{overflow:hidden;text-overflow:ellipsis}
.pulse{width:8px;height:8px;border-radius:50%;background:#25D366;animation:pg 1.6s infinite;flex-shrink:0}
@keyframes pg{0%{transform:scale(.95);box-shadow:0 0 0 0 rgba(37,211,102,.7)}70%{transform:scale(1);box-shadow:0 0 0 6px rgba(37,211,102,0)}100%{transform:scale(.95);box-shadow:0 0 0 0 rgba(37,211,102,0)}}
.cta{background:#25D366;color:#0b141a;font-weight:700;font-size:12px;padding:6px 14px;border-radius:20px;text-decoration:none;white-space:nowrap;margin-left:10px;box-shadow:0 1px 3px rgba(0,0,0,.25);transition:all .15s;flex-shrink:0}
.cta:hover{background:#20ba59;transform:translateY(-1px)}
.ws{flex:1 1 0%;min-height:0;display:flex;background:#fff;overflow:hidden}
aside{width:380px;min-width:330px;height:100%;background:#fff;border-right:1px solid #e9edef;display:flex;flex-direction:column;flex-shrink:0}
.sh{height:60px;background:#f0f2f5;padding:0 16px;display:flex;align-items:center;border-bottom:1px solid #e9edef;flex-shrink:0}
.me{width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#128C7E,#075E54);color:#fff;font-weight:700;font-size:14px;display:grid;place-items:center}
.sht{display:flex;flex-direction:column;margin-left:12px;flex:1;overflow:hidden}
.sht b{font-size:14.5px;color:#111b21}.sht small{font-size:11px;color:#008069;font-weight:600}
.ib{background:none;border:none;color:#54656f;cursor:pointer;padding:8px;border-radius:50%;display:flex;align-items:center;justify-content:center}
.ib:hover{background:rgba(0,0,0,.06)}
.ss{padding:8px 12px;border-bottom:1px solid #f0f2f5}
.sb{background:#f0f2f5;border-radius:8px;display:flex;align-items:center;gap:10px;padding:7px 12px;color:#54656f}
.sb input{border:none;background:transparent;outline:none;font-size:13.5px;width:100%;color:#111b21}
.item{display:flex;align-items:center;gap:12px;padding:12px 16px;background:#f0f2f5;border-bottom:1px solid #f2f2f2}
.av{width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,#25D366,#128C7E);display:grid;place-items:center;color:#fff;font-weight:700;font-size:16px;flex-shrink:0;position:relative}
.av .on{position:absolute;bottom:0;right:0;width:12px;height:12px;background:#25D366;border-radius:50%;border:2px solid #fff}
.ic{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.ir{display:flex;justify-content:space-between;align-items:center;gap:6px}
.in{font-size:15px;font-weight:600;color:#111b21;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ok{color:#25D366;font-size:14px;font-weight:700}
.it{font-size:11.5px;color:#667781;flex-shrink:0}
.ip{font-size:13px;color:#667781;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ip i{color:#53bdeb;font-style:normal;font-weight:700}
.card{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:14px}
.ch{font-size:12px;font-weight:700;color:#008069;text-transform:uppercase;letter-spacing:.5px}
.feats{display:flex;flex-direction:column;gap:7px}
.feat{background:#f7f9fa;border:1px solid #e9edef;border-radius:8px;padding:7px 10px;font-size:12px;color:#3b4a54;display:flex;gap:8px;align-items:center}
.ql{font-size:11.5px;font-weight:700;color:#54656f;margin-top:4px}
.chips{display:flex;flex-direction:column;gap:6px}
.chip{text-align:left;background:#f0f2f5;border:1px solid #e2e8f0;border-radius:8px;padding:8px 10px;font-size:12px;color:#111b21;cursor:pointer;line-height:1.35;transition:all .15s}
.chip:hover{background:#d1f4ec;border-color:#25D366;color:#075E54;transform:translateX(2px)}
.rst{margin-top:auto;width:100%;background:#f0f2f5;border:1px solid #d1d7db;color:#54656f;border-radius:8px;padding:9px;font-size:12.5px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px}
.rst:hover{background:#fee2e2;color:#dc2626;border-color:#fca5a5}
.by{font-size:11px;color:#8696a0;text-align:center}.by b{color:#ff6a00}
main{flex:1 1 0%;min-width:0;height:100%;display:flex;flex-direction:column;background:#efeae2;position:relative;overflow:hidden}
.hd{flex-shrink:0;background:#f0f2f5;height:60px;padding:0 16px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #e9edef}
.hl{display:flex;align-items:center;gap:12px;overflow:hidden;flex:1;min-width:0}
.hn{font-size:16px;font-weight:600;color:#111b21;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hs{font-size:12px;color:#667781;white-space:nowrap}
.ha{display:flex;gap:6px;flex-shrink:0}
#log{flex:1 1 0%;min-height:0;overflow-y:auto;padding:16px 20px;background:#efeae2 radial-gradient(#d3c6ba 1px,transparent 1px);background-size:20px 20px;display:flex;flex-direction:column;gap:8px}
.note{align-self:center;background:#ffeecd;color:#54656f;font-size:11px;padding:6px 14px;border-radius:8px;text-align:center;max-width:90%;margin:4px 0 10px;box-shadow:0 1px 1px rgba(0,0,0,.06);line-height:1.4}
.b{max-width:65%;padding:7px 11px 7px 12px;border-radius:8px;font-size:14.5px;line-height:1.4;word-wrap:break-word;white-space:pre-wrap;box-shadow:0 1px 1px rgba(0,0,0,.12);animation:fi .15s ease;color:#111b21}
@keyframes fi{from{opacity:0;transform:translateY(4px)}}
.bot{align-self:flex-start;background:#fff;border-top-left-radius:2px}
.usr{align-self:flex-end;background:#d9fdd3;border-top-right-radius:2px}
.tm{float:right;margin:4px 0 0 10px;font-size:11px;color:#667781;white-space:nowrap}.tm i{color:#53bdeb;font-style:normal;font-weight:700}
.b img{max-width:100%;max-height:320px;border-radius:6px;margin-bottom:4px;display:block;object-fit:cover}
.vn{display:flex;align-items:center;gap:10px;min-width:220px}
.vn button{width:34px;height:34px;border:none;background:none;color:#54656f;cursor:pointer;display:grid;place-items:center}
.wave{display:flex;align-items:center;gap:2.5px;height:22px;flex:1}
.wave span{width:3px;background:#9cbca7;border-radius:3px}.wave span.p{background:#53bdeb}
.vd{font-size:11px;color:#667781;font-variant-numeric:tabular-nums}
.bh{align-self:center;width:94%;max-width:580px;background:linear-gradient(135deg,#0b141a,#1a2730);color:#fff;border-left:4px solid #25D366;border-radius:8px;padding:14px;margin:8px 0;font-size:13px;box-shadow:0 4px 10px rgba(0,0,0,.25);animation:fi .25s ease}
.bh h4{font-size:12px;color:#25D366;letter-spacing:.5px;margin-bottom:6px}
.bh p{margin-bottom:4px;color:#e9edef}.bh small{display:block;font-size:11px;color:#8696a0;margin-top:8px;border-top:1px solid #222e35;padding-top:6px}
.dots{display:inline-flex;gap:3px;align-items:center;margin-left:3px}.dots i{width:5px;height:5px;background:#8696a0;border-radius:50%;animation:tb 1.2s infinite}.dots i:nth-child(2){animation-delay:.2s}.dots i:nth-child(3){animation-delay:.4s}
@keyframes tb{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-4px)}}
.ft{flex-shrink:0;background:#f0f2f5;padding:10px 16px calc(10px + env(safe-area-inset-bottom));display:flex;align-items:center;gap:10px;position:relative;border-top:1px solid rgba(0,0,0,.08)}
#t{flex:1;min-width:0;background:#fff;border-radius:20px;padding:10px 16px;border:none;outline:none;font-size:15px;color:#111b21;box-shadow:0 1px 1px rgba(0,0,0,.06)}
#send{width:42px;height:42px;border-radius:50%;background:#008069;color:#fff;border:none;display:grid;place-items:center;cursor:pointer;flex-shrink:0;box-shadow:0 1px 2px rgba(0,0,0,.2)}
#send:hover{background:#075E54}
#rec{flex:1;display:none;align-items:center;justify-content:space-between;background:#fff;border-radius:20px;padding:8px 14px;color:#ea4335;font-size:13px;font-weight:500}
#rec .rd{width:9px;height:9px;border-radius:50%;background:#ea4335;animation:pg 1s infinite}
#prev{display:none;position:absolute;bottom:64px;left:16px;background:#fff;border-radius:10px;padding:8px;box-shadow:0 2px 10px rgba(0,0,0,.15);align-items:center;gap:8px;z-index:30}
#prev img{width:56px;height:56px;object-fit:cover;border-radius:6px}
#emo{display:none;position:absolute;bottom:64px;left:12px;background:#fff;border-radius:12px;padding:8px;box-shadow:0 2px 10px rgba(0,0,0,.15);grid-template-columns:repeat(6,1fr);gap:4px;z-index:30}
#emo button{font-size:22px;background:none;border:none;cursor:pointer;padding:4px;border-radius:6px}#emo button:hover{background:#f0f2f5}
.mchips{display:none;gap:6px;overflow-x:auto;padding:6px 12px;background:#efeae2;scrollbar-width:none;flex-shrink:0}
.mchips .chip{flex:none;border-radius:999px;background:#fff;white-space:nowrap}
#sheet{position:fixed;inset:0;background:rgba(0,0,0,.4);display:none;align-items:flex-end;z-index:200}
#sheet .in2{background:#fff;width:100%;border-radius:16px 16px 0 0;padding:18px 16px calc(18px + env(safe-area-inset-bottom));max-height:80dvh;overflow-y:auto;display:flex;flex-direction:column;gap:12px;animation:up .2s ease}
@keyframes up{from{transform:translateY(40px);opacity:0}}
.mob{display:none!important}
@media (max-width:767px){
  aside{display:none}.mob{display:flex!important}
  .hd{background:#008069;border:0}.hn{color:#fff}.hs{color:#d1f4ec}.hd .ib{color:#fff}
  .b{max-width:86%}#log{padding:12px 12px}
  .mchips{display:flex}
  .banner{padding:0 12px;font-size:12px}.cta{padding:6px 10px;font-size:11px}
}
@media (min-width:1200px){aside{width:400px}#log{padding:20px 48px}.b{max-width:58%}.banner{padding:0 48px}}
</style></head><body>
<header class="banner"><div class="banner-l"><div class="pulse"></div><span>Simulación en vivo para ${esc(d.business)}</span></div><a class="cta" href="${wa}" target="_blank" rel="noopener">Activar en mi WhatsApp 🚀</a></header>
<div class="ws">
<aside>
  <div class="sh"><div class="me">WA</div><div class="sht"><b>WhatsApp Business</b><small>🟢 Simulación IA activa</small></div><button class="ib" data-reset title="Reiniciar conversación">${ICON.reset}</button></div>
  <div class="ss"><div class="sb">${ICON.search}<input placeholder="Buscar o empezar un chat nuevo" autocomplete="off"></div></div>
  <div class="item"><div class="av">${esc(initials)}<span class="on"></span></div><div class="ic"><div class="ir"><span class="in">${esc(d.business)} <span class="ok">✓</span></span><span class="it" id="lt">Ahora</span></div><div class="ip"><i>✓✓</i> <span id="lp">En línea para responderte</span></div></div></div>
  <div class="card">
    <div class="ch">⚡ Superpoderes del asistente</div>
    <div class="feats"><div class="feat">🎙️ Escucha y responde notas de voz</div><div class="feat">📸 Analiza fotos que envían los pacientes</div><div class="feat">💬 Venta consultiva, sin presionar</div><div class="feat">📅 Agenda valoraciones 24/7</div></div>
    <div class="ql">Prueba con preguntas reales:</div>
    <div class="chips">${chips(false)}</div>
    <button class="rst" data-reset>${ICON.reset}<span>Reiniciar conversación</span></button>
    <div class="by">Demo creada por <b>Hunter AI</b></div>
  </div>
</aside>
<main>
  <div class="hd"><div class="hl"><div class="av">${esc(initials)}</div><div style="min-width:0"><div class="hn">${esc(d.business)} <span class="ok">✓</span></div><div class="hs" id="st">en línea</div></div></div>
    <div class="ha"><button class="ib mob" id="infoBtn" title="Ficha del negocio">${ICON.info}</button><button class="ib" title="Buscar">${ICON.search}</button><button class="ib" data-reset title="Reiniciar conversación">${ICON.reset}</button></div></div>
  <div id="log"><div class="note">🔒 Los mensajes de esta simulación se generan con IA en tiempo real para mostrar cómo atendería el WhatsApp de ${esc(d.business)}. Escribe como si fueras un paciente.</div></div>
  <div class="mchips" id="mchips">${chips(true)}</div>
  <div id="prev"><img id="pimg" alt=""><span style="font-size:12px;color:#54656f">Foto adjunta</span><button class="ib" id="pclose">✕</button></div>
  <div id="emo">${["👋", "😊", "🙏", "👍", "🦷", "📍", "📅", "✨", "❤️", "😬", "💬", "🚀"].map((e) => `<button>${e}</button>`).join("")}</div>
  <div class="ft">
    <input type="file" id="file" accept="image/*" hidden>
    <button class="ib" id="emoBtn" title="Emojis">${ICON.emoji}</button>
    <button class="ib" id="clip" title="Adjuntar foto">${ICON.clip}</button>
    <input id="t" placeholder="Escribe un mensaje" autocomplete="off" maxlength="600">
    <div id="rec"><div style="display:flex;align-items:center;gap:8px"><button class="ib" id="rcancel" style="color:#ea4335" title="Descartar">${ICON.trash}</button><div class="rd"></div><span id="rt" style="font-variant-numeric:tabular-nums;font-weight:600">0:00</span></div><span style="font-size:11px;color:#8696a0">Grabando… toca ➤ para enviar</span></div>
    <button id="send" title="Enviar o grabar nota de voz">${ICON.mic}${ICON.plane}</button>
  </div>
</main>
</div>
<div id="sheet"><div class="in2">
  <div style="display:flex;justify-content:space-between;align-items:center"><h3 style="font-size:16px;color:#111b21">${esc(d.business)}</h3><button class="ib" id="sclose">✕</button></div>
  ${sub ? `<div style="font-size:12.5px;color:#667781">${esc(sub)}</div>` : ""}
  <div style="font-size:13px;color:#54656f">Esta simulación muestra cómo un asistente de IA atendería el WhatsApp de la clínica 24/7: responde, escucha notas de voz, ve fotos y agenda valoraciones.</div>
  <div class="ql">Toca una pregunta para probar:</div><div class="chips">${chips(false)}</div>
  <button class="rst" data-reset style="margin-top:4px">${ICON.reset}<span>Reiniciar conversación</span></button>
  <div class="by">Demo creada por <b>Hunter AI</b></div>
</div></div>
<script>
const $=(id)=>document.getElementById(id),log=$("log"),t=$("t"),st=$("st"),own=new URLSearchParams(location.search).has("yo");
const BIZ=${JSON.stringify(d.business).replace(/</g, "\\u003c")};
const SID=(crypto.randomUUID?crypto.randomUUID():String(Date.now())+Math.random().toString(16).slice(2)).slice(0,36);
const DEV=matchMedia("(max-width:767px)").matches?"móvil":"PC";
function ev(type){const b=JSON.stringify({type,session:SID,device:DEV,own});try{if(type==="salio"&&navigator.sendBeacon){navigator.sendBeacon(location.pathname+"/evento",new Blob([b],{type:"application/json"}));return}fetch(location.pathname+"/evento",{method:"POST",headers:{"Content-Type":"application/json"},body:b,keepalive:true})}catch(e){}}
let left=false;const bye=()=>{if(!left){left=true;ev("salio")}};
addEventListener("pagehide",bye);document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="hidden")bye();else left=false});
let hist=[],queue=[],timer=null,busy=false,img=null,rec=null,chunks=[],recSec=0,recInt=null;
const hm=()=>new Date().toLocaleTimeString([],{hour:"numeric",minute:"2-digit"});
const escH=(s)=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
function bubble(who,text,media){
  const b=document.createElement("div");b.className="b "+(who==="user"?"usr":"bot");
  if(media&&media.type==="image"){const i=document.createElement("img");i.src=media.src;b.appendChild(i)}
  if(media&&media.type==="audio"){b.appendChild(voice(media.src,media.sec))}
  if(text){const s=document.createElement("span");s.textContent=text;b.appendChild(s)}
  const tm=document.createElement("span");tm.className="tm";tm.innerHTML=hm()+(who==="user"?" <i>✓✓</i>":"");b.appendChild(tm);
  log.appendChild(b);log.scrollTop=log.scrollHeight;
  $("lp").textContent=text||(media?(media.type==="audio"?"🎤 Nota de voz":"📷 Foto"):"");$("lt").textContent=hm();
}
function voice(src,sec){
  const w=document.createElement("div");w.className="vn";const a=new Audio(src);
  const bars=Array.from({length:28},()=>4+Math.round(Math.random()*16));
  w.innerHTML='<button>▶</button><div class="wave">'+bars.map(h=>'<span style="height:'+h+'px"></span>').join("")+'</div><span class="vd">'+fmt(sec)+'</span>';
  const btn=w.querySelector("button"),sp=[...w.querySelectorAll(".wave span")];
  btn.onclick=()=>{if(a.paused){a.play();btn.textContent="❚❚"}else{a.pause();btn.textContent="▶"}};
  a.ontimeupdate=()=>{const k=a.duration?a.currentTime/a.duration:0;sp.forEach((s,i)=>s.classList.toggle("p",i/sp.length<k))};
  a.onended=()=>{btn.textContent="▶";sp.forEach(s=>s.classList.remove("p"))};
  return w;
}
const fmt=(s)=>Math.floor(s/60)+":"+String(Math.max(0,s%60)).padStart(2,"0");
function behind(k){
  const c=document.createElement("div");c.className="bh";
  c.innerHTML="<h4>⚡ DETRÁS DE CÁMARAS: CITA REGISTRADA</h4><p>✅ <b>Evento:</b> "+escH(k.action_type||"Cita agendada")+"</p><p>👤 <b>Paciente:</b> "+escH(k.client_name||"—")+"</p><p>📋 <b>Servicio:</b> "+escH(k.item_or_service||"Valoración")+"</p><p>📅 <b>Fecha:</b> "+escH(k.datetime_or_details||"—")+"</p><small>📲 Con tu WhatsApp real, esta cita entra sola a tu agenda y tu equipo recibe el aviso al instante, sin tocar el teléfono.</small>";
  log.appendChild(c);log.scrollTop=log.scrollHeight;
}
function typing(on,label){st.innerHTML=on?escH(label||"escribiendo")+'<span class="dots"><i></i><i></i><i></i></span>':"en línea"}
function push(text,media){
  bubble("user",text,media&&media.type==="image"?{type:"image",src:"data:image/jpeg;base64,"+media.data}:media&&media.type==="audio"?{type:"audio",src:media.url,sec:media.sec}:null);
  queue.push({text,media});$("mchips").style.display="none";
  clearTimeout(timer);timer=setTimeout(flush,1200);
}
async function flush(){
  if(t.value.trim()){timer=setTimeout(flush,1500);return}
  if(busy){timer=setTimeout(flush,700);return}
  if(!queue.length)return;busy=true;
  const batch=queue.splice(0),text=batch.map(m=>m.text).filter(Boolean).join("\\n"),m=(batch.find(x=>x.media)||{}).media;
  typing(true,m&&m.type==="audio"?"escuchando audio":"escribiendo");
  const msg={role:"user",content:text};
  if(m){msg.media_type=m.type;msg.media_base64=m.data;msg.media_mime=m.mime}
  try{
    const r=await fetch(location.pathname+"/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({messages:[...hist,msg],own,session:SID})});
    const d=await r.json();
    hist.push({role:"user",content:d.user_text||text||"(adjunto)"});
    await new Promise(r=>setTimeout(r,300));typing(false);
    const reply=d.text||"Perdón, tuve un problema. ¿Me lo repites?";bubble("bot",reply);hist.push({role:"assistant",content:reply+(d.booking?" [cita registrada: "+(d.booking.client_name||"")+"]":"")});
    if(d.booking)behind(d.booking);
  }catch(e){typing(false);bubble("bot","Perdón, se me fue la señal. ¿Me lo repites?")}
  busy=false;if(queue.length)flush();
}
function sendNow(){
  if(rec){stopRec(true);return}
  const text=t.value.trim();
  if(!text&&!img){startRec();return}
  push(text,img);t.value="";closePrev();ui();
}
function ui(){const has=t.value.trim()||img||rec;$("iMic").style.display=has?"none":"";$("iPlane").style.display=has?"":"none"}
t.addEventListener("input",ui);t.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();sendNow()}});
$("send").onclick=sendNow;
async function startRec(){
  try{const s=await navigator.mediaDevices.getUserMedia({audio:true});rec=new MediaRecorder(s);chunks=[];
    rec.ondataavailable=e=>e.data.size&&chunks.push(e.data);rec.onstop=()=>s.getTracks().forEach(x=>x.stop());rec.start();recSec=0;$("rt").textContent="0:00";
    t.style.display="none";$("clip").style.display="none";$("emoBtn").style.display="none";$("rec").style.display="flex";ui();
    recInt=setInterval(()=>{recSec++;$("rt").textContent=fmt(recSec);if(recSec>=60)stopRec(true)},1000);
  }catch(e){t.placeholder="Activa el micrófono para enviar notas de voz";rec=null}
}
function stopRec(send){
  if(!rec)return;const r=rec;rec=null;clearInterval(recInt);
  r.onstop=()=>{r.stream.getTracks().forEach(x=>x.stop());if(!send||!chunks.length)return;
    const blob=new Blob(chunks,{type:r.mimeType||"audio/webm"}),fr=new FileReader();
    fr.onload=()=>push("",{type:"audio",data:String(fr.result).split(",")[1],mime:blob.type,url:URL.createObjectURL(blob),sec:Math.max(1,recSec)});fr.readAsDataURL(blob)};
  r.stop();t.style.display="";$("clip").style.display="";$("emoBtn").style.display="";$("rec").style.display="none";ui();
}
$("rcancel").onclick=()=>stopRec(false);
$("clip").onclick=()=>$("file").click();
$("file").onchange=e=>{const f=e.target.files[0];if(!f)return;const im=new Image(),u=URL.createObjectURL(f);
  im.onload=()=>{const k=Math.min(1,1024/Math.max(im.width,im.height)),c=document.createElement("canvas");c.width=im.width*k;c.height=im.height*k;c.getContext("2d").drawImage(im,0,0,c.width,c.height);
    img={type:"image",data:c.toDataURL("image/jpeg",.8).split(",")[1],mime:"image/jpeg"};$("pimg").src=u;$("prev").style.display="flex";ui();t.focus()};im.src=u;e.target.value=""};
function closePrev(){img=null;$("prev").style.display="none";ui()}
$("pclose").onclick=closePrev;
$("emoBtn").onclick=()=>{const e=$("emo");e.style.display=e.style.display==="grid"?"none":"grid"};
document.querySelectorAll("#emo button").forEach(b=>b.onclick=()=>{t.value+=b.textContent;ui();t.focus()});
document.addEventListener("click",e=>{if(!e.target.closest("#emo,#emoBtn"))$("emo").style.display="none"});
document.querySelectorAll(".chip").forEach(b=>b.onclick=()=>{$("sheet").style.display="none";push(b.dataset.text)});
$("infoBtn").onclick=()=>$("sheet").style.display="flex";$("sclose").onclick=()=>$("sheet").style.display="none";
$("sheet").onclick=e=>{if(e.target.id==="sheet")$("sheet").style.display="none"};
function greet(){setTimeout(()=>{const g="¡Hola! 👋 Gracias por escribir a "+BIZ+". ¿En qué te puedo ayudar hoy?";bubble("bot",g);hist.push({role:"assistant",content:g})},500)}
document.querySelectorAll("[data-reset]").forEach(b=>b.onclick=()=>{if(hist.length>1)ev("reinicio");hist=[];queue=[];[...log.children].slice(1).forEach(n=>n.remove());$("mchips").style.display="";$("sheet").style.display="none";greet()});
greet();ev("abrio");
</script></body></html>`;
}
