import { test } from "node:test";
import assert from "node:assert/strict";
import { CrmError } from "../src/crm.ts";
import { sendErrorText } from "../src/auto.ts";

test("si el CRM no tiene el endpoint de escribir primero, lo dice claro", () => {
  const e = new CrmError(404, "", "CRM POST /conversations/start → 404 Not Found");
  assert.match(sendErrorText(e), /todavía no tiene el endpoint/);
});

test("permiso faltante en la integración", () => {
  assert.match(sendErrorText(new CrmError(403, "", "CRM GET /channels → 403")), /channels\.read/);
});

test("el código del CRM llega al worker", () => {
  const e = new CrmError(422, "not_on_whatsapp", "CRM POST /conversations/start → 422");
  assert.equal(e.code, "not_on_whatsapp");
});
