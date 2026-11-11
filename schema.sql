-- Prospector · base de datos D1
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  received_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS prospects (
  conversation_id TEXT PRIMARY KEY,
  number INTEGER,
  contact_id TEXT,
  contact_name TEXT,
  origin TEXT NOT NULL DEFAULT 'anuncio',      -- anuncio | prospector
  first_out_at TEXT,                            -- tu primer mensaje
  first_in_at TEXT,                             -- su primera respuesta
  response_minutes INTEGER,
  color TEXT,                                   -- verde | amarillo | naranja | rojo | gris
  who_replied TEXT,                             -- equipo | dueno | desconocido
  branch TEXT,                                  -- tarde | rapido | equipo | dueno | seguimiento | cierre
  status TEXT NOT NULL DEFAULT 'activo',        -- activo | no_contactar | ganado | perdido
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS drafts (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  branch TEXT,
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendiente',     -- pendiente | enviado | descartado
  created_at TEXT NOT NULL,
  sent_at TEXT
);
CREATE INDEX IF NOT EXISTS drafts_status ON drafts(status, created_at);

CREATE TABLE IF NOT EXISTS do_not_contact (
  key TEXT PRIMARY KEY,                         -- contact_id del CRM o teléfono
  reason TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,                         -- crm_client_id: lo aprende del primer webhook
  value TEXT NOT NULL
);

-- Canal 1 · Prospector: leads del Cazador en cola, con cupo diario
CREATE TABLE IF NOT EXISTS leads (
  phone TEXT PRIMARY KEY,                       -- solo dígitos con código de país (wa.me)
  name TEXT NOT NULL,
  niche TEXT,
  city TEXT,
  web TEXT,
  category TEXT,
  rating REAL,
  confidence TEXT,                              -- alta | media | baja (del Cazador)
  maps_url TEXT,
  batch TEXT,                                   -- archivo de la cacería
  status TEXT NOT NULL DEFAULT 'cola',          -- cola | hoy | enviado | descartado
  variant TEXT,                                 -- A pregunta-espejo | B demo directa
  opener TEXT,
  day TEXT,                                     -- día (YYYY-MM-DD) en que entró al cupo
  created_at TEXT NOT NULL,
  sent_at TEXT
);
CREATE INDEX IF NOT EXISTS leads_status ON leads(status, day);
