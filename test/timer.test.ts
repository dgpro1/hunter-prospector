import { test } from "node:test";
import assert from "node:assert/strict";
import { colorFor, humanDuration, prospectingStart, responseMinutes } from "../src/timer.ts";

test("semáforo por minutos", () => {
  assert.equal(colorFor(null), "gris");
  assert.equal(colorFor(5), "verde");
  assert.equal(colorFor(15), "verde");
  assert.equal(colorFor(40), "amarillo");
  assert.equal(colorFor(200), "naranja");
  assert.equal(colorFor(1158), "rojo");
});

test("minutos de respuesta", () => {
  assert.equal(responseMinutes("2026-11-10T21:12:00Z", "2026-11-11T16:30:00Z"), 1158);
  assert.equal(responseMinutes("2026-11-10T21:12:00Z", null), null);
  assert.equal(humanDuration(1158), "19 h 18 min");
  assert.equal(humanDuration(7), "7 min");
});

test("detecta prospección solo si escribimos primero", () => {
  const ours = [
    { role: "assistant", sender_type: "human", created_at: "2026-11-10T21:12:00Z", content: "Hola" },
    { role: "user", sender_type: "visitor", created_at: "2026-11-11T16:30:00Z", content: "Hola, ¿quién es?" },
  ];
  assert.deepEqual(prospectingStart(ours), { firstOut: "2026-11-10T21:12:00Z", firstIn: "2026-11-11T16:30:00Z" });
  const theirs = [{ role: "user", sender_type: "visitor", created_at: "2026-11-10T21:12:00Z", content: "Hola" }];
  assert.equal(prospectingStart(theirs), null);
  const activityFirst = [{ role: "assistant", kind: "activity", sender_type: "system", created_at: "2026-11-10T20:00:00Z", content: "" }, ...ours];
  assert.equal(prospectingStart(activityFirst)?.firstOut, "2026-11-10T21:12:00Z");
});
