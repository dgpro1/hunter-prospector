import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mobile, parseMaps, PAISES } from "../src/hunt.ts";

test("móviles por país (fijos fuera)", () => {
  assert.equal(mobile("+34 612 34 56 78", PAISES.ES), "34612345678");
  assert.equal(mobile("+34 916 12 34 56", PAISES.ES), null);
  assert.equal(mobile("+52 664 115 1208", PAISES.MX), "526641151208");
  assert.equal(mobile("+57 310 555 1234", PAISES.CO), "573105551234");
});

test("lee una respuesta real de Google Maps (Getafe)", () => {
  const text = readFileSync(new URL("./fixtures/maps-getafe.txt", import.meta.url), "utf8");
  const t0 = performance.now();
  const { leads, total } = parseMaps(text, "Getafe", "barberías", PAISES.ES);
  const ms = performance.now() - t0;
  console.log(`fichas ${total}, con móvil ${leads.length}, ${ms.toFixed(1)} ms`, leads[0]);
  assert.ok(total >= 10);
  assert.ok(leads.length >= 1);
  assert.match(leads[0].phone, /^34[67]\d{8}$/);
});
