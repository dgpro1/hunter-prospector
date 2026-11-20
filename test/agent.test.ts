import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  agentCron, agentTurn, danielSpoke, gridTimes, hardRule, matchSlot, parseDecision, pickSlots, sendDraft, systemPrompt, withDemo, type Llm,
} from "../src/agent.ts";
import type { Msg } from "../src/timer.ts";

// ── D1 de mentira sobre SQLite ────────────────────────────────────────────────
function fakeD1() {
  const db = new DatabaseSync(":memory:");
  // schema.sql primero y luego las migraciones, sentencia por sentencia: algunas ALTER dependen
  // de tablas de una migración, y otras repiten columnas que schema.sql ya trae.
  const files = ["../schema.sql", ...["002_crm", "004_offers", "005_demos", "006_demo_booking", "007_alerts", "008_lines", "011_agent"].map((f) => `../migrations/${f}.sql`)];
  for (let pass = 0; pass < 2; pass++) {
    for (const f of files) {
      for (const stmt of readFileSync(new URL(f, import.meta.url), "utf8").split(";")) {
        try { db.exec(stmt); } catch { /* ya aplicada, o depende de una tabla de otra pasada */ }
      }
    }
  }
  const prep = (sql: string, args: unknown[] = []) => ({
    bind: (...a: unknown[]) => prep(sql, a),
    first: async () => (db.prepare(sql).get(...(args as any[])) as any) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...(args as any[])) }),
    run: async () => { const r = db.prepare(sql).run(...(args as any[])); return { meta: { changes: Number(r.changes) } }; },
  });
  return { raw: db, prepare: (sql: string) => prep(sql) };
}

const CONV = "11111111-1111-1111-1111-111111111111";
const LEAD = "5213312345678";
let calls: { url: string; method: string; body: any }[] = [];
let crmMessages: Msg[] = [];
let availability: string[] = [];
let bookFails = false;
const realFetch = globalThis.fetch;

function makeEnv() {
  const DB = fakeD1();
  DB.raw.prepare("INSERT INTO leads (phone, name, status, stage, created_at, updated_at, conversation_id) VALUES (?, ?, 'enviado', 'respondio', ?, ?, ?)")
    .run(LEAD, "Clínica Dental Milenio", "2026-11-20T10:00:00Z", "2026-11-20T10:00:00Z", CONV);
  DB.raw.prepare("INSERT INTO settings (key, value) VALUES ('agent_mode', 'sombra')").run();
  return {
    DB, CRM_BASE_URL: "https://crm.test", CRM_CLIENT_ID: "client-1", CRM_API_TOKEN: "x", PUBLIC_URL: "https://cazador.test",
    OPENROUTER_API_KEY: "x", OPENROUTER_MODEL: "m",
  } as any;
}

beforeEach(() => {
  calls = []; crmMessages = []; bookFails = false;
  availability = ["2026-11-21T15:00:00Z", "2026-11-21T15:30:00Z", "2026-11-21T20:00:00Z", "2026-11-22T15:00:00Z"];
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = String(input);
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url, method: init.method ?? "GET", body });
    const ok = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
    if (url.includes("/appointments/availability")) return ok({ days: [{ date: "2026-11-21", slots: availability.map((s) => ({ start_time: s })) }] });
    if (url.endsWith("/appointments")) return bookFails ? ok({ detail: "slot taken" }, 409) : ok({ id: "appt-1" }, 201);
    if (url.includes("/messages")) return ok({ data: crmMessages });
    if (url.includes("/reply")) return ok({ ok: true });
    if (url.includes("openrouter.ai")) return ok({ choices: [{ message: { content: JSON.stringify({ action: "responder", message: "¿Pudiste ver la demo? 🙂", price: false, reason: "seguimiento" }) } }] });
    return ok({});
  }) as typeof fetch;
});
afterEach(() => { globalThis.fetch = realFetch; });

const llmSays = (d: object): Llm => async () => JSON.stringify(d);
const msg = (role: string, content: string, created_at: string, sender_type = role === "user" ? "visitor" : "human"): Msg =>
  ({ role, content, created_at, sender_type, kind: "message" });
const AT = new Date("2026-11-20T18:00:00Z"); // 1 p. m. en Colombia

// ── Reglas puras ─────────────────────────────────────────────────────────────

