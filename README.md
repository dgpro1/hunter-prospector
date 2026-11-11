# Hunter Prospector

Worker de Cloudflare que hace la prospección por WhatsApp de Hunter AI **sin tocar el código del CRM**.
Usa la API v1 del CRM (`app.hunterai.site`), su webhook `message.received` y la IA de Cloudflare / OpenRouter.

## v1 · Canal 2 (anuncio manual)

1. Ves un anuncio, das clic en su botón de WhatsApp desde un número QR conectado al cliente
   **agencia-hunterai** del CRM, borras el texto precargado y pegas tu apertura.
2. El CRM registra el chat. Cuando el negocio contesta, el CRM avisa al worker.
3. El worker:
   - comprueba que el chat lo empezaste tú (si no, lo ignora: es un chat normal);
   - deja el chat en modo humano para que el agente del CRM no responda;
   - calcula el **cronómetro** y su color (verde 0–15 min · amarillo 15–60 · naranja 1–6 h · rojo +6 h);
   - clasifica quién contestó (equipo o dueño) y si dijo que no le interesa (Workers AI);
   - elige la rama del árbol y **redacta la respuesta** (OpenRouter);
   - mueve la etapa en el CRM si `CRM_STAGES` está configurado;
   - si dijo que no, lo pasa a **No contactar**.
4. Tú abres `/panel`, revisas el borrador, lo editas si quieres y lo envías. Sale por el CRM.

## Puesta en marcha

```bash
npm install
npx wrangler d1 create hunter-prospector      # copia el database_id en wrangler.toml
npm run db:init                               # crea las tablas
npx wrangler secret put CRM_API_TOKEN         # token ol_… de una integración del CRM
npx wrangler secret put CRM_WEBHOOK_SECRET    # whsec_… de la suscripción del webhook
npx wrangler secret put OPENROUTER_API_KEY
npx wrangler secret put PANEL_PASSWORD
npm run deploy
```

En el CRM:
- **Integración** (Ajustes → Integraciones de API), limitada al cliente agencia-hunterai, con permisos de
  bandeja (leer, responder, gestionar) y pipeline. Su token va en `CRM_API_TOKEN`.
- **Webhook** de esa integración hacia `https://<tu-worker>/webhooks/crm` con el evento `message.received`.
  El secreto que devuelve va en `CRM_WEBHOOK_SECRET`.
- `CRM_CLIENT_ID` es opcional: si queda vacío, el worker aprende el UUID del primer webhook firmado. Si quieres, los ids de etapa en
  `CRM_STAGES` (`{"respondio":"…","perdido":"…"}`).

## v1 · Canal 1 (Prospector automático)

1. Sube la cacería del Cazador (`.json` o `.csv`) en `/panel/cola`. Se quitan repetidos y No contactar.
2. "Armar el día" toma los mejores según el cupo diario y les redacta la apertura (variante A pregunta-espejo / B demo directa).
3. Con el envío automático encendido, el cron (cada 10 min) manda UNO por vuelta por Evolution, lunes a sábado de 9 a 19 h en la hora del negocio, con 12–25 min entre mensajes. Si falla, se apaga solo.
4. Secretos extra: `EVOLUTION_URL`, `EVOLUTION_INSTANCE` (hunterai-<id del canal>) y `EVOLUTION_API_KEY` (token de esa instancia, no la clave global).

## Pruebas

```bash
npm test          # cronómetro, semáforo y detección de prospección
npm run typecheck
```
