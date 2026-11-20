import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze, looksAutomatic } from "../src/brain.ts";

const greeting = "Gracias por comunicarte a Clínica Dental Milenio. ¿Cómo podemos ayudarte?";

test("a WhatsApp Business greeting a few seconds later is automatic", () => {
  assert.equal(looksAutomatic(greeting, 5), true);
  assert.equal(looksAutomatic(greeting, 60), true);
  assert.equal(looksAutomatic("Hola, sí, soy la doctora. ¿Qué ofreces?", 900), false);
});

test("analysis keeps an automatic message out of 'replied', even if the model doubts", async () => {
  const env: any = { CLASSIFY_MODEL: "m", AI: { run: async () => ({ response: '{"auto":false,"who":"equipo","intent":"interesado","summary":"Saludo"}' }) } };
  const a = await analyze(env, [], greeting, 5);
  assert.equal(a.auto, true);
  assert.equal(a.intent, "otro");
});

test("a person who answers is not automatic, and a refusal always counts", async () => {
  const env: any = { CLASSIFY_MODEL: "m", AI: { run: async () => ({ response: '{"auto":false,"who":"dueno","intent":"no_interesa","summary":"No le interesa"}' }) } };
  const a = await analyze(env, [], "No nos interesa, gracias", 600);
  assert.equal(a.auto, false);
  assert.equal(a.intent, "no_interesa");
  assert.equal(a.who, "dueno");
});
