// Hunter Prospector · worker v1 (Canal 2: tú escribes desde el anuncio, el worker toma el relevo).
import { type Env, holdForWorker, messages, moveStage, reply, verifySignature } from "./crm.ts";
import { classify, draft, pickBranch } from "./brain.ts";
import { colorFor, prospectingStart, responseMinutes } from "./timer.ts";
import { renderPanel } from "./panel.ts";
import { renderChat, renderQueue, renderSim } from "./views.ts";
import { fillToday, getQuota, importLeads, markLead, parseHunt, setQuota, today } from "./leads.ts";
import { evolutionReady, sendFirst, setSetting, setting, tick } from "./auto.ts";
import type { Msg } from "./timer.ts";
import { humanDuration } from "./timer.ts";

const now = () => new Date().toISOString();

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/health") return new Response("ok");
    if (url.pathname === "/webhooks/crm" && req.method === "POST") return webhook(req, env, ctx);
    if (url.pathname.startsWith("/panel")) {
      if (!authorized(req, env)) {
        return new Response("Acceso restringido", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="Prospector"' } });
      }
      return panel(req, url, env);
    }
    return new Response("No encontrado", { status: 404 });
  },
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(tick(env).then((r) => console.log("tick", r)).catch((e) => console.error("tick", e)));
  },
};

function authorized(req: Request, env: Env): boolean {
  if (!env.PANEL_PASSWORD) return false;
  const header = req.headers.get("Authorization") ?? "";
  if (!header.startsWith("Basic ")) return false;
  const [, pass] = atob(header.slice(6)).split(":");
  return pass === env.PANEL_PASSWORD;
}

async function webhook(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const raw = await req.arrayBuffer();
  if (!(await verifySignature(env.CRM_WEBHOOK_SECRET, raw, req.headers.get("X-Signature")))) {
    return new Response("Firma inválida", { status: 401 });
  }
  const event = JSON.parse(new TextDecoder().decode(raw));
  if (event.event !== "message.received" || !(await sameClient(env, event.data?.client_id))) return new Response("ignorado");
  // Entrega al menos una vez: cada aviso se procesa una sola vez.
  const fresh = await env.DB.prepare("INSERT OR IGNORE INTO events (id, received_at) VALUES (?, ?)").bind(event.id, now()).run();
  if (!fresh.meta.changes) return new Response("repetido");
  // Respondemos rápido al CRM y trabajamos en segundo plano.
  ctx.waitUntil(handleReply(env, event.data).catch((e) => console.error("handleReply", e)));
  return new Response("ok");
}

/**
 * El webhook solo llega firmado por la integración del cliente de prospección, así que si
 * CRM_CLIENT_ID no está configurado, el worker aprende el UUID del primer aviso y lo guarda.
 */
async function sameClient(env: Env, incoming: unknown): Promise<boolean> {
  if (typeof incoming !== "string" || !incoming) return false;
  await loadClientId(env);
  if (!env.CRM_CLIENT_ID) {
    await env.DB.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('crm_client_id', ?)").bind(incoming).run();
    await loadClientId(env);
  }
  return env.CRM_CLIENT_ID === incoming;
}

async function loadClientId(env: Env): Promise<void> {
  if (env.CRM_CLIENT_ID) return;
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'crm_client_id'").first<{ value: string }>();
  if (row?.value) env.CRM_CLIENT_ID = row.value;
}

