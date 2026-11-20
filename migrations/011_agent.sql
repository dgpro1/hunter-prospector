-- Agente Cerrador: estado por conversación y lo que el agente envió (para notar cuando Daniel escribe).
CREATE TABLE IF NOT EXISTS agent_state (
  conversation_id TEXT PRIMARY KEY,
  lead TEXT,
  stage TEXT NOT NULL DEFAULT 'conversando',   -- conversando | demo_enviada | llamada_propuesta | agendada | traspaso | dormido | cerrado
  followups INTEGER NOT NULL DEFAULT 0,          -- seguimientos seguidos sin respuesta
  price_asks INTEGER NOT NULL DEFAULT 0,
  slots TEXT,                                    -- JSON: horarios ofrecidos (ISO)
  handoff_reason TEXT,
  last_in_at TEXT,
  last_out_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS agent_state_stage ON agent_state(stage, last_out_at);
CREATE TABLE IF NOT EXISTS agent_sent (
  conversation_id TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS agent_sent_conv ON agent_sent(conversation_id);
-- Borradores del agente: qué hace al enviarse y cuándo sale (status 'programado' en modo automático).
ALTER TABLE drafts ADD COLUMN action TEXT;
ALTER TABLE drafts ADD COLUMN payload TEXT;
ALTER TABLE drafts ADD COLUMN send_at TEXT;
