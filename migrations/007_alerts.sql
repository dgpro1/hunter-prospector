CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  lead TEXT NOT NULL,                           -- leads.phone
  kind TEXT NOT NULL,                           -- respondio | demo_abierta | demo_chat | cita
  text TEXT NOT NULL,
  seen INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS alerts_seen ON alerts(seen, created_at);
CREATE TABLE IF NOT EXISTS push_subs (endpoint TEXT PRIMARY KEY, created_at TEXT NOT NULL);
