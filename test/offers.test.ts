import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOpener, nicheKey, shortName } from "../src/offers.ts";

test("aperturas A/B cortas High Ticket y personalización por nicho", () => {
  const o = { niche: "clínicas dentales", result: "atender y agendar citas en segundos", timeframe: "7 días", pain: "perder pacientes fuera de horario", question_a: null, cta_b: null };
  const a = buildOpener({ name: "Clínica Dental Marbella Chapalita | Dra. Ruiz - Implantes" }, o, "A");
  assert.match(a, /^Hola, ¿qué tal\? Vi a Clínica Dental Marbella Chapalita en Google y armé una demo rápida/);
  assert.match(a, /¿Con quién de dirección podría compartirle el link para que la pruebe en 1 minuto\?$/);
  const bSalud = buildOpener({ name: "Smile" }, o, "B");
  assert.match(bSalud, /^Hola, buenas tardes\. ¿Este es el WhatsApp de Smile\?/);
  assert.match(bSalud, /agendar pacientes automáticamente/);
  assert.match(bSalud, /¿Les sirve si se los mando por aquí para que lo prueben sin compromiso\?$/);
  const bGeneral = buildOpener({ name: "Taller Apex" }, { ...o, niche: "talleres mecánicos" }, "B");
  assert.match(bGeneral, /agendar clientes automáticamente/);
});

test("claves de nicho sin tildes", () => {
  assert.equal(nicheKey("Clínicas  Dentales"), "clinicas dentales");
  assert.equal(shortName("Abogados García & Asociados (Despacho)"), "Abogados García & Asociados");
});

test("nombres en mayúsculas se suavizan", () => {
  assert.equal(shortName("CIRUJANO DENTISTA LAS 24 HRS GUADALAJARA"), "Cirujano Dentista las 24 Hrs Guadalajara");
});

import { splitAction, nicheOf, compileDemoPrompt } from "../src/demoPrompt.ts";
test("demo: separa la etiqueta de cita y detecta giro", () => {
  const r = splitAction('¡Listo, Ana! Te esperamos el martes 10am 😊\n<<<ACTION_TRIGGERED: {"action_type": "Cita Agendada", "client_name": "Ana", "item_or_service": "Valoración", "datetime_or_details": "martes 10am"}>>>');
  assert.equal(r.text, "¡Listo, Ana! Te esperamos el martes 10am 😊");
  assert.equal(r.booking?.client_name, "Ana");
  assert.equal(splitAction("hola").booking, null);
  assert.equal(nicheOf("Dentista", "Distrito Sonrisa"), "salud");
  assert.equal(nicheOf("Taller mecánico", "X"), "auto");
  const p = compileDemoPrompt({ business: "Distrito Sonrisa", category: "Dentista", city: "Getafe", rating: 4.8, services: null, hours: null, knowledge: null }, "TONO");
  assert.match(p, /<agenda>/);
  assert.match(p, /Dudas médicas/);
  assert.ok(!p.includes("null"));
});
