// Motor de webs demo: plantilla hecha a mano (precompilada en src/sites/*.json) + textos que escribe la IA para el negocio real.
// Portado de eternitydevzz/web-creator-360 (src/sitegen). Aquí no se parsea HTML: solo se reemplazan los huecos ya localizados.
import type { Env } from "./crm.ts";

type Unit = { id: string; slot: string; kind: "html" | "text" | "attr"; attr?: string; lang?: string | null; range: [number, number]; text: string; pair?: string };
export type Compiled = { key: string; source: string; units: Unit[]; optional: { name: string | null; range: [number, number] }[]; facts: { emails: string[]; phones: string[]; mapQueries: string[]; directions: string[] } };
type Item = { id: string; slot: string; kind: string; attr?: string; lang?: string; en?: string; es?: string; text?: string };
export type Texts = Record<string, { en: string; es: string }>;
export type Audience = "es" | "en";


// Negocio de ejemplo de cada plantilla: ninguna de estas palabras puede quedar en una web real.
export const TEMPLATES: Record<string, { sample: string[]; sampleCity: string }> = {
  construccion: { sample: ["Ramírez", "Ramirez", "Luis", "Ana", "Arch St", "2025"], sampleCity: "New Britain" },
  limpieza: { sample: ["Brillo", "Daniela", "Ríos", "Park St", "2024"], sampleCity: "Hartford" },
  jardineria: { sample: ["Hernández", "Hernandez", "Carlos", "Ana", "Thomaston Ave", "2024"], sampleCity: "Waterbury" },
  comida: { sample: ["Doña Rosa", "Rosa", "Hernández", "Luis", "East Main St", "Puebla", "2004"], sampleCity: "Bridgeport" },
  belleza: { sample: ["Bella Luna", "Luna", "Restrepo", "Andrés", "Molina", "Daniela", "Pérez", "Bedford St"], sampleCity: "Stamford" },
  barberia: { sample: ["Filo", "Héctor", "Hector", "Tito", "Rivera", "Jay", "Morales", "Nando", "Ortiz", "Park Avenue", "Park Ave"], sampleCity: "Bridgeport" },
  general: { sample: ["Núñez", "Nunez", "Carmen", "Luis", "East Main St", "2019"], sampleCity: "Waterbury" },
};

const SAMPLE_CITY_AREA: Record<string, string[]> = {
  waterbury: ["Wolcott", "Cheshire", "Naugatuck", "Prospect", "Watertown", "Middlebury", "Southbury", "Oxford", "Thomaston", "Plymouth", "Bristol", "Beacon Falls", "Woodbury", "Bethlehem", "Seymour", "Southington", "Waterville", "Oakville"],
  "new britain": ["Berlin", "Kensington", "Bristol", "Plainville", "Southington", "Newington", "Farmington", "West Hartford", "Wethersfield", "Rocky Hill", "Cromwell", "Meriden", "Middletown"],
  hartford: ["West Hartford", "East Hartford", "Wethersfield", "Newington", "Bloomfield", "Windsor", "Manchester", "Glastonbury", "Farmington", "Avon", "South Windsor", "Rocky Hill", "New Britain", "Canton", "Simsbury", "East Windsor"],
  bridgeport: ["Stratford", "Fairfield", "Trumbull", "Milford", "Shelton", "Monroe", "Easton", "Westport", "Norwalk", "Orange", "Derby", "Ansonia", "Huntington", "Devon"],
  stamford: ["Greenwich", "Darien", "Norwalk", "New Canaan", "Westport", "Wilton", "Fairfield", "Riverside", "Cos Cob", "Old Greenwich", "Ridgefield"],
};
// Webs solo en inglés: las plantillas son bilingües para negocios latinos; decir "Hablamos español" sería falso.
const ENGLISH_ONLY_TERMS = ["español", "Hablamos", "Atendemos", "Spanish", "bilingual", "bilingüe"];

