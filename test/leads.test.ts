import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePhone, parseHunt, today, fallbackOpener } from "../src/leads.ts";
import { inWindow, zoneFor } from "../src/auto.ts";

test("normaliza números del Cazador", () => {
  assert.equal(normalizePhone("+52 664 115 1208"), "526641151208");
  assert.equal(normalizePhone("https://wa.me/34600111222"), "34600111222");
  assert.equal(normalizePhone("123"), null);
});

test("lee JSON y CSV del Cazador y descarta los que no tienen WhatsApp", () => {
  const json = JSON.stringify([
    { nombre: "Clínica A", whatsapp: "+526641151208", ciudad: "Tijuana", rating: "4,8", confianza: "alta" },
    { nombre: "Sin número", whatsapp: "" },
  ]);
  const a = parseHunt(json);
  assert.equal(a.length, 1);
  assert.equal(a[0].rating, 4.8);
  const csv = '﻿nombre,whatsapp,ciudad,categoria\n"Barbería, La 1",+34600111222,Getafe,"Barbería"\n';
  const b = parseHunt(csv);
  assert.deepEqual([b[0].name, b[0].phone, b[0].city], ["Barbería, La 1", "34600111222", "Getafe"]);
});

test("horario local del negocio", () => {
  assert.equal(zoneFor("34600111222"), "Europe/Madrid");
  // Miércoles 11 nov 2026, 15:00 UTC = 16:00 Madrid (sí) y 09:00 CDMX (sí)
  assert.equal(inWindow("34600111222", new Date("2026-11-11T15:00:00Z")), true);
  assert.equal(inWindow("526641151208", new Date("2026-11-11T15:00:00Z")), true);
  // 06:00 UTC = 07:00 Madrid (no)
  assert.equal(inWindow("34600111222", new Date("2026-11-11T06:00:00Z")), false);
  // Domingo 15 nov (no)
  assert.equal(inWindow("526641151208", new Date("2026-11-15T18:00:00Z")), false);
});

test("día en Bogotá y apertura de respaldo honesta", () => {
  assert.equal(today(new Date("2026-11-11T03:00:00Z")), "2026-11-10");
  const t = fallbackOpener({ name: "Clínica Dental Sonrisa | Dra. X" }, "A");
  assert.match(t, /Clínica Dental Sonrisa\?/);
  assert.match(t, /Hunter AI/);
});

import { cleanOpener } from "../src/leads.ts";
test("deja una sola apertura aunque el modelo mande dos", () => {
  const raw = "# Variante A (problema-solución)\n\nHola! Soy Daniel de Hunter AI. ¿Les llegan mensajes de noche?\n\n# Variante B (demo directa)\n\nHola! Soy Daniel, ¿te muestro una demo?";
  assert.equal(cleanOpener(raw), "Hola! Soy Daniel de Hunter AI. ¿Les llegan mensajes de noche?");
  assert.equal(cleanOpener("¡Hola! Soy Daniel.\n\n¿Quién les contesta el WhatsApp?"), "¡Hola! Soy Daniel.\n\n¿Quién les contesta el WhatsApp?");
});
