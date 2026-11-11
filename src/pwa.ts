// App instalable (PWA): manifest, íconos, service worker (offline + push) y acceso con cookie.
import type { Env } from "./crm.ts";
import { apple, i192, i512, mask } from "./icons.ts";

const COOKIE = "pp";

async function token(env: Env): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.PANEL_PASSWORD), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("prospector-panel-v1"));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Cookie de sesión (para la app instalada) o, como antes, usuario/contraseña del navegador. */
export async function authorized(req: Request, env: Env): Promise<boolean> {
  if (!env.PANEL_PASSWORD) return false;
  const cookie = (req.headers.get("Cookie") ?? "").split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (cookie && cookie === (await token(env))) return true;
  const header = req.headers.get("Authorization") ?? "";
  if (!header.startsWith("Basic ")) return false;
  const [, pass] = atob(header.slice(6)).split(":");
  return pass === env.PANEL_PASSWORD;
}

export async function login(req: Request, env: Env): Promise<Response> {
  const form = await req.formData();
  const pass = String(form.get("password") ?? "");
  if (!env.PANEL_PASSWORD || pass !== env.PANEL_PASSWORD) return html(loginPage("Contraseña incorrecta"), 401);
  return new Response(null, {
    status: 303,
    headers: { Location: "/panel", "Set-Cookie": `${COOKIE}=${await token(env)}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax` },
  });
}

const html = (body: string, status = 200) => new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });

export const HEAD = `<link rel="manifest" href="/manifest.webmanifest"><meta name="theme-color" content="#0a0807">
<link rel="apple-touch-icon" href="/icons/apple.png"><meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"><meta name="apple-mobile-web-app-title" content="Prospector">`;

export function loginPage(error = ""): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Prospector</title>${HEAD}
<style>*{box-sizing:border-box}body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#0a0807;color:#f4ede7;font:16px/1.4 system-ui,-apple-system,sans-serif;padding:24px}
form{width:100%;max-width:340px;display:flex;flex-direction:column;gap:14px;text-align:center}
img{width:72px;height:72px;border-radius:20px;margin:0 auto 6px}h1{margin:0;font-size:24px}p{margin:0;color:#9b8f86;font-size:14px}
input{width:100%;padding:15px 16px;border-radius:14px;border:1px solid #2a221d;background:#141010;color:#f4ede7;font:inherit;outline:none}
input:focus{border-color:#ff6a00}button{padding:15px;border:0;border-radius:14px;background:#ff6a00;color:#120800;font:inherit;font-weight:700}
.err{color:#ff6b6b;font-size:14px}</style></head><body>
<form method="post" action="/panel/login"><img src="/icons/192.png" alt=""><h1>Prospector</h1><p>Tu CRM de prospección</p>
${error ? `<div class="err">${error}</div>` : ""}<input type="password" name="password" placeholder="Contraseña" autocomplete="current-password" required autofocus>
<button>Entrar</button></form></body></html>`;
}

const MANIFEST = {
  name: "Prospector · Hunter AI", short_name: "Prospector", id: "/panel", start_url: "/panel", scope: "/",
  display: "standalone", orientation: "portrait", background_color: "#0a0807", theme_color: "#0a0807", lang: "es",
  description: "Tu CRM de prospección: pipeline, demos y avisos de prospectos calientes.",
  icons: [
    { src: "/icons/192.png", sizes: "192x192", type: "image/png" },
    { src: "/icons/512.png", sizes: "512x512", type: "image/png" },
    { src: "/icons/mask.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
  shortcuts: [
    { name: "Pipeline", url: "/panel#pipeline" },
    { name: "Bandeja", url: "/panel#bandeja" },
  ],
};

const SW = `const C="prospector-v1";
self.addEventListener("install",e=>{self.skipWaiting();e.waitUntil(caches.open(C).then(c=>c.addAll(["/icons/192.png"])))});
self.addEventListener("activate",e=>e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x)))).then(()=>self.clients.claim())));
self.addEventListener("fetch",e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=="GET"||u.origin!==location.origin)return;
  if(e.request.mode==="navigate"&&u.pathname==="/panel"){
    e.respondWith(fetch(e.request).then(r=>{if(r.ok){const c=r.clone();caches.open(C).then(x=>x.put("/panel",c))}return r}).catch(()=>caches.match("/panel")));
  }
});
self.addEventListener("push",e=>{
  e.waitUntil(fetch("/panel/api/alerts",{credentials:"include",cache:"no-store"}).then(r=>r.json()).then(d=>{
    const a=(d.items||[])[0];
    return self.registration.showNotification("Prospector",{body:a?a.text:"Tienes un aviso nuevo",tag:a?a.id:"aviso",icon:"/icons/192.png",badge:"/icons/192.png",data:{lead:a&&a.lead}});
  }).catch(()=>self.registration.showNotification("Prospector",{body:"Tienes un aviso nuevo",icon:"/icons/192.png"})));
});
self.addEventListener("notificationclick",e=>{
  e.notification.close();
  const lead=e.notification.data&&e.notification.data.lead;
  const url="/panel"+(lead?"#lead="+encodeURIComponent(lead):"");
  e.waitUntil(self.clients.matchAll({type:"window",includeUncontrolled:true}).then(cs=>{
    for(const c of cs){if(new URL(c.url).pathname==="/panel"){c.focus();return c.navigate(url)}}
    return self.clients.openWindow(url);
  }));
});`;

const png = (b64: string) => new Response(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), {
  headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=604800" },
});

/** Archivos públicos de la app (sin contraseña). */
export function pwaAsset(path: string): Response | null {
  if (path === "/manifest.webmanifest") return new Response(JSON.stringify(MANIFEST), { headers: { "Content-Type": "application/manifest+json" } });
  if (path === "/sw.js") return new Response(SW, { headers: { "Content-Type": "text/javascript", "Cache-Control": "no-cache", "Service-Worker-Allowed": "/" } });
  if (path === "/icons/192.png") return png(i192);
  if (path === "/icons/512.png") return png(i512);
  if (path === "/icons/mask.png") return png(mask);
  if (path === "/icons/apple.png") return png(apple);
  return null;
}
