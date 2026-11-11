CREATE TABLE IF NOT EXISTS demos (
  slug TEXT PRIMARY KEY,                        -- /demo/<slug>
  lead TEXT NOT NULL,                           -- leads.phone
  business TEXT NOT NULL,
  city TEXT,
  category TEXT,
  knowledge TEXT,                               -- texto de su web
  services TEXT,                                -- lo que Daniel ajuste a mano
  hours TEXT,
  views INTEGER NOT NULL DEFAULT 0,
  messages INTEGER NOT NULL DEFAULT 0,
  last_view_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS demos_lead ON demos(lead);
CREATE TABLE IF NOT EXISTS demo_messages (slug TEXT NOT NULL, day TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS demo_messages_day ON demo_messages(slug, day);
