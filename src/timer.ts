// Cronómetro y semáforo: cuánto tardó el negocio en contestar.

export type Color = "verde" | "amarillo" | "naranja" | "rojo" | "gris";

/** Minutos entre tu primer mensaje y su primera respuesta (null si no ha respondido). */
export function responseMinutes(firstOut: string | null, firstIn: string | null): number | null {
  if (!firstOut || !firstIn) return null;
  const diff = Date.parse(firstIn) - Date.parse(firstOut);
  if (!Number.isFinite(diff) || diff < 0) return null;
  return Math.round(diff / 60000);
}

/** Verde 0–15 min · Amarillo 15–60 · Naranja 1–6 h · Rojo +6 h · Gris sin respuesta. */
export function colorFor(minutes: number | null): Color {
  if (minutes === null) return "gris";
  if (minutes <= 15) return "verde";
  if (minutes <= 60) return "amarillo";
  if (minutes <= 360) return "naranja";
  return "rojo";
}

/** "19 h 18 min", "7 min", "2 días 3 h" */
export function humanDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return `${days} ${days === 1 ? "día" : "días"}${hours ? ` ${hours} h` : ""}`;
  return `${hours} h${mins ? ` ${mins} min` : ""}`;
}

export type Msg = { role: string; kind?: string; sender_type: string; created_at: string; content: string };

/**
 * ¿Este chat es de prospección? Sí cuando el primer mensaje real lo enviamos nosotros
 * (desde el teléfono o por API) antes de cualquier mensaje del negocio.
 */
export function prospectingStart(messages: Msg[]): { firstOut: string; firstIn: string | null } | null {
  const real = messages.filter((m) => (m.kind ?? "message") === "message");
  if (!real.length) return null;
  const first = real[0];
  const ours = first.role === "assistant" && first.sender_type !== "ai";
  if (!ours) return null;
  const firstIn = real.find((m) => m.role === "user")?.created_at ?? null;
  return { firstOut: first.created_at, firstIn };
}
