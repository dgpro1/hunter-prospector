-- Canal 3 · Webs demo: altas nuevas del registro de Connecticut → web hecha para su negocio → (más adelante) correo.
CREATE TABLE IF NOT EXISTS webdemos (
  slug TEXT PRIMARY KEY,                        -- /w/<slug>
  ct_id TEXT UNIQUE,                            -- accountnumber del registro
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  city TEXT,
  zip TEXT,
  state TEXT NOT NULL DEFAULT 'CT',
  registered TEXT,                              -- fecha de alta (YYYY-MM-DD)
  naics TEXT,
  sector TEXT,
  latino INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  audience TEXT NOT NULL DEFAULT 'en',          -- es (web bilingüe) | en (solo inglés)
  template TEXT,
  status TEXT NOT NULL DEFAULT 'nueva',         -- nueva | en_cola | generando | lista | error | descartada
  error TEXT,
  html TEXT,
  cost REAL,
  views INTEGER NOT NULL DEFAULT 0,
  last_view_at TEXT,
  lead TEXT,                                    -- leads.phone cuando pide su web
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  generated_at TEXT
);
CREATE INDEX IF NOT EXISTS webdemos_status ON webdemos(status, registered);
