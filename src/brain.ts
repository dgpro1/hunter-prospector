// Clasificar (Workers AI, gratis) y redactar (OpenRouter).
import type { Env } from "./crm.ts";
import type { Color, Msg } from "./timer.ts";
import { humanDuration } from "./timer.ts";

export type Who = "equipo" | "dueno" | "desconocido";
export type Intent = "interesado" | "pregunta" | "no_interesa" | "otro";
export type Branch = "tarde" | "rapido" | "equipo" | "dueno" | "seguimiento" | "cierre";

export async function classify(env: Env, text: string): Promise<{ who: Who; intent: Intent }> {
  const prompt =
    "Clasifica la respuesta de un negocio a un mensaje de prospección por WhatsApp. " +
    'Responde SOLO JSON: {"who":"equipo|dueno|desconocido","intent":"interesado|pregunta|no_interesa|otro"}. ' +
    "who=dueno si dice ser el dueño, doctor, director o fundador; equipo si es recepción, asistente o secretaria. " +
    "intent=no_interesa si rechaza, pide no ser contactado o dice que no le interesa.";
  try {
    const out: any = await env.AI.run(env.CLASSIFY_MODEL as any, {
      messages: [{ role: "system", content: prompt }, { role: "user", content: text.slice(0, 1500) }],
    });
    const raw = String(out?.response ?? "");
    const json = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
    const who: Who = ["equipo", "dueno"].includes(json.who) ? json.who : "desconocido";
    const intent: Intent = ["interesado", "pregunta", "no_interesa"].includes(json.intent) ? json.intent : "otro";
    return { who, intent };
  } catch {
    return { who: "desconocido", intent: "otro" };
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
  cierre:
    "Dijo que no le interesa. Agradece en una o dos líneas, di que no volverás a escribir y desea éxito. Nada más.",
};

export async function draft(
  env: Env,
  opts: { branch: Branch; history: Msg[]; contactName: string | null; firstOut: string | null; minutes: number | null },
): Promise<string> {
  const system = [
    "Eres Daniel, de Hunter AI. Vendes asistentes de IA para WhatsApp que responden en segundos, agendan y hacen seguimiento, con un CRM detrás.",
    "Escribes por WhatsApp: tuteo (o usted si el otro lo usa), cercano, premium, frases cortas, máximo 1–2 emojis, sin listas ni markdown.",
    "Reglas: nunca des precios por chat (se dan en la llamada). Nunca inventes datos ni casos. No te hagas pasar por cliente. Una sola pregunta o acción por mensaje.",
    `Situación: ${BRANCH_GUIDE[opts.branch]}`,
    opts.firstOut && opts.minutes !== null
      ? `Dato: tu primer mensaje fue el ${new Date(opts.firstOut).toISOString()} (UTC) y tardaron ${humanDuration(opts.minutes)} en responder.`
      : "",
    "Devuelve solo el texto del mensaje, listo para enviar.",
  ].filter(Boolean).join("\n");
  const convo = opts.history
    .filter((m) => (m.kind ?? "message") === "message")
    .slice(-12)
    .map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.content }));
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: env.OPENROUTER_MODEL, max_tokens: 400, messages: [{ role: "system", content: system }, ...convo] }),
  });
  if (!res.ok) throw new Error(`OpenRouter → ${res.status}`);
  const data: any = await res.json();
  return String(data?.choices?.[0]?.message?.content ?? "").trim();
}
