// Clasificar (Workers AI, gratis) y redactar (OpenRouter).
import type { Env } from "./crm.ts";
import type { Color, Msg } from "./timer.ts";
import { humanDuration } from "./timer.ts";

/** Tono de todos los mensajes: español neutro con "tú". Nada de voseo ni modismos argentinos. */
export const TONE =
  "Idioma: español latino neutro, como habla un profesional de Colombia o México. Usa SIEMPRE \"tú\" (o \"usted\" si el otro lo usa). " +
  "PROHIBIDO el voseo y el tono argentino o rioplatense: nada de \"vos\", \"tenés\", \"querés\", \"podés\", \"che\", \"dale\", \"genial, bárbaro\", \"laburo\", \"re\" ni imperativos como \"mirá\" o \"contame\" (di \"mira\", \"cuéntame\"). " +
  "Tampoco uses modismos muy locales de ningún país.";

/** Matiz por país del número, sin perder el español neutro. */
export function toneFor(phone?: string | null): string {
  const p = String(phone ?? "");
  if (p.startsWith("34")) return TONE + " El negocio está en España: tutea con naturalidad, sin modismos latinos (nada de \"ahorita\" ni \"platicar\").";
  if (p.startsWith("52")) return TONE + " El negocio está en México: cálido y respetuoso.";
  return TONE;
}

export type Who = "equipo" | "dueno" | "desconocido";
export type Intent = "interesado" | "pregunta" | "no_interesa" | "otro";
export type Branch = "tarde" | "rapido" | "equipo" | "dueno" | "seguimiento" | "cierre" | "automatico";

/** ¿Es un mensaje automático (bienvenida, ausencia o respuesta rápida de WhatsApp Business)? Señales sin IA. */
const AUTO_PATTERNS = [
  /gracias por (comunicarte|comunicarse|escribirnos|contactarnos|tu mensaje|su mensaje)/i,
  /(en breve|a la brevedad|lo antes posible|pronto) (te|le|nos)? ?(responderemos|atenderemos|contactaremos|pondremos en contacto)/i,
  /(nuestro|el) horario (de atenci[oó]n)? es/i,
  /(fuera|fuera del) horario/i,
  /mensaje autom[aá]tico/i,
  /bienvenid[oa] a /i,
  /¿?en qu[eé] (te|le) podemos ayudar\??/i,
  /¿?c[oó]mo (te|le) podemos ayudar\??/i,
];
export function looksAutomatic(text: string, secondsAfterOurs: number | null): boolean {
  const hit = AUTO_PATTERNS.some((r) => r.test(text));
  // Una respuesta a los pocos segundos de nuestro mensaje casi nunca la escribe una persona.
  if (secondsAfterOurs !== null && secondsAfterOurs < 10) return true;
  return hit && (secondsAfterOurs === null || secondsAfterOurs < 180);
}

/** Compatibilidad: solo quién y qué (para el simulador). */
export async function classify(env: Env, text: string): Promise<{ who: Who; intent: Intent }> {
  const a = await analyze(env, [], text, null);
  return { who: a.who, intent: a.intent };
}

export type Analysis = { auto: boolean; who: Who; intent: Intent; summary: string };

/**
 * Lee la conversación completa (Workers AI) y dice si el último mensaje del negocio es automático
 * o de una persona, quién contestó y qué quiere. Las señales sin IA mandan cuando son claras.
 */
export async function analyze(env: Env, history: Msg[], latest: string, secondsAfterOurs: number | null): Promise<Analysis> {
  const hinted = looksAutomatic(latest, secondsAfterOurs);
  const convo = history
    .filter((m) => (m.kind ?? "message") === "message")
    .slice(-14)
    .map((m) => `${m.role === "user" ? "NEGOCIO" : "DANIEL"} (${m.created_at}): ${String(m.content ?? "").slice(0, 600)}`)
    .join("\n");
  const prompt =
    "Analizas una conversación de WhatsApp en la que Daniel (Hunter AI) le escribió primero a un negocio para ofrecerle un asistente de IA. " +
    "Mira el ÚLTIMO mensaje del NEGOCIO dentro del contexto completo. Responde SOLO JSON: " +
    '{"auto":true|false,"who":"equipo|dueno|desconocido","intent":"interesado|pregunta|no_interesa|otro","summary":"una frase"}. ' +
    "auto=true si es un mensaje automático de WhatsApp Business (bienvenida, ausencia, fuera de horario, respuesta rápida genérica que no responde a lo que dijo Daniel). " +
    "auto=false si una persona responde de verdad a lo que se le escribió. " +
    "who=dueno si dice ser el dueño, doctor, director o fundador; equipo si es recepción, asistente o secretaria. " +
    "intent=no_interesa si rechaza o pide no ser contactado; interesado si quiere ver la demo o saber más; pregunta si pregunta algo concreto. " +
    "summary: qué dijo el negocio, en español, en una frase." +
    (hinted ? " Pista: llegó a los pocos segundos o tiene forma de mensaje automático." : "");
  try {
    const out: any = await env.AI.run(env.CLASSIFY_MODEL as any, {
      messages: [{ role: "system", content: prompt }, { role: "user", content: `${convo}\n\nÚLTIMO MENSAJE DEL NEGOCIO: ${latest.slice(0, 1500)}` }],
      max_tokens: 200,
    });
    const raw = typeof out?.response === "string" ? out.response : JSON.stringify(out?.response ?? "");
    const json = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
    const who: Who = ["equipo", "dueno"].includes(json.who) ? json.who : "desconocido";
    const intent: Intent = ["interesado", "pregunta", "no_interesa"].includes(json.intent) ? json.intent : "otro";
    // Un rechazo explícito pesa más que la forma; la velocidad sobrehumana pesa más que la IA.
    const auto = intent === "no_interesa" ? false : (secondsAfterOurs !== null && secondsAfterOurs < 10) || Boolean(json.auto) || hinted;
    return { auto, who: auto ? "desconocido" : who, intent: auto ? "otro" : intent, summary: String(json.summary ?? "").slice(0, 200) };
  } catch {
    return { auto: hinted, who: "desconocido", intent: "otro", summary: "" };
  }
}

