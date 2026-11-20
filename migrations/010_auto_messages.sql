-- Mensajes del negocio que fueron automáticos (bienvenida/ausencia de WhatsApp Business).
CREATE TABLE IF NOT EXISTS auto_messages (
  conversation_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  content TEXT,
  PRIMARY KEY (conversation_id, created_at)
);
