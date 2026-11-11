import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { classifyRegistrations, senalesLatinas } from "../src/ctRegistry.ts";
import { brandName, buildSite, chooseTemplate, findLeftovers, sanitizeFragment, type Compiled } from "../src/sitegen.ts";

const site = (k: string) => JSON.parse(readFileSync(new URL(`../src/sites/${k}.json`, import.meta.url), "utf8")) as Compiled;
const SITES = Object.fromEntries(["general", "construccion", "limpieza"].map((k) => [k, site(k)]));

test("registro: quita gestorías, correos repetidos y holdings; marca latinos", () => {
  const rows = [
    { accountnumber: "1", name: "RAMIREZ PAINTING LLC", business_email_address: "jramirez@gmail.com", naics_code: "Painting (238320)", billingcity: "MERIDEN", date_registration: "2026-11-05T00:00:00" },
    { accountnumber: "2", name: "ACME LLC", business_email_address: "x@zenbusiness.com", naics_code: "(561720)" },
    { accountnumber: "3", name: "OAK PROPERTIES LLC", business_email_address: "oak@gmail.com", naics_code: "(531110)" },
    ...[4, 5, 6, 7].map((i) => ({ accountnumber: String(i), name: `CO ${i}`, business_email_address: "agency@gmail.com", naics_code: "(722511)" })),
    { accountnumber: "8", name: "BLUE SKY CLEANING LLC", business_email_address: "info@blueskyct.com", naics_code: "Janitorial (561720)", billingcity: "hartford", date_registration: "2026-11-06T00:00:00" },
  ];
  const { leads, stats } = classifyRegistrations(rows);
  assert.deepEqual(leads.map((l) => l.ct_id), ["8", "1"]);
  assert.equal(stats.gestoria, 1);
  assert.equal(stats.shared, 4);
  assert.equal(stats.noOperativa, 1);
  assert.equal(leads[1].sector, "construccion");
  assert.equal(leads[1].city, "Meriden");
  assert.equal(leads[1].latino, true);
  assert.equal(leads[0].latino, false);
  assert.equal(classifyRegistrations(rows, { latinOnly: true }).leads.length, 1);
  assert.deepEqual(senalesLatinas("Remi Corp", "remi@x.com").reasons, []);
});

test("plantilla y marca", () => {
  assert.equal(chooseTemplate({ sector: "belleza", naics: "812111", name: "x" }), "barberia");
  assert.equal(chooseTemplate({ sector: "taxes" }), "general");
  assert.deepEqual(brandName("SOL TAX SERVICES LLC"), { legal: "Sol Tax Services LLC", brand: "Sol Tax Services" });
});

test("sanitizeFragment solo deja las etiquetas del original", () => {
  assert.equal(sanitizeFragment("Hola <em>tú</em>", "Hi <em>you</em>"), "Hola <em>tú</em>");
  assert.equal(sanitizeFragment("Hola <script>x</script>", "Hi <em>you</em>"), "Hola x");
});

// Redactor falso: cambia cada palabra del ejemplo por "Acme" en los textos que la tienen
const fakeWriter = async (_env: any, _facts: any, items: any[], _t: string, terms: string[]) => {
  const re = new RegExp(terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "gi");
  const texts: Record<string, { en: string; es: string }> = {};
  for (const i of items) {
    const s = `${i.en ?? ""} ${i.es ?? ""} ${i.text ?? ""}`;
    if (terms.length && re.test(s)) texts[i.id] = { en: String(i.en ?? i.text ?? "").replace(re, "Acme"), es: String(i.es ?? "").replace(re, "Acme") };
    re.lastIndex = 0;
  }
  return { texts, usage: { cost: 0.1 } };
};

test("buildSite: web sin rastro del negocio de ejemplo, con el correo real", async () => {
  const r = await buildSite({} as any, SITES, { name: "PEREZ PAINTING LLC", city: "Meriden", email: "perez.paint@gmail.com", sector: "construccion", naics: "(238320)" }, "es", fakeWriter as any);
  assert.equal(r.template, "construccion");
  assert.ok(r.html.includes("perez.paint@gmail.com"));
  assert.deepEqual(findLeftovers(r.html, ["Ramírez", "Arch St"]), []);
  assert.equal(r.usage.cost, 0.1);
});

test("buildSite en inglés oculta el selector de idioma y falla si el redactor deja el ejemplo", async () => {
  const r = await buildSite({} as any, SITES, { name: "BLUE SKY CLEANING LLC", city: "Hartford", email: "a@b.com", sector: "limpieza" }, "en", fakeWriter as any);
  assert.ok(r.html.includes("demo solo en inglés"));
  const lazy = async () => ({ texts: {}, usage: {} });
  await assert.rejects(buildSite({} as any, SITES, { name: "X LLC", sector: "otro" }, "es", lazy as any), /negocio de ejemplo/);
});