/** Elige la rama del árbol de respuestas. */
export function pickBranch(opts: { isFirstReply: boolean; color: Color; who: Who; intent: Intent }): Branch {
  if (opts.intent === "no_interesa") return "cierre";
  if (!opts.isFirstReply) return "seguimiento";
  if (opts.who === "dueno") return "dueno";
  if (opts.who === "equipo") return "equipo";
  return opts.color === "verde" ? "rapido" : "tarde";
}

const BRANCH_GUIDE: Record<Branch, string> = {
  tarde:
    "Tardaron en responder. Agradece, menciona con tacto (sin regañar) a qué hora escribiste y cuánto tardaron, y explica que eso mismo vive quien escribe desde su anuncio. Ofrece una demo gratis con su negocio en 24 h.",
  rapido:
    "Respondieron rápido. Felicita de verdad y pregunta qué pasa de noche, en fin de semana y con quien pregunta y no agenda. Ofrece una demo gratis que cubre eso.",
  equipo:
    "Contestó alguien del equipo. Gánatelo: el asistente le quita preguntas repetidas, no el puesto. Pide el nombre y mejor momento para hablar con quien decide, y ofrece preparar la demo para que se la reenvíe.",
  dueno:
    "Contestó quien decide. Mensaje corto, respeto por su tiempo: ofrece la demo con su negocio y pide solo 2–3 servicios con precio y su horario.",
  seguimiento:
    "La conversación sigue. Responde a lo que dijo y llévala al siguiente paso: aceptar la demo, pasar los datos que faltan o agendar una llamada de 15 minutos con dos horarios concretos.",
  automatico:
    "Lo último que llegó es un mensaje AUTOMÁTICO de WhatsApp Business (bienvenida o ausencia): todavía no ha leído nadie. No agradezcas que respondieron rápido ni lo trates como respuesta de una persona. Si el automático pregunta en qué pueden ayudar, contéstalo en una o dos frases: di el motivo concreto de tu mensaje y pide hablar con quien maneja la agenda o decide. Corto, para que lo lea la persona que abra el chat.",
  cierre:
    "Dijo que no le interesa. Agradece en una o dos líneas, di que no volverás a escribir y desea éxito. Nada más.",
};

export async function draft(
  env: Env,
  opts: { branch: Branch; history: Msg[]; contactName: string | null; firstOut: string | null; minutes: number | null; phone?: string | null; autoTimes?: string[]; summary?: string },
): Promise<string> {
  const system = [
    "Eres Daniel, de Hunter AI. Vendes asistentes de IA para WhatsApp que responden en segundos, agendan y hacen seguimiento, con un CRM detrás.",
    "Escribes por WhatsApp: cercano, premium, frases cortas, máximo 1–2 emojis, sin listas ni markdown.",
    toneFor(opts.phone),
    "Reglas: nunca des precios por chat (se dan en la llamada). Nunca inventes datos ni casos. No te hagas pasar por cliente. Una sola pregunta o acción por mensaje.",
    `Situación: ${BRANCH_GUIDE[opts.branch]}`,
    opts.firstOut && opts.minutes !== null
      ? `Dato: tu primer mensaje fue el ${new Date(opts.firstOut).toISOString()} (UTC) y tardaron ${humanDuration(opts.minutes)} en responder.`
      : "",
    opts.summary ? `Lo último que dijo el negocio: ${opts.summary}` : "",
    "Lee la conversación completa antes de escribir: responde a lo que realmente se dijo y no repitas lo que Daniel ya contó en mensajes anteriores. Los mensajes marcados [AUTOMÁTICO] no los escribió una persona.",
    "Devuelve solo el texto del mensaje, listo para enviar.",
  ].filter(Boolean).join("\n");
  const convo = opts.history
    .filter((m) => (m.kind ?? "message") === "message")
    .slice(-12)
    .map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: (opts.autoTimes ?? []).includes(m.created_at) ? `[AUTOMÁTICO] ${m.content}` : m.content }));
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: env.OPENROUTER_MODEL, max_tokens: 400, messages: [{ role: "system", content: system }, ...convo] }),
  });
  if (!res.ok) throw new Error(`OpenRouter → ${res.status}`);
  const data: any = await res.json();
  return String(data?.choices?.[0]?.message?.content ?? "").trim();
}