const fold = (s: unknown) => String(s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function chooseTemplate({ sector, naics = "", name = "" }: { sector?: string | null; naics?: string | null; name?: string }): string {
  if (sector === "belleza") return /812111/.test(naics ?? "") || /barber/i.test(name) ? "barberia" : "belleza";
  return ["construccion", "limpieza", "jardineria", "comida"].includes(sector ?? "") ? sector! : "general";
}

export function sampleTerms(key: string, { name = "", city = "", year = "", audience = "es" as Audience } = {}): string[] {
  const t = TEMPLATES[key] ?? { sample: [], sampleCity: "" };
  const terms = [...t.sample, ...(audience === "en" ? ENGLISH_ONLY_TERMS : [])];
  const area = (SAMPLE_CITY_AREA[fold(t.sampleCity)] ?? []).map(fold);
  if (t.sampleCity && fold(t.sampleCity) !== fold(city) && !area.includes(fold(city))) terms.push(t.sampleCity);
  const own = fold(`${name} ${city}`);
  return terms.filter((term) => !own.includes(fold(term)) && term !== String(year));
}

// "EL SAMPLE GARAGE LLC" → "El Sample Garage LLC"
const LOWER_WORDS = new Set(["de", "del", "la", "el", "los", "las", "y", "e", "and", "of", "the", "a"]);
export function displayName(raw: unknown): string {
  const name = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (name !== name.toUpperCase()) return name;
  return name.toLowerCase().split(" ").map((w, i) => {
    if (["llc", "inc", "corp", "ltd", "llp"].includes(w.replace(/\./g, ""))) return w.toUpperCase();
    if (i > 0 && LOWER_WORDS.has(w)) return w;
    // Siglas: "RMA", "JC", "ABC" se quedan en mayúsculas (pero "Tax", "Sol", "Mi" no)
    if (/^[a-z]{2,3}$/.test(w) && !LOWER_WORDS.has(w) && !/^[^aeiou][aeiouy][^aeiou]?$/.test(w)) return w.toUpperCase();
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(" ");
}
export function brandName(raw: unknown): { legal: string; brand: string } {
  const legal = displayName(raw);
  const brand = legal.replace(/[\s,]+(LLC|L\.L\.C\.|INC|Inc\.?|CORP|Corp\.?|LTD|Ltd\.?|LLP|Co\.)$/i, "").trim();
  return { legal, brand: brand || legal };
}

const SECTOR_EN: Record<string, string> = {
  construccion: "construction", limpieza: "cleaning", jardineria: "landscaping", belleza: "beauty", comida: "food",
  transporte: "transportation", taxes: "tax services", auto: "auto services", seguros: "insurance", salud: "health", eventos: "events",
};

export type Business = { name: string; city?: string | null; state?: string | null; email?: string | null; phone?: string | null; sector?: string | null; naics?: string | null; registered?: string | null };

export function businessFacts(b: Business) {
  const { legal, brand } = brandName(b.name);
  return {
    brand, legalName: legal, city: b.city || "Hartford", state: b.state || "CT",
    sector: SECTOR_EN[b.sector ?? ""] ?? "small business",
    activity: b.naics || null,
    registeredYear: b.registered ? String(b.registered).slice(0, 4) : null,
    email: b.email || null, phone: b.phone || null,
  };
}
type Facts = ReturnType<typeof businessFacts>;

// ─── Plantilla → piezas para la IA ───────────────────────────────────────────

export function writerItems(c: Compiled, drop: string[] = []): Item[] {
  const byId = new Map(c.units.map((u) => [u.id, u]));
  const dropped = c.optional.filter((o) => o.name && drop.includes(o.name)).map((o) => o.range);
  const items: Item[] = [];
  for (const u of c.units) {
    if (u.pair && u.lang === "es") continue;
    if (dropped.some(([a, b]) => u.range[0] >= a && u.range[1] <= b)) continue;
    if (u.pair) items.push({ id: u.id, slot: u.slot, kind: u.kind, en: u.text, es: byId.get(u.pair)!.text });
    else items.push({ id: u.id, slot: u.slot, kind: u.kind, ...(u.attr ? { attr: u.attr } : {}), ...(u.lang ? { lang: u.lang } : {}), text: u.text });
  }
  return items;
}

// ─── Render ──────────────────────────────────────────────────────────────────

const TAG_RE = /<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s[^<>]*)?\/?>/g;
const escText = (s: unknown) => String(s).replace(/&(?![a-zA-Z][a-zA-Z0-9]*;|#\d+;|#x[0-9a-fA-F]+;)/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s: unknown) => escText(s).replace(/"/g, "&quot;");
const tagName = (tok: string) => tok.match(/^<\/?([a-zA-Z][a-zA-Z0-9-]*)/)![1].toLowerCase();
const VOID = new Set(["br", "wbr", "img", "hr", "input"]);

/** La IA solo puede reusar las etiquetas que ya tenía el texto original, bien anidadas; si no, queda texto plano. */
export function sanitizeFragment(value: string, original: string): string {
  const allowed = new Set(original.match(TAG_RE) ?? []);
  const tokens = String(value).match(TAG_RE) ?? [];
  let ok = tokens.every((t) => allowed.has(t));
  if (ok) {
    const stack: string[] = [];
    for (const t of tokens) {
      const name = tagName(t);
      if (VOID.has(name) || t.endsWith("/>")) continue;
      if (t.startsWith("</")) { if (stack.pop() !== name) { ok = false; break; } } else stack.push(name);
    }
    if (stack.length) ok = false;
  }
  const parts = String(value).split(TAG_RE);
  if (!ok) return escText(parts.join(""));
  return parts.map((text, i) => escText(text) + (tokens[i] ?? "")).join("");
}

function newTextFor(u: Unit, texts: Texts): string | undefined {
  if (u.pair && u.lang === "es") return texts[u.pair]?.es || undefined;
  const t = texts[u.id];
  if (!t) return undefined;
  if (u.pair) return t.en || undefined;
  return t.en || t.es || undefined;
}

const phoneForms = (d: string) => [
  `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`, `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`,
  `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`, `+1 ${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`, `+1${d}`, d,
];

export function renderSite(c: Compiled, { texts = {} as Texts, drop = [] as string[], facts = {} as { email?: string | null; phone?: string | null; mapQuery?: string } } = {}): string {
  const dropped = c.optional.filter((o) => o.name && drop.includes(o.name)).map((o) => o.range);
  const inside = (r: [number, number]) => dropped.some(([a, b]) => r[0] >= a && r[1] <= b);
  const edits = dropped.map(([start, end]) => ({ start, end, value: "" }));
  for (const u of c.units) {
    if (inside(u.range)) continue;
    const v = newTextFor(u, texts);
    if (v === undefined) continue;
    edits.push({ start: u.range[0], end: u.range[1], value: u.kind === "html" ? sanitizeFragment(v, u.text) : u.kind === "attr" ? escAttr(v) : escText(v) });
  }
  // Un solo recorrido de izquierda a derecha (más barato que cortar el texto una vez por cada hueco)
  edits.sort((a, b) => a.start - b.start);
  const out: string[] = [];
  let pos = 0;
  for (const e of edits) { if (e.start < pos) continue; out.push(c.source.slice(pos, e.start), e.value); pos = e.end; }
  out.push(c.source.slice(pos));
  let html = out.join("");

  if (facts.email) for (const s of c.facts.emails) html = html.replace(new RegExp(reEsc(s), "gi"), facts.email);
  const phone = String(facts.phone || "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  if (phone.length === 10) for (const s of c.facts.phones) { const from = phoneForms(s), to = phoneForms(phone); from.forEach((f, i) => { html = html.split(f).join(to[i]); }); }
  if (facts.mapQuery) {
    for (const s of c.facts.directions) html = html.split(`destination=${s}`).join(`destination=${encodeURIComponent(facts.mapQuery).replace(/%20/g, "+").replace(/%2C/gi, "")}`);
    const q = encodeURIComponent(facts.mapQuery).replace(/%20/g, "+").replace(/%2C/gi, ",");
    for (const s of c.facts.mapQueries) html = html.split(`q=${s}`).join(`q=${q}`);
  }
  return html;
}

/** Palabras del negocio de ejemplo que siguen visibles → [] si la web está limpia. */
export function findLeftovers(html: string, terms: string[], ignore: (string | null)[] = []): string[] {
  let text = html;
  for (const s of ignore.filter(Boolean) as string[]) text = text.split(s).join(" ");
  const visible = text.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/gi, " ")
    .replace(/<[^>]*\balt="([^"]*)"[^>]*>/gi, " $1 ").replace(/<[^>]+>/g, " ");
  return terms.filter((t) => new RegExp(`(^|[^\\p{L}])${reEsc(t)}($|[^\\p{L}])`, "iu").test(visible));
}

// ─── Redactor (OpenRouter) ───────────────────────────────────────────────────

const BANNED = [
  "dream / de tus sueños", "excellence / excelencia", "passion / pasión", "integral solutions / soluciones integrales",
  "unparalleled / inigualable", "elevate", "seamless", "top-notch", "one-stop", "cutting-edge", "state-of-the-art",
  '"Ready to…?" / "¿Listo para…?"', "your trusted partner / tu socio de confianza", "we've got you covered",
  "calidad y profesionalidad", "perfect / perfecto in headlines",
];
const SYSTEM_ES = "You adapt the copy of a hand-designed small-business website template to a real business. The design is fixed; you only rewrite texts. The result is a free demo website shown to the business owner (a Hispanic/Latino entrepreneur in the United States), so it must read as if written for their business by a good local copywriter: specific, warm, plain, never generic marketing talk.";
const SYSTEM_EN = "You adapt the copy of a hand-designed small-business website template to a real business. The design is fixed; you only rewrite texts. The result is a free demo website shown to the business owner (a small-business owner in the United States), so it must read as if written for their business by a good local copywriter: specific, warm, plain, never generic marketing talk.";

export function buildPrompt(facts: Facts, items: Item[], template: string, terms: string[], audience: Audience): string {
  const en = audience === "en";
  const shown = en ? items.filter((i) => i.lang !== "es").map(({ es: _es, ...rest }) => rest) : items;
  const shapeLine = en
    ? 'Items have an id, the page section ("slot") they belong to, and an English text ("en"), or a single text ("text", with "attr" when it is an HTML attribute such as alt text or a placeholder).'
    : 'Items have an id, the page section ("slot") they belong to, and either an English + Spanish pair ("en"/"es") or a single text ("text", with "lang" when it is language-specific, and "attr" when it is an HTML attribute such as alt text or a placeholder).';
  const languageRules = en
    ? `- English: natural American English. This website is ENGLISH ONLY: write no Spanish at all.
- Languages: the sample business is bilingual (English and Spanish); the real one is NOT assumed to be. NEVER mention Spanish, "bilingual", "Hablamos español", "in English or Spanish" or any language service. Where an item is about languages, replace it with an equivalent real benefit for this business (quick replies, free estimates, local service…), about the same length, without inventing facts.`
    : "- English: natural American English. Spanish: natural US Latino Spanish, keeping the same tú/usted as the original.";
  const outputRule = en
    ? 'OUTPUT: only JSON {"units":[{"id","en"}]} with only the changed items; "en" is the new text (for a single text too).'
    : 'OUTPUT: only JSON {"units":[{"id","en","es"}]} with only the changed items. For a pair, "en" and "es" are the new English and Spanish. For a single text, put the new text in "en" and leave "es" empty.';
  return `TEMPLATE: "${template}". Each item below is a text of the page as it is now, written for a FICTIONAL sample business. ${shapeLine} The real business is described after the items.

YOUR TASK
Rewrite every item that refers to the sample business so it fits the real business. Return ONLY the items you change.
- Anything specific to the sample must go: its name, the names of its owners and staff, its street address, its city and nearby towns, its founding story and years, its specific jobs, dishes or services, its photo captions.
- Keep unchanged (so: do not return) generic interface labels that fit any business, like "Menu", "Call", "Send request", "FAQ".
- Brand: use the real brand wherever the sample brand appears (logo, titles, footer); the legal name only in the copyright line.
- Place: EVERY town list (service area, nearby towns, project locations) must contain only real towns within about 30 minutes of the real city; replace all sample towns. Never write a street address; say the town instead. Map and directions texts refer to the real city.
- Services, menus, prices, FAQ: make them right for the real activity. If the name reveals a specialty (a cuisine, a trade like painting or tile, a country), follow it. Prices must be realistic for the business's state and keep the original format.
- The business is new: NEVER invent facts that could be false claims — no years of experience, numbers of clients or jobs, awards, certifications, ratings or reviews. Keep placeholders such as license numbers ("HIC.0000000", "#0000000") exactly as they are. Opening hours: keep them exactly as they are.
- Licenses, insurance, registrations: the business is brand new and we do NOT know whether it is licensed, registered or insured. Never claim it ("Licensed", "Fully insured", "CT registered", "HIC #", "Ours is right here", "certificate of insurance"). Rewrite those items as neutral, true statements such as "Ask us about licensing and insurance" or "Written estimate before any work". Leave license number placeholders untouched.
- Story: never invent the owner's background, experience, training or a first-person quote from the owner. Describe what the business offers instead.
- Timelines must be realistic for the activity (a new house takes months, not weeks).
- People: the owners are unknown. Don't name anyone; write as "we", "our team" or "the owner". Where the sample shows a person's name as a caption or signature, use the brand or a role instead.
- Keep each text about the same length as the original (±20%) and in the same role (a headline stays a short headline).
- HTML: some texts contain inline tags (<em>, <br>, <span class="…">…). Keep exactly the same tags with the same attributes, in the same structure; only change the words. Write & as &amp;.
${languageRules}
- Never use these words or phrases: ${BANNED.join("; ")}. No emojis.

${outputRule}

ITEMS
${JSON.stringify(shown)}

BUSINESS (the real one)
${JSON.stringify(facts, null, 2)}

For this business:
- Words of the sample that must not survive${terms.length ? `: ${terms.join(", ")}` : ""}.
- Brand: "${facts.brand}"; legal name (copyright line only): "${facts.legalName}".
- Place: ${facts.city}, ${facts.state}.
- Activity: ${facts.activity || facts.sector}.${facts.registeredYear ? ` Registered in ${facts.registeredYear}: a new business.` : ""}
- Contact: email ${facts.email || "(keep the sample email)"}; phone ${facts.phone || "(unknown: keep the sample phone number exactly as it is)"}.`;
}

export type Usage = { prompt_tokens?: number; completion_tokens?: number; cost?: number };

export type Engine = "gemini" | "cloudflare" | "openrouter";
export const ENGINE_LABEL: Record<Engine, string> = {
  gemini: "Gemini (gratis con clave de AI Studio)",
  cloudflare: "Cloudflare Workers AI (gratis, ~6 webs al día)",
  openrouter: "OpenRouter (de pago)",
};
const CF_MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";

/** Motor por defecto: el elegido en el panel; si no, Gemini cuando hay clave; si no, el gratis de Cloudflare. */
export function geminiKeys(env: Env): string[] {
  return [env.GEMINI_API_KEY, env.GEMINI_API_KEY_2, env.GEMINI_API_KEY_3].flatMap((k) => String(k ?? "").split(",")).map((k) => k.trim()).filter(Boolean);
}

export function pickEngine(env: Env, chosen: string | null): Engine {
  if (chosen === "gemini" && geminiKeys(env).length) return "gemini";
  if (chosen === "openrouter" && env.OPENROUTER_API_KEY) return "openrouter";
  if (chosen === "cloudflare") return "cloudflare";
  return geminiKeys(env).length ? "gemini" : "cloudflare";
}

/** Manda un prompt al motor y devuelve el texto de la respuesta. */
async function ask(env: Env, engine: Engine, system: string, user: string): Promise<{ raw: string; usage: Usage }> {
  if (engine === "gemini") {
    const model = env.GEMINI_MODEL || "gemini-2.5-flash";
    // Varias claves (GEMINI_API_KEY, _2, _3 o separadas por comas): empieza por una al azar y si una da 429 prueba la siguiente
    const keys = geminiKeys(env);
    const start = Math.floor(Math.random() * keys.length);
    let last = "";
    for (let n = 0; n < keys.length; n++) {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": keys[(start + n) % keys.length] },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: user }] }],
          generationConfig: { temperature: 0.6, maxOutputTokens: 32000, responseMimeType: "application/json", thinkingConfig: { thinkingBudget: 0 } },
        }),
      });
      if (res.status === 429 || res.status === 403) { last = `Gemini → ${res.status} ${(await res.text()).slice(0, 160)}`; continue; }
      if (!res.ok) throw new Error(`Gemini → ${res.status} ${(await res.text()).slice(0, 200)}`);
      const data: any = await res.json();
      const c = data.candidates?.[0];
      if (c?.finishReason === "MAX_TOKENS") throw new Error("La respuesta de la IA se cortó antes de terminar");
      const raw = (c?.content?.parts ?? []).map((p: any) => p.text ?? "").join("");
      return { raw, usage: { prompt_tokens: data.usageMetadata?.promptTokenCount, completion_tokens: data.usageMetadata?.candidatesTokenCount, cost: 0 } };
    }
    throw new Error(last || "Gemini sin claves");
  }
  if (engine === "cloudflare") {
    const out: any = await env.AI.run(CF_MODEL as any, {
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      max_tokens: 4096, temperature: 0.6, response_format: { type: "json_object" },
    } as any);
    const r = out?.response;
    return { raw: typeof r === "string" ? r : JSON.stringify(r ?? {}), usage: { prompt_tokens: out?.usage?.prompt_tokens, completion_tokens: out?.usage?.completion_tokens, cost: 0 } };
  }
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: env.SITE_MODEL || env.OPENROUTER_MODEL, max_tokens: 32000, temperature: 0.6, usage: { include: true },
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter → ${res.status} ${(await res.text()).slice(0, 200)}`);
  const data: any = await res.json();
  const choice = data.choices?.[0];
  if (choice?.finish_reason === "length") throw new Error("La respuesta de la IA se cortó antes de terminar");
  return { raw: String(choice?.message?.content ?? ""), usage: data.usage ?? {} };
}

export async function writeTexts(env: Env, facts: Facts, items: Item[], template: string, terms: string[], audience: Audience, engine: Engine = "gemini"): Promise<{ texts: Texts; usage: Usage }> {
  // Cloudflare corta las peticiones largas (error 3046): la plantilla va en trozos pequeños, de 3 en 3 a la vez
  const size = engine === "cloudflare" ? (audience === "es" ? 25 : 45) : items.length;   // bilingüe = el doble de texto de salida
  const known = new Set(items.map((i) => i.id));
  const texts: Texts = {};
  let usage: Usage = {};
  const parts: Item[][] = [];
  for (let k = 0; k < items.length; k += size) parts.push(items.slice(k, k + size));
  // Si un trozo falla dos veces (respuesta cortada o JSON roto), se parte en dos y se reintenta cada mitad
  const one = async (part: Item[]): Promise<{ parsed: any; u: Usage }[]> => {
    for (let attempt = 1; ; attempt++) {
      try {
        const { raw, usage: u } = await ask(env, engine, audience === "en" ? SYSTEM_EN : SYSTEM_ES, buildPrompt(facts, part, template, terms, audience));
        const parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
        return [{ parsed, u }];
      } catch (e: any) {
        if (attempt < 2) continue;
        if (part.length > 6) {
          const half = Math.ceil(part.length / 2);
          return [...(await one(part.slice(0, half))), ...(await one(part.slice(half)))];
        }
        throw new Error(/JSON/.test(String(e)) ? "La IA no devolvió un JSON válido" : String(e?.message ?? e));
      }
    }
  };
  for (let k = 0; k < parts.length; k += 3) {
    for (const { parsed, u } of (await Promise.all(parts.slice(k, k + 3).map(one))).flat()) {
      usage = add(usage, u);
      for (const x of parsed.units ?? []) {
        if (!known.has(x?.id)) continue;
        const en = String(x.en ?? x.text ?? "");                  // los modelos chicos a veces devuelven "text" en vez de "en"
        texts[x.id] = { en, es: audience === "en" ? en : String(x.es ?? "") };
      }
    }
  }
  return { texts, usage };
}

const add = (a: Usage, b: Usage): Usage => ({ prompt_tokens: (a.prompt_tokens ?? 0) + (b.prompt_tokens ?? 0), completion_tokens: (a.completion_tokens ?? 0) + (b.completion_tokens ?? 0), cost: (a.cost ?? 0) + (b.cost ?? 0) });
const ENGLISH_ONLY_CSS = '<style>/* demo solo en inglés */.lang-switch,.lang[role="group"],[data-set-lang],[data-lang-btn],button[data-lang]{display:none!important}</style>';

/**
 * Red de seguridad para modelos chicos que a veces ponen un texto en el hueco equivocado:
 * - el logo con palabras del ejemplo lleva siempre la marca real;
 * - un texto corto que vuelve 1,8 veces más largo se descarta (se queda el original si no nombra al ejemplo).
 */
export function guard(items: Item[], texts: Texts, terms: string[], brand: string): Texts {
  const out: Texts = { ...texts };
  const sample = (t: string) => terms.some((w) => fold(t).includes(fold(w)));
  for (const i of items) {
    const orig = String(i.en ?? i.text ?? "");
    if (/logo/i.test(i.slot) && i.kind === "text" && sample(orig)) { out[i.id] = { en: brand, es: brand }; continue; }
    const t = out[i.id];
    if (!t || orig.length > 40) continue;
    if (t.en.length > orig.length * 1.8 + 6 && !sample(orig)) delete out[i.id];
  }
  return out;
}

function englishOnly(audience: Audience, items: Item[], texts: Texts): Texts {
  if (audience !== "en") return texts;
  const out = { ...texts };
  for (const i of items) if (i.en !== undefined && !out[i.id]) out[i.id] = { en: i.en, es: i.en };
  return out;
}

/** Hace la web de un negocio. Si quedan palabras del ejemplo, reescribe solo esas una vez; si siguen, falla (nunca se publica una web con otro negocio). */
export async function buildSite(env: Env, sites: Record<string, Compiled>, business: Business, audience: Audience, write = writeTexts, engine: Engine = "gemini"): Promise<{ html: string; template: string; usage: Usage }> {
  const template = chooseTemplate({ sector: business.sector, naics: business.naics, name: business.name });
  const c = sites[template];
  if (!c) throw new Error(`No existe la plantilla "${template}"`);
  const facts = businessFacts(business);
  const drop = ["reviews"];                                   // negocio nuevo: sin reseñas
  const items = writerItems(c, drop);
  const terms = sampleTerms(template, { name: facts.brand, city: facts.city, year: facts.registeredYear ?? "", audience });
  const renderFacts = { email: facts.email, phone: facts.phone, mapQuery: `${facts.city}, ${facts.state}` };
  const own = [facts.email, facts.phone];

  const first = await write(env, facts, items, template, terms, audience, engine);
  let texts = englishOnly(audience, items, guard(items, first.texts, terms, facts.brand));
  let usage = add({}, first.usage);
  let html = renderSite(c, { texts, drop, facts: renderFacts });
  let left = findLeftovers(html, terms, own);
  if (left.length) {
    const stillBad = items.map((i) => {
      const t = texts[i.id];
      return t ? { ...i, ...(i.en !== undefined ? { en: t.en || i.en, es: t.es || i.es } : { text: t.en || i.text }) } : i;
    }).filter((i) => findLeftovers(`${i.en ?? ""} ${i.es ?? ""} ${i.text ?? ""}`, left, own).length);
    if (stillBad.length) {
      const second = await write(env, facts, stillBad, template, left, audience, engine);
      texts = englishOnly(audience, items, { ...texts, ...guard(items, second.texts, terms, facts.brand) });
      usage = add(usage, second.usage);
      html = renderSite(c, { texts, drop, facts: renderFacts });
      left = findLeftovers(html, terms, own);
    }
  }
  if (left.length) throw new Error(`La web aún menciona el negocio de ejemplo (${left.join(", ")}): no se publica`);
  if (audience === "en") html = html.replace(/<\/head>/i, `${ENGLISH_ONLY_CSS}</head>`);
  return { html, template, usage };
}

/**
 * Quita lo que la plantilla trae de ejemplo y no se puede inventar: teléfono 555 (→ "La quiero"), número de licencia
 * de muestra, coordenadas del pueblo de ejemplo y el monograma de los dueños de ejemplo. Se hace al servir, así vale
 * también para las webs ya hechas.
 */
export function cleanSample(page: string, slug: string, brand: string, en: boolean): string {
  const ask = `/w/${slug}/quiero`;
  const label = en ? "Message us" : "Escríbenos";
  const initials = brand.split(/\s+/).filter((w) => /^\p{L}/u.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "★";
  return page
    .replace(/href="(?:tel|sms):[^"]*"/gi, `href="${ask}"`)
    .replace(/\+1[ .-]?\(?\d{3}\)?[ .-]?555[ .-]?01\d\d|\(?\b\d{3}\)?[ .-]?555[ .-]?01\d\d\b/g, label)
    .replace(/(?:HIC\.|#)0000000/g, "")
    .replace(/\d{1,3}\.\d{2,4}°\s?[NS][\s·,]*\d{1,3}\.\d{2,4}°\s?[EW](?:\s*[—–-]\s*)?/g, "")
    .replace(/>L&amp;A</g, `>${escText(initials)}<`);
}

