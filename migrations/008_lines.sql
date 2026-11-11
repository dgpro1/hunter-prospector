ALTER TABLE leads ADD COLUMN line TEXT;          -- número propio (línea de WhatsApp) por el que se habló
CREATE TABLE IF NOT EXISTS lines (number TEXT PRIMARY KEY, label TEXT NOT NULL, created_at TEXT NOT NULL);
