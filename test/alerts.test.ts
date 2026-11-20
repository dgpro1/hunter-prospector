import { test } from "node:test";
import assert from "node:assert/strict";
import { linkTelegram, notify } from "../src/alerts.ts";

function env(state: Record<string, string> = {}, token: string | null = "bot-token") {
  const settings: Record<string, string> = { ...state };
  const DB = {
    prepare(sql: string) {
      return {
        bind(...a: any[]) {
          return {
            async first() {
              if (sql.startsWith("SELECT value FROM settings")) return settings[a[0]] != null ? { value: settings[a[0]] } : null;
              if (sql.includes("FROM leads")) return { name: "Clínica Sonrisa", city: "Bogotá", line: null, label: null };
              return null;
            },
            async run() { if (sql.includes("INTO settings")) settings[a[0]] = a[1]; return {}; },
            async all() { return { results: [] }; },
          };
        },
        async first() { return { n: 0 }; },
        async all() { return { results: [] }; },
      };
    },
  };
  return { e: { DB, TELEGRAM_BOT_TOKEN: token ?? undefined, PUBLIC_URL: "https://w" } as any, settings };
}

function telegram(handler: (url: string, body: any) => Response) {
  const calls: { url: string; body: any }[] = [];
  globalThis.fetch = (async (url: string, init?: any) => {
    const body = init?.body ? JSON.parse(init.body) : null;
    calls.push({ url: String(url), body });
    return handler(String(url), body);
  }) as any;
  return calls;
}
const ok = (x: any = {}) => new Response(JSON.stringify({ ok: true, result: x }), { status: 200 });

test("without the bot token it says which secret is missing", async () => {
  const { e } = env({}, null);
  const r = await linkTelegram(e);
  assert.equal(r.ok, false);
  assert.match(r.error!, /TELEGRAM_BOT_TOKEN/);
});

test("VISION's bot (webhook set, getUpdates 409) asks for the chat id instead of failing blind", async () => {
  const { e, settings } = env();
  telegram(() => new Response(JSON.stringify({ ok: false, error_code: 409, description: "Conflict: can't use getUpdates method while webhook is active" }), { status: 409 }));
  const r = await linkTelegram(e);
  assert.equal(r.ok, false);
  assert.equal(r.needsId, true);
  assert.match(r.error!, /VISION/);
  assert.equal(settings.telegram_chat, undefined);
});

test("a pasted chat id is saved only after the test message arrives", async () => {
  const { e, settings } = env();
  const calls = telegram(() => ok());
  const r = await linkTelegram(e, " 123456789 ");
  assert.equal(r.ok, true);
  assert.equal(settings.telegram_chat, "123456789");
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /sendMessage$/);
  assert.equal(calls[0].body.chat_id, "123456789");
});

test("a chat id Telegram refuses is not saved", async () => {
  const { e, settings } = env();
  telegram(() => new Response(JSON.stringify({ ok: false }), { status: 400 }));
  const r = await linkTelegram(e, "123456789");
  assert.equal(r.ok, false);
  assert.equal(settings.telegram_chat, undefined);
});

test("letters are not a chat id", async () => {
  const { e } = env();
  const r = await linkTelegram(e, "daniel");
  assert.equal(r.ok, false);
  assert.equal(r.needsId, true);
});

test("a bot without webhook still links the last private chat that wrote /start", async () => {
  const { e, settings } = env();
  telegram((url) => url.includes("getUpdates") ? ok([{ message: { chat: { id: 42424242, type: "private", first_name: "Daniel" } } }]) : ok());
  const r = await linkTelegram(e);
  assert.equal(r.ok, true);
  assert.equal(settings.telegram_chat, "42424242");
});

for (const [kind, icon] of [["demo_abierta", "🔥"], ["demo_chat", "🤖"], ["cita", "📅"]] as const) {
  test(`the ${kind} alert reaches the linked Telegram chat`, async () => {
    const { e } = env({ telegram_chat: "123456789" });
    const calls = telegram(() => ok());
    await notify(e, "573001112233", kind, "pasó algo");
    const tg = calls.filter((c) => c.url.includes("api.telegram.org"));
    assert.equal(tg.length, 1);
    assert.equal(tg[0].body.chat_id, "123456789");
    assert.ok(tg[0].body.text.startsWith(`${icon} Clínica Sonrisa (Bogotá): pasó algo`));
  });
}

test("no linked chat means no Telegram call (the bell still gets it)", async () => {
  const { e } = env({});
  const calls = telegram(() => ok());
  await notify(e, "573001112233", "cita", "agendó");
  assert.equal(calls.filter((c) => c.url.includes("api.telegram.org")).length, 0);
});
