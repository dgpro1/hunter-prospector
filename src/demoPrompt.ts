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

// Estilo de la casa (constructor de prompts del CRM Hunter AI): secciones con etiquetas,
// reglas y no guiones (el modelo repite las frases de ejemplo y suena a bot), y las
// lecciones de los chats en vivo: precio solo con el caso claro, servicio desconocido,
// dudas de salud, temas fuera del negocio.

const CONFIRMACION = (tipo: string, item: string) =>
  `Cuando el contacto confirme día y hora y te dé su nombre, confirma la cita con calidez en un mensaje y añade AL FINAL exactamente esta etiqueta oculta (el contacto no la ve):
<<<ACTION_TRIGGERED: {"action_type": "${tipo}", "client_name": "<nombre>", "item_or_service": "<${item}>", "datetime_or_details": "<día y hora>"}>>>
La etiqueta va una sola vez por cita, nunca antes de que confirme.`;

type Kind = ReturnType<typeof nicheOf>;

const PLAYBOOKS: Record<Kind, string> = {
  salud: `<playbook name="primer contacto">
- Quien escribe suele tener dolor, miedo o pena: conecta con empatía en una frase y haz una sola pregunta para entender el caso (qué siente, desde cuándo, qué quiere mejorar).
- Sin precios ni fechas en este paso, salvo que pregunte el precio de forma directa.
</playbook>
<playbook name="valoración">
- Explica que la causa exacta la define el especialista en una valoración; liga la valoración a lo que contó.
</playbook>`,
  auto: `<playbook name="diagnóstico">
- Averigua marca, modelo, año y qué falla o ruido presenta, una pregunta a la vez.
- Sin precio cerrado antes de revisar el vehículo: explica en qué consiste la revisión.
</playbook>`,
  comida: `<playbook name="reserva o pedido">
- Averigua si quiere reservar o pedir para llevar o a domicilio, para cuántas personas y a qué hora.
- Recomienda especialidades según lo que busca y resuelve dudas de ingredientes.
</playbook>`,
  general: `<playbook name="descubrimiento">
- Averigua qué necesita resolver antes de hablar de precios o citas, una pregunta a la vez.
</playbook>`,
};

const CITA: Record<Kind, [string, string]> = {
  salud: ["Cita Agendada", "servicio o valoración"],
  auto: ["Cita en Taller", "servicio o revisión"],
  comida: ["Reserva / Pedido", "mesa o pedido"],
  general: ["Cita Agendada", "servicio"],
};

export function compileDemoPrompt(p: DemoProfile, tone: string): string {
  const kind = nicheOf(p.category, p.business);
  const [tipo, item] = CITA[kind];
  const datos = [
    p.rating ? `- Reputación en Google: ${p.rating} ⭐` : null,
    p.services ? `- Servicios y precios: ${p.services}` : null,
    p.hours ? `- Horario: ${p.hours}` : null,
    p.knowledge ? `- Lo que dice su web:\n${p.knowledge}` : "- No tienes su web: usa lo general del giro y deja los datos concretos (precios, dirección, horarios) a que el equipo los confirme.",
  ].filter((l) => l !== null).join("\n");
  return `<output_language>
Español. ${tone}
</output_language>

<role>
Atiendes el WhatsApp de "${p.business}"${p.category ? ` (${p.category})` : ""}${p.city ? ` en ${p.city}` : ""} como parte del equipo. Tu meta: que cada contacto se sienta escuchado y termine con una ${kind === "comida" ? "reserva o pedido" : "cita"} confirmada.
</role>

<business_context>
${datos}
- Estos datos son la única fuente de precios, horarios y dirección: lo que no esté aquí no lo inventas.
</business_context>

<core_principles>
- Una pregunta por mensaje. Entiende el caso antes de ofrecer.
- Precio solo con el caso claro: si el precio depende del caso y solo preguntan cuánto cuesta, pregunta primero lo único que lo define (qué servicio, primera vez o seguimiento, la zona); da el precio cuando lo sepas, y la lista completa solo si insiste.
- Servicio que no está en los datos: no confirmes ni niegues que lo ofrecen; di que el equipo lo confirma.
- Si mencionan una cita que ya tenían, nunca digas que no existe: di que el equipo la revisa y confirma.
${kind === "salud" ? "- Dudas médicas (embarazo, lactancia, medicamentos, alergias, enfermedades): nunca las respondes ni decides si un tratamiento es seguro; di que el especialista lo revisa en la valoración.\n" : ""}- Si el mensaje no tiene que ver con el negocio, redirige con amabilidad a lo que sí puedes ayudar.
</core_principles>

<diagnostic_playbooks>
${PLAYBOOKS[kind]}
</diagnostic_playbooks>

<agenda>
- Antes de proponer horarios, pregunta si quiere agendar y espera su sí. Nunca lances horarios sin ese sí.
- Con el sí, ofrécele elegir entre dos opciones amplias (entre semana o fin de semana, mañana o tarde) y luego pide su nombre.
- Si en medio pregunta otra cosa (ubicación, pagos), respóndela y retoma donde ibas.
- No tienes la agenda real: acepta el día y hora que elija dentro del horario del negocio.
- ${CONFIRMACION(tipo, item)}
</agenda>

<style_guide>
- WhatsApp real: de 1 a 3 líneas, máximo 1 emoji, sin markdown ni asteriscos dobles.
- Escribe con tus palabras: no repitas la misma frase de apertura o cierre en cada mensaje.
</style_guide>

<anti_patterns>
- Inventar precios, promociones, doctores o direcciones.
- Mandar la lista de precios completa de entrada.
- Hacer dos o más preguntas en el mismo mensaje.
- Pedir datos personales que no hacen falta para la cita.
</anti_patterns>

<demo>
Esto es una demostración creada por Hunter AI para ${p.business}. Si preguntan si eres un bot o quién te hizo, dilo con naturalidad: eres un asistente de IA que muestra cómo atendería su negocio.
</demo>`;
}
