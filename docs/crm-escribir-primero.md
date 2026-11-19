# CRM Hunter AI · escribir primero

El Prospector no habla con Evolution. Todo sale por la API v1 del CRM (`dgpro1/hunterai`), que es quien
guarda las líneas QR y sus credenciales.

## Endpoints que usa

| Para qué | Ruta | Permiso |
|---|---|---|
| Ver tus líneas (con su número) | `GET /api/v1/clients/{client}/channels` | `channels.read` |
| Escribir primero a un número | `POST /api/v1/clients/{client}/conversations/start` | `inbox.reply` |
| Comprobar números (opcional) | `GET /api/v1/clients/{client}/channels/{channel}/whatsapp-numbers?phones=` | `channels.read` |
| Responder en un chat | `POST /api/v1/clients/{client}/conversations/{id}/reply` | `inbox.reply` |
| Pasar a humano | `PATCH /api/v1/clients/{client}/conversations/{id}/mode` | `inbox.manage` |

`conversations/start` recibe `{"phone", "content", "channel_id", "mode"}`. Comprueba que el número tenga
WhatsApp (si no, `422` con `code: "not_on_whatsapp"`), abre o continúa la conversación en esa línea, la deja en
modo humano y envía. Responde `201` con la conversación, `channel_id` y `line_number`. Acepta `Idempotency-Key`.

Errores que el worker entiende: `not_on_whatsapp` (salta el prospecto), `line_off` (línea desconectada),
`channel_required` (hay varias líneas y no se eligió), `404` (el CRM desplegado aún no tiene la ruta).

## Integración del CRM (cliente agencia-hunterai)

Permisos: `inbox.read`, `inbox.reply`, `inbox.manage`, `pipeline.manage`, `contacts.read`, `channels.read`.
