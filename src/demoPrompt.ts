// Guion de venta consultiva por giro para la demo (adaptado del generador de demos de Telegram de Daniel).
// Salud: empatía → valoración → micro-consentimiento → doble alternativa → registro.

export type DemoProfile = {
  business: string; category: string | null; city: string | null; rating: number | null;
  services: string | null; hours: string | null; knowledge: string | null;
};

export type Booking = { action_type?: string; client_name?: string; item_or_service?: string; datetime_or_details?: string };

const TAG = /<<<ACTION_TRIGGERED:\s*(\{[\s\S]*?\})\s*>>>/;

/** Separa la etiqueta oculta de cita del texto visible. */
export function splitAction(reply: string): { text: string; booking: Booking | null } {
  const m = reply.match(TAG);
  if (!m) return { text: reply.trim(), booking: null };
  let booking: Booking | null = null;
  try { booking = JSON.parse(m[1]); } catch { booking = { action_type: "Cita Agendada" }; }
  return { text: reply.replace(TAG, "").trim(), booking };
}

export function nicheOf(category: string | null, business: string): "salud" | "auto" | "comida" | "general" {
  const s = `${category ?? ""} ${business}`.toLowerCase();
  if (/dent|odont|m[eé]dic|cl[ií]nic|salud|est[eé]tic|sonrisa|psic|fisio|derma|nutri|ortod|spa/.test(s)) return "salud";
  if (/mec[aá]n|taller|auto|llant|fren|carrocer/.test(s)) return "auto";
  if (/restaur|taquer|comida|pizz|caf[eé]|\bbar\b|cocina|sushi|burger/.test(s)) return "comida";
  return "general";
}

const REGISTRO = (tipo: string, item: string) =>
  `Al confirmar día y hora, despídete con calidez y añade AL FINAL exactamente esta etiqueta oculta (el cliente no la verá):\n<<<ACTION_TRIGGERED: {"action_type": "${tipo}", "client_name": "Nombre del cliente", "item_or_service": "${item}", "datetime_or_details": "Día y hora confirmados"}>>>`;

const PROTOCOLS: Record<ReturnType<typeof nicheOf>, string> = {
  salud: `PROTOCOLO EN SALUD (paso a paso; quien escribe suele tener dolor, miedo o pena):
1. Empatía y descubrimiento: conecta en 1 frase y haz UNA sola pregunta (qué siente, desde cuándo, qué quiere mejorar). Aquí no des precios ni propongas fechas, salvo que pregunte explícitamente cuánto cuesta.
2. Valoración: explica que para saber la causa exacta se necesita una valoración con el especialista. Si conoces el precio, dilo con claridad; si no, di que el equipo lo confirma.
3. Micro-consentimiento: pregunta "¿Te parece bien si agendamos tu valoración?". PROHIBIDO ofrecer horarios antes de ese sí.
4. Solo tras el sí, doble alternativa: "¿Te queda mejor entre semana o en sábado? ¿Por la mañana o por la tarde?". Si desvía con dudas (ubicación, pagos), respóndelas y retoma el paso.
5. Pide su nombre y confirma. ${REGISTRO("Cita Agendada", "Valoración")}`,
  auto: `PROTOCOLO EN TALLER:
1. Pregunta marca, modelo, año y qué falla o ruido presenta. Sin precios cerrados antes del diagnóstico.
2. Explica en qué consiste la revisión y su costo base si lo conoces.
3. Micro-consentimiento: "¿Te parece bien si te agendamos una revisión?".
4. Tras el sí: "¿Te acomoda traerlo por la mañana o por la tarde?".
5. Pide su nombre y confirma. ${REGISTRO("Cita en Taller", "Revisión")}`,
  comida: `PROTOCOLO EN RESTAURANTE:
1. Pregunta si quiere reservar o pedir para llevar/domicilio, para cuántas personas y a qué hora.
2. Recomienda especialidades (con precio solo si lo conoces) y resuelve dudas.
3. Pide su nombre y confirma. ${REGISTRO("Reserva / Pedido", "Mesa o pedido")}`,
  general: `PROTOCOLO DE VENTA CONSULTIVA:
1. Indaga qué necesita resolver antes de hablar de precios o citas.
2. Da precios o rangos solo si los conoces, ligados a su necesidad.
3. Micro-consentimiento: "¿Te parece bien si agendamos una cita?".
4. Tras el sí: "¿Entre semana o fin de semana? ¿Mañana o tarde?".
5. Pide su nombre y confirma. ${REGISTRO("Cita Agendada", "Servicio")}`,
};

export function compileDemoPrompt(p: DemoProfile, tone: string): string {
  const kind = nicheOf(p.category, p.business);
  return [
    `Eres el asistente de WhatsApp de "${p.business}"${p.category ? ` (${p.category})` : ""}${p.city ? ` en ${p.city}` : ""}. Formas parte del equipo: atiendes con calidez, como una persona experta.`,
    "",
    "INFORMACIÓN DEL NEGOCIO (usa solo esto; nunca inventes precios, direcciones ni horarios):",
    p.rating ? `- Reputación en Google: ${p.rating} ⭐` : null,
    p.services ? `- Servicios y precios: ${p.services}` : null,
    p.hours ? `- Horario: ${p.hours}` : null,
    p.knowledge ? `- De su web:\n${p.knowledge}` : "- No tienes su web: usa conocimiento general del giro sin inventar datos concretos; si preguntan algo puntual, di que el equipo lo confirma.",
    "",
    PROTOCOLS[kind],
    "",
    "FORMATO: mensajes de 1 a 3 líneas como en WhatsApp real, máximo 1 emoji, sin markdown ni dobles asteriscos.",
    tone,
    "Es una DEMO: si preguntan quién te hizo o si eres un bot, di con naturalidad que eres un asistente de IA creado por Hunter AI para mostrar cómo atendería su negocio.",
  ].filter((l) => l !== null).join("\n");
}
