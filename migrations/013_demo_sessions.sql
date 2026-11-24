-- Radar de la demo: una fila por visita (pestaña) para avisar a Daniel del recorrido del prospecto.
CREATE TABLE IF NOT EXISTS demo_sessions (
  id TEXT PRIMARY KEY,                -- id que genera la página
  slug TEXT NOT NULL,
  device TEXT,                        -- "PC" o "móvil"
  started_at TEXT NOT NULL,
  last_at TEXT NOT NULL,
  messages INTEGER NOT NULL DEFAULT 0,
  voice INTEGER NOT NULL DEFAULT 0,
  photos INTEGER NOT NULL DEFAULT 0,
  resets INTEGER NOT NULL DEFAULT 0,
  booked TEXT,                        -- resumen de la cita si agendó
  transcript TEXT,                    -- últimas líneas de la conversación (JSON)
  summary_sent INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS demo_sessions_slug ON demo_sessions (slug, started_at);
