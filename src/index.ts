// Hunter Prospector · worker v1 (Canal 2: tú escribes desde el anuncio, el worker toma el relevo).
import { type Env, holdForWorker, messages, moveStage, reply, verifySignature } from "./crm.ts";
import { classify, draft, pickBranch } from "./brain.ts";
import { colorFor, prospectingStart, responseMinutes } from "./timer.ts";
import { renderPanel } from "./panel.ts";

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
    return Response.redirect(new URL("/panel", url).toString(), 303);
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
