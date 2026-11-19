import { test } from "node:test";
import assert from "node:assert/strict";
import { watchLines } from "../src/linewatch.ts";

function env(channels: any[], state: Record<string, string> = {}) {
  const settings: Record<string, string> = { ...state };
  const alerts: string[] = [];
  const DB = {
    prepare(sql: string) {
      return {
        bind(...a: any[]) {
          return {
            async first() { return sql.startsWith("SELECT value FROM settings") ? (settings[a[0]] != null ? { value: settings[a[0]] } : null) : null; },
            async run() {
              if (sql.includes("INTO settings")) settings[a[0]] = a[1];
              if (sql.includes("INTO alerts")) alerts.push(a[2]);
              return {};
            },
            async all() { return { results: [] }; },
          };
        },
        async first() { return { n: 0 }; },
        async all() { return { results: [] }; },
      };
    },
  };
  globalThis.fetch = (async () => new Response(JSON.stringify({ data: channels }), { status: 200 })) as any;
  return { e: { DB, CRM_API_TOKEN: "t", CRM_BASE_URL: "https://crm", PUBLIC_URL: "https://w", } as any, settings, alerts };
}

const qr = (id: string, connected: boolean) => ({ id, type: "whatsapp_qr", label: "Línea " + id, phone_number: "57350865052" + id, connected });

test("first look only takes the photo", async () => {
  const { e, alerts, settings } = env([qr("1", true)], { crm_client_id: "c" });
  assert.deepEqual(await watchLines(e), []);
  assert.equal(alerts.length, 0);
  assert.ok(settings.lines_state.includes('"connected":true'));
});

test("a line that drops is announced, and the pause when none is left", async () => {
  const { e, alerts } = env([qr("1", false)], { crm_client_id: "c", lines_state: JSON.stringify({ "1": { label: "Línea 1", number: "573508650521", connected: true } }) });
  const said = await watchLines(e);
  assert.equal(said.length, 2);
  assert.match(said[0], /Se desconectó/);
  assert.match(said[1], /pausa/);
  assert.equal(alerts.length, 2);
});

test("a line that comes back or vanishes is announced", async () => {
  const { e } = env([qr("1", true)], { crm_client_id: "c", lines_state: JSON.stringify({ "1": { label: "Línea 1", number: null, connected: false }, "2": { label: "Vieja", number: null, connected: true } }) });
  const said = await watchLines(e);
  assert.ok(said.some((s) => /Volvió/.test(s)));
  assert.ok(said.some((s) => /ya no está en el CRM/.test(s)));
});