async function handleReply(env: Env, data: any): Promise<void> {
  const conversationId: string = data.conversation_id;
  const blocked = await env.DB.prepare("SELECT 1 FROM do_not_contact WHERE key = ?").bind(data.contact_id ?? conversationId).first();
  if (blocked) return;

  const history = await messages(env, conversationId);
  const start = prospectingStart(history);
  const known = await env.DB.prepare("SELECT * FROM prospects WHERE conversation_id = ?").bind(conversationId).first<any>();
  if (!start && !known) return; // chat normal (te escribió el negocio primero): no es prospección

  const firstOut = known?.first_out_at ?? start?.firstOut ?? null;
  const firstIn = known?.first_in_at ?? start?.firstIn ?? null;
  const isFirstReply = !known?.first_in_at;
  const minutes = responseMinutes(firstOut, firstIn);
  const color = colorFor(minutes);
  const { who, intent } = await classify(env, String(data.content ?? ""));
  const branch = pickBranch({ isFirstReply, color, who, intent });

  if (!known) await holdForWorker(env, conversationId);

  await env.DB.prepare(
    `INSERT INTO prospects (conversation_id, number, contact_id, contact_name, origin, first_out_at, first_in_at, response_minutes, color, who_replied, branch, status, updated_at)
     VALUES (?1, ?2, ?3, ?4, 'anuncio', ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
     ON CONFLICT(conversation_id) DO UPDATE SET
       first_in_at = COALESCE(prospects.first_in_at, excluded.first_in_at),
       response_minutes = COALESCE(prospects.response_minutes, excluded.response_minutes),
       color = COALESCE(prospects.color, excluded.color),
       who_replied = CASE WHEN excluded.who_replied = 'desconocido' THEN prospects.who_replied ELSE excluded.who_replied END,
       branch = excluded.branch, status = excluded.status, updated_at = excluded.updated_at`,
  ).bind(
    conversationId, data.number ?? null, data.contact_id ?? null, data.contact_name ?? null,
    firstOut, firstIn, minutes, color, who, branch, intent === "no_interesa" ? "no_contactar" : "activo", now(),
  ).run();

  if (intent === "no_interesa") {
    await env.DB.prepare("INSERT OR IGNORE INTO do_not_contact (key, reason, created_at) VALUES (?, ?, ?)")
      .bind(data.contact_id ?? conversationId, "dijo que no le interesa", now()).run();
    await moveStage(env, conversationId, "perdido").catch(() => {});
  } else if (isFirstReply) {
    await moveStage(env, conversationId, "respondio").catch(() => {});
  }

  const text = await draft(env, { branch, history, contactName: data.contact_name ?? null, firstOut, minutes });
  if (!text) return;
  // Un borrador pendiente por chat: el nuevo reemplaza al anterior.
  await env.DB.prepare("UPDATE drafts SET status = 'descartado' WHERE conversation_id = ? AND status = 'pendiente'").bind(conversationId).run();
  await env.DB.prepare("INSERT INTO drafts (id, conversation_id, branch, text, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), conversationId, branch, text, now()).run();
}

async function panel(req: Request, url: URL, env: Env): Promise<Response> {
  const match = url.pathname.match(/^\/panel\/drafts\/([\w-]+)\/(send|discard)$/);
  if (match && req.method === "POST") {
    const [, id, action] = match;
    const row = await env.DB.prepare("SELECT * FROM drafts WHERE id = ? AND status = 'pendiente'").bind(id).first<any>();
    if (row) {
      await loadClientId(env);
      if (action === "send") {
        const form = await req.formData();
        const text = String(form.get("text") ?? row.text).trim();
        await reply(env, row.conversation_id, text, id);
        await env.DB.prepare("UPDATE drafts SET status = 'enviado', text = ?, sent_at = ? WHERE id = ?").bind(text, now(), id).run();
      } else {
        await env.DB.prepare("UPDATE drafts SET status = 'descartado' WHERE id = ?").bind(id).run();
      }
    }
    const back = row ? `/panel/chat/${row.conversation_id}` : "/panel";
    const referer = req.headers.get("Referer") ?? "";
    return Response.redirect(new URL(referer.includes("/panel/chat/") ? back : "/panel", url).toString(), 303);
  }

  if (url.pathname.startsWith("/panel/cola")) return queue(req, url, env);

  if (url.pathname === "/panel/simular") {
    return new Response(renderSim(), { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }
  if (url.pathname === "/panel/simular/api" && req.method === "POST") return simulate(req, env);

  const chat = url.pathname.match(/^\/panel\/chat\/([\w-]+)(\/messages\.json|\/reply)?$/);
  if (chat) {
    const [, conversationId, sub] = chat;
    await loadClientId(env);
    if (sub === "/messages.json") {
      try {
        return Response.json(await messages(env, conversationId));
      } catch (e) {
        return Response.json({ error: String(e) }, { status: 502 });
      }
    }
    if (sub === "/reply" && req.method === "POST") {
      const text = String((await req.formData()).get("text") ?? "").trim();
      if (text) await reply(env, conversationId, text, crypto.randomUUID());
      return Response.redirect(new URL(`/panel/chat/${conversationId}`, url).toString(), 303);
    }
    const prospect = await env.DB.prepare("SELECT * FROM prospects WHERE conversation_id = ?").bind(conversationId).first();
    const pending = await env.DB.prepare("SELECT * FROM drafts WHERE conversation_id = ? AND status = 'pendiente' ORDER BY created_at DESC").bind(conversationId).first();
    return new Response(renderChat(conversationId, prospect, pending), { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }
  const drafts = await env.DB.prepare(
    `SELECT d.*, p.contact_name, p.number, p.color, p.response_minutes, p.who_replied
     FROM drafts d LEFT JOIN prospects p ON p.conversation_id = d.conversation_id
     WHERE d.status = 'pendiente' ORDER BY d.created_at DESC LIMIT 50`,
  ).all();
  const prospects = await env.DB.prepare("SELECT * FROM prospects ORDER BY updated_at DESC LIMIT 100").all();
  return new Response(renderPanel(drafts.results as any[], prospects.results as any[], env.CRM_BASE_URL), {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

/** Corre el cerebro real (cronómetro, clasificador, rama y redactor) sobre una conversación inventada. */
async function simulate(req: Request, env: Env): Promise<Response> {
  const body: any = await req.json().catch(() => null);
  const history: Msg[] = Array.isArray(body?.messages) ? body.messages.slice(-40) : [];
  const start = prospectingStart(history);
  if (!start) return Response.json({ error: "El primer mensaje tiene que ser tuyo." }, { status: 400 });
  const last = history[history.length - 1];
  if (last?.role !== "user") return Response.json({ error: "El último mensaje tiene que ser del negocio." }, { status: 400 });
  const minutes = responseMinutes(start.firstOut, start.firstIn);
  const color = colorFor(minutes);
  const isFirstReply = history.filter((m) => m.role === "user").length === 1;
  const { who, intent } = await classify(env, String(last.content ?? ""));
  const branch = pickBranch({ isFirstReply, color, who, intent });
  try {
    const text = await draft(env, { branch, history, contactName: null, firstOut: start.firstOut, minutes });
    return Response.json({ color, time: minutes === null ? "sin respuesta" : `respondió en ${humanDuration(minutes)}`, who, intent, branch, draft: text });
  } catch (e) {
    return Response.json({ error: `No pude redactar: ${String(e)}` }, { status: 502 });
  }
}

async function queue(req: Request, url: URL, env: Env): Promise<Response> {
  const go = (flash?: string) =>
    Response.redirect(new URL("/panel/cola" + (flash ? "?m=" + encodeURIComponent(flash) : ""), url).toString(), 303);
  if (req.method === "POST") {
    if (url.pathname === "/panel/cola/import") {
      const file = (await req.formData()).get("file") as unknown as File | string | null;
      if (!file || typeof file === "string") return go("No llegó ningún archivo.");
      try {
        const leads = parseHunt(await file.text());
        const r = await importLeads(env, leads, file.name);
        return go(`${file.name}: ${r.added} nuevos, ${r.repeated} repetidos, ${r.blocked} en No contactar.`);
      } catch (e) {
        return go(`No pude leer ${file.name}: ${String(e)}`);
      }
    }
    if (url.pathname === "/panel/cola/quota") {
      await setQuota(env, Number((await req.formData()).get("quota")));
      return go("Cupo guardado.");
    }
    if (url.pathname === "/panel/cola/fill") {
      const n = await fillToday(env);
      await setSetting(env, "filled_day", today());
      return go(n ? `${n} prospectos listos para hoy, con su apertura.` : "El cupo de hoy ya está lleno o la cola está vacía.");
    }
    if (url.pathname === "/panel/cola/auto") {
      const on = String((await req.formData()).get("on")) === "on";
      if (on && !evolutionReady(env)) return go("Primero conecta Evolution.");
      await setSetting(env, "auto", on ? "on" : "off");
      if (on) await setSetting(env, "last_error", "");
      return go(on ? "Envío automático encendido." : "Envío automático apagado.");
    }
    const m = url.pathname.match(/^\/panel\/cola\/lead\/(\d+)$/);
    if (m) {
      const form = await req.formData();
      const action = String(form.get("action"));
      const opener = String(form.get("opener") ?? "").trim() || undefined;
      if (action === "send") {
        if (!opener) return go("El mensaje está vacío.");
        try {
          await sendFirst(env, m[1], opener);
        } catch (e) {
          return go(`No se pudo enviar: ${String(e)}`);
        }
        await markLead(env, m[1], "enviado", opener);
        return go("Enviado.");
      }
      if (action === "enviado" || action === "descartado" || action === "no_contactar") await markLead(env, m[1], action, opener);
      return go();
    }
  }
  const day = today();
  const counts = await env.DB.prepare("SELECT status, COUNT(*) AS n FROM leads GROUP BY status").all<{ status: string; n: number }>();
  const list = await env.DB.prepare("SELECT * FROM leads WHERE day = ? ORDER BY status = 'enviado', rowid").bind(day).all<any>();
  const html = renderQueue({
    counts: Object.fromEntries((counts.results ?? []).map((r) => [r.status, r.n])),
    quota: await getQuota(env),
    auto: (await setting(env, "auto")) === "on",
    ready: evolutionReady(env),
    lastError: (await setting(env, "last_error")) || null,
    nextAt: (await setting(env, "next_send_at")) || null,
    today: list.results ?? [],
    sentToday: (list.results ?? []).filter((l: any) => l.status === "enviado").length,
    flash: url.searchParams.get("m"),
  });
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