test("se calla si preguntan si es un bot, si piden una persona o si se molestan", () => {
  const st = { stage: "conversando" as const, price_asks: 0 };
  assert.match(hardRule("¿Eres un bot?", st)!, /bot/);
  assert.match(hardRule("oye, estoy hablando con una inteligencia artificial?", st)!, /bot/);
  assert.match(hardRule("Quiero hablar con una persona", st)!, /persona/);
  assert.match(hardRule("esto es una estafa, los voy a reportar", st)!, /molesto/);
  assert.equal(hardRule("Sí, mándame la demo", st), null);
  assert.equal(hardRule("¿Cuánto cuesta?", st), null);
  assert.match(hardRule("¿pero cuánto cuesta?", { stage: "conversando", price_asks: 2 })!, /precio/);
  assert.match(hardRule("gracias!", { stage: "agendada", price_asks: 0 })!, /agendar/);
});

test("nota cuando Daniel escribió en el chat y no confunde los mensajes del agente", () => {
  const since = "2026-11-20T12:00:00Z";
  const h = [msg("assistant", "Apertura", "2026-11-20T10:00:00Z"), msg("user", "hola", "2026-11-20T12:30:00Z"), msg("assistant", "Hola, ¿te muestro la demo?", "2026-11-20T12:35:00Z")];
  assert.equal(danielSpoke(h, since, ["Hola,  ¿te muestro la demo?"]), false);
  assert.equal(danielSpoke([...h, msg("assistant", "Te llamo ahorita", "2026-11-20T12:40:00Z")], since, ["Hola, ¿te muestro la demo?"]), true);
});

test("ofrece horarios repartidos y con margen", () => {
  const free = ["2026-11-20T18:30:00Z", "2026-11-20T20:00:00Z", "2026-11-20T20:30:00Z", "2026-11-21T15:00:00Z", "2026-11-21T20:00:00Z"];
  // 18:30Z queda a menos de 90 min; 20:00 y 20:30 son la misma tarde
  assert.deepEqual(pickSlots(free, AT), ["2026-11-20T20:00:00Z", "2026-11-21T15:00:00Z", "2026-11-21T20:00:00Z"]);
});

test("sin calendario usa tu horario de 10 a 20 h de Colombia", () => {
  const g = gridTimes(AT, 1);
  assert.equal(g[0], "2026-11-20T15:00:00.000Z");      // 10:00 Bogotá
  assert.equal(g.at(-1), "2026-11-21T00:30:00.000Z");  // 19:30 Bogotá
});

test("la respuesta rara de la IA se vuelve traspaso, y agendar sin horario válido también", () => {
  assert.equal(parseDecision("no sé", 3).action, "traspaso");
  assert.equal(parseDecision('{"action":"agendar","message":"listo","slot":9}', 3).action, "traspaso");
  assert.equal(parseDecision('{"action":"responder","message":""}', 3).action, "traspaso");
  assert.deepEqual(parseDecision('ok {"action":"agendar","message":"Listo","slot":2,"price":false,"reason":"eligió"}', 3).slot, 2);
});

test("si la IA confirma el horario sin su número, lo reconoce por día y hora", () => {
  const slots = ["2026-11-21T15:00:00Z", "2026-11-21T20:00:00Z"];
  const raw = '{"action":"agendar","message":"Queda agendada el sábado 21 a las 9:00 a. m. (hora de México)"}';
  assert.equal(parseDecision(raw, 2, (m) => matchSlot(m, slots, "America/Mexico_City")).slot, 1);
  const vague = '{"action":"agendar","message":"Queda agendada el sábado"}';
  assert.equal(parseDecision(vague, 2, (m) => matchSlot(m, slots, "America/Mexico_City")).action, "traspaso");
});

test("pone el link de la demo donde va", () => {
  assert.equal(withDemo("Aquí la tienes: {DEMO} 👀", "https://x/demo/a"), "Aquí la tienes: https://x/demo/a 👀");
  assert.equal(withDemo("Aquí la tienes", "https://x/demo/a"), "Aquí la tienes\nhttps://x/demo/a");
  assert.match(withDemo("{DEMO}", "https://x/demo/a"), /^¡Listo! .*\nhttps:\/\/x\/demo\/a$/);
});

