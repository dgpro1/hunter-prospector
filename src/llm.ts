// Una sola puerta a los modelos de texto: prueba los modelos de OpenRouter en orden
// (LLM_MODELS, separados por comas; si no, OPENROUTER_MODEL) y, si todos fallan
// (sin saldo, tope de los :free, modelo caído), usa Workers AI. El último fallo queda
// en settings.llm_last_error porque el worker no guarda logs.
import type { Env } from "./crm.ts";

export type ChatMsg = { role: string; content: string };

async function logError(env: Env, err: string): Promise<void> {
  await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('llm_last_error', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(`${new Date().toISOString()} ${err}`.slice(0, 500)).run().catch(() => {});
}

export function modelsFor(env: Env, override?: string): string[] {
  return (override || env.LLM_MODELS || env.OPENROUTER_MODEL).split(",").map((m) => m.trim()).filter(Boolean);
}

export async function complete(env: Env, messages: ChatMsg[], maxTokens: number, opts: { models?: string } = {}): Promise<string> {
  for (const model of modelsFor(env, opts.models)) {
    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, max_tokens: maxTokens, messages }),
      });
      if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 300)}`);
      const out = String(((await res.json()) as any)?.choices?.[0]?.message?.content ?? "").trim();
      if (!out) throw new Error("respuesta vacía");
      return out;
    } catch (e) {
      await logError(env, `${model} → ${String((e as Error)?.message ?? e)}`);
    }
  }
  const out: any = await env.AI.run((env.DEMO_FALLBACK_MODEL || env.CLASSIFY_MODEL) as any, {
    messages: messages.filter((m) => m.content), max_tokens: maxTokens,
  });
  const text = String(out?.response ?? "").trim();
  if (!text) throw new Error("Workers AI: respuesta vacía");
  return text;
}
