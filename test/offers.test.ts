import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOpener, nicheKey, shortName } from "../src/offers.ts";

test("fórmula de oferta: Ayudo a nicho a resultado en plazo sin lo que más odian", () => {
  const o = { niche: "clínicas dentales", result: "tener un 30% más de citas", timeframe: "60 días", pain: "contratar a otra recepcionista", question_a: null, cta_b: null };
  const a = buildOpener({ name: "Clínica Dental Marbella Chapalita | Dra. Ruiz - Implantes" }, o, "A");
  assert.equal(a.split("\n")[0], "Hola, ¿hablo con Clínica Dental Marbella Chapalita? Soy Daniel y ayudo a clínicas dentales a tener un 30% más de citas en 60 días sin contratar a otra recepcionista.");
  assert.match(buildOpener({ name: "Smile" }, o, "B"), /¿Te muestro en 2 minutos cómo se vería en Smile\?$/);
  // tolera que escriban "a ...", "en ...", "sin ..." en los campos
  const b = buildOpener({ name: "X" }, { ...o, result: "a tener más citas", timeframe: "en 30 días", pain: "sin perder pacientes" }, "A");
  assert.match(b, /ayudo a clínicas dentales a tener más citas en 30 días sin perder pacientes\./);
});

test("claves de nicho sin tildes", () => {
  assert.equal(nicheKey("Clínicas  Dentales"), "clinicas dentales");
  assert.equal(shortName("Abogados García & Asociados (Despacho)"), "Abogados García & Asociados");
});