test("el prompt escribe los horarios en la hora del negocio y prohíbe precios", () => {
  const p = systemPrompt({ business: "Clínica", phone: "52133", stage: "demo_enviada", demoUrl: "u", demoViewed: true, slots: ["2026-11-21T15:00:00Z"], followup: null, priceAsks: 0 });
  assert.match(p, /9:00 a\.\s?m\..*hora de México/);
  assert.match(p, /Nunca des precios/);
  assert.match(p, /Eres Daniel/);
});

// ── Flujo completo con el CRM simulado ───────────────────────────────────────

test("modo sombra: acepta la demo → borrador con link; al aprobarlo se envía y pasa a Demo", async () => {
  const env = makeEnv();
  crmMessages = [msg("assistant", "Apertura", "2026-11-20T10:00:00Z"), msg("user", "Sí, me interesa verla", "2026-11-20T12:00:00Z")];
  const d = await agentTurn(env, { conversationId: CONV, lead: LEAD, history: crmMessages, text: "Sí, me interesa verla", mode: "sombra",
    llm: llmSays({ action: "enviar_demo", message: "¡Genial! Aquí está la de Milenio: {DEMO}", price: false, reason: "aceptó" }) });
  assert.equal(d!.action, "enviar_demo");
  const draft: any = await env.DB.prepare("SELECT * FROM drafts WHERE conversation_id = ?").bind(CONV).first();
  assert.equal(draft.status, "pendiente");
  assert.match(draft.text, /^¡Genial! Aquí está la de Milenio: https:\/\/cazador\.test\/demo\/clinica-dental-milenio-/);
  assert.equal(calls.filter((c) => c.url.includes("/reply")).length, 0, "en sombra no envía nada solo");

  assert.equal(await sendDraft(env, draft, draft.text), true);
  assert.equal(calls.filter((c) => c.url.includes("/reply")).length, 1);
  const st: any = await env.DB.prepare("SELECT * FROM agent_state WHERE conversation_id = ?").bind(CONV).first();
  assert.equal(st.stage, "demo_enviada");
  const lead: any = await env.DB.prepare("SELECT stage FROM leads WHERE phone = ?").bind(LEAD).first();
  assert.equal(lead.stage, "demo");
});

test("agendar crea la cita en el CRM antes de confirmar por chat", async () => {
  const env = makeEnv();
  crmMessages = [msg("assistant", "Apertura", "2026-11-20T10:00:00Z"), msg("user", "El sábado a las 10 me sirve", "2026-11-20T12:00:00Z")];
  await agentTurn(env, { conversationId: CONV, lead: LEAD, history: crmMessages, text: "El sábado a las 10 me sirve", mode: "sombra",
    llm: llmSays({ action: "agendar", message: "Listo, quedamos el sábado a las 10 🙌", slot: 1, price: false, reason: "eligió" }) });
  const draft: any = await env.DB.prepare("SELECT * FROM drafts WHERE conversation_id = ?").bind(CONV).first();
  assert.equal(await sendDraft(env, draft, draft.text), true);
  const order = calls.filter((c) => c.method === "POST").map((c) => c.url.split("/").pop());
  assert.deepEqual(order.slice(-2), ["appointments", "reply"]);
  const booking = calls.find((c) => c.url.endsWith("/appointments"))!;
  assert.equal(booking.body.duration_minutes, 15);
  assert.equal(booking.body.conversation_id, CONV);
  const st: any = await env.DB.prepare("SELECT stage FROM agent_state WHERE conversation_id = ?").bind(CONV).first();
  assert.equal(st.stage, "agendada");
});

test("si el calendario no deja agendar, no promete nada y te pasa el chat", async () => {
  const env = makeEnv();
  bookFails = true;
  crmMessages = [msg("assistant", "Apertura", "2026-11-20T10:00:00Z"), msg("user", "la primera opción", "2026-11-20T12:00:00Z")];
  await agentTurn(env, { conversationId: CONV, lead: LEAD, history: crmMessages, text: "la primera opción", mode: "sombra",
    llm: llmSays({ action: "agendar", message: "Listo, quedamos", slot: 1, price: false, reason: "eligió" }) });
  const draft: any = await env.DB.prepare("SELECT * FROM drafts WHERE conversation_id = ? AND action = 'agendar'").bind(CONV).first();
  assert.equal(await sendDraft(env, draft, draft.text), false);
  assert.equal(calls.filter((c) => c.url.includes("/reply")).length, 0);
  const st: any = await env.DB.prepare("SELECT stage, handoff_reason FROM agent_state WHERE conversation_id = ?").bind(CONV).first();
  assert.equal(st.stage, "traspaso");
  assert.match(st.handoff_reason, /no pude agendar/);
});

