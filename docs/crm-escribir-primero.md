# CRM Hunter AI · escribir primero (cambio propuesto)

El Prospector ya no habla con Evolution. Todo sale por la API v1 del CRM. Para el Canal 1 (escribir primero a un
número nuevo) al CRM le falta **un endpoint**; lo demás ya existe.

## Qué ya hay en la API v1 (revisado en `apps/api/app/routers/api_v1.py`)

| Necesidad | Estado |
|---|---|
| Responder en un chat que ya existe | ✅ `POST /clients/{client}/conversations/{id}/reply` |
| Pasar el chat a humano | ✅ `PATCH /clients/{client}/conversations/{id}/mode` |
| Listar las líneas (QR y API) | ✅ `GET /clients/{client}/channels` (sin el número de teléfono) |
| **Iniciar un chat con un número nuevo** | ❌ no existe |
| **Comprobar si un número tiene WhatsApp** | ❌ no existe |

`POST /pipeline/leads` crea contacto y caso, pero sin canal y sin enviar nada. El `POST /api/conversations` interno
solo crea conversaciones de prueba (sin canal).

## Cambio 1 · `POST /api/v1/clients/{client_id}/conversations/start`

Permiso: `inbox.reply`. Acepta `Idempotency-Key` (mismo `use_key` / `complete` / `abandon` que `v1_reply`).

```json
{ "channel_id": "uuid de la línea QR", "phone": "523312345678", "content": "Hola, ¿hablo con …?" }
```

Pasos:
1. `_agency_client`; la línea debe ser un `WhatsAppChannel` de ese cliente, `connected` y `is_enabled`
   (si no: `409 {"detail":{"code":"line_off"}}`).
2. `normalize_phone(phone)` y comprobar con Evolution `POST /chat/whatsappNumbers/{instance_name(channel)}`
   `{"numbers":[phone]}`. Si `exists` es falso: `422 {"detail":{"code":"not_on_whatsapp","message":"…"}}`.
   Usar el `jid` que devuelve como `external_chat_id`.
3. Buscar la conversación abierta de esa línea y ese `jid` (misma consulta que `record_outgoing` en
   `services/phone_handover.py`); si no hay, crearla igual que allí (`resolve_contact`, `channel="whatsapp"`,
   `route_new_conversation_by_tags`).
4. `set_mode(db, conversation, "human", actor=user.name)` para que el agente no conteste a la apertura.
5. `evolution_driver.send_text(channel, jid, content)` y guardar el `Message` con su `external_message_id`
   (así el eco `fromMe` no se duplica: `record_outgoing` ya lo descarta por id).
6. Responder `201` con `_conversation_out(...)` más `"line_number": channel.phone_number`.

## Cambio 2 (pequeño) · número en `GET /channels`

En `_channel_row` añadir `"phone_number": getattr(row, "phone_number", None)`. El Prospector lo usa para decir
por qué línea salió cada chat. Sin esto funciona igual, solo muestra el nombre de la línea.

## Opcional · `POST /api/v1/clients/{client_id}/channels/{channel_id}/check-numbers`

Permiso `channels.read`. `{"phones":["…"]}` → `{"data":[{"phone":"…","exists":true,"jid":"…"}]}`. Sirve para
limpiar la cola antes de armar el día; el Prospector no lo necesita porque el Cambio 1 ya comprueba.

## Integración del CRM (cliente agencia-hunterai)

Permisos: `inbox.read`, `inbox.reply`, `inbox.manage`, `pipeline.manage`, `contacts.read`, `channels.read`.
Ninguna credencial de Evolution sale del CRM.