test("pregunta si es un bot → no responde, te pasa el chat", async () => {
  const env = makeEnv();
  crmMessages = [msg("assistant", "Apertura", "2026-11-20T10:00:00Z"), msg("user", "¿eres un bot?", "2026-11-20T12:00:00Z")];
  let asked = false;
  await agentTurn(env, { conversationId: CONV, lead: LEAD, history: crmMessages, text: "¿eres un bot?", mode: "auto", llm: async () => { asked = true; return "{}"; } });
  assert.equal(asked, false);
  const n: any = await env.DB.prepare("SELECT COUNT(*) n FROM drafts WHERE status IN ('pendiente','programado')").first();
  assert.equal(n.n, 0);
});

test("automático: sale con pausa humana y no pisa a Daniel si escribió", async () => {
  const env = makeEnv();
  env.DB.raw.prepare("UPDATE settings SET value = 'auto' WHERE key = 'agent_mode'").run();
  crmMessages = [msg("assistant", "Apertura", "2026-11-20T10:00:00Z"), msg("user", "¿Qué hace exactamente?", "2026-11-20T12:00:00Z")];
  await agentTurn(env, { conversationId: CONV, lead: LEAD, history: crmMessages, text: "¿Qué hace exactamente?", mode: "auto",
    llm: llmSays({ action: "responder", message: "Contesta a tus pacientes al instante y agenda solo. ¿Te muestro cómo se vería en Milenio?", price: false, reason: "duda" }) });
  const draft: any = await env.DB.prepare("SELECT * FROM drafts WHERE conversation_id = ?").bind(CONV).first();
  assert.equal(draft.status, "programado");
  const wait = Date.parse(draft.send_at) - Date.parse(draft.created_at);
  assert.ok(wait >= 60_000 && wait <= 240_000, `pausa ${wait}`);

  // Antes de que salga, Daniel escribe desde su teléfono
  crmMessages.push(msg("assistant", "Hola, soy Daniel, te marco en 5", new Date().toISOString()));
  const r = await agentCron(env, new Date(Date.parse(draft.send_at) + 1000));
  assert.match(r, /0 enviados/);
  assert.equal(calls.filter((c) => c.url.includes("/reply")).length, 0);
  const st: any = await env.DB.prepare("SELECT stage FROM agent_state WHERE conversation_id = ?").bind(CONV).first();
  assert.equal(st.stage, "traspaso");
});

test("seguimiento al día siguiente si no responde, y deja dormido tras 3", async () => {
  const env = makeEnv();
  const t0 = "2026-11-19T15:00:00Z";
  env.DB.raw.prepare("INSERT INTO agent_state (conversation_id, lead, stage, last_in_at, last_out_at, created_at, updated_at) VALUES (?, ?, 'demo_enviada', ?, ?, ?, ?)")
    .run(CONV, LEAD, "2026-11-19T14:00:00Z", t0, "2026-11-19T13:00:00Z", t0);
  crmMessages = [msg("assistant", "Apertura", "2026-11-19T10:00:00Z")];
  const r = await agentCron(env, new Date("2026-11-20T16:00:00Z")); // 25 h después, 10 a. m. en México
  assert.match(r, /1 seguimientos/);
  const draft: any = await env.DB.prepare("SELECT * FROM drafts WHERE conversation_id = ?").bind(CONV).first();
  assert.equal(JSON.parse(draft.payload).followup, 1);

  env.DB.raw.prepare("UPDATE drafts SET status = 'enviado'").run();
  env.DB.raw.prepare("UPDATE agent_state SET followups = 3").run();
  await agentCron(env, new Date("2026-11-28T16:00:00Z"));
  const st: any = await env.DB.prepare("SELECT stage FROM agent_state WHERE conversation_id = ?").bind(CONV).first();
  assert.equal(st.stage, "dormido");
});
