-- El Prospector como CRM: cada lead es una ficha con etapa, valor, próxima acción e historial.
ALTER TABLE leads ADD COLUMN stage TEXT NOT NULL DEFAULT 'nuevo';   -- nuevo | contactado | respondio | demo | llamada | propuesta | ganado | perdido
ALTER TABLE leads ADD COLUMN origin TEXT NOT NULL DEFAULT 'cazador'; -- cazador | anuncio | manual
ALTER TABLE leads ADD COLUMN conversation_id TEXT;
ALTER TABLE leads ADD COLUMN contact_id TEXT;
ALTER TABLE leads ADD COLUMN value REAL;
ALTER TABLE leads ADD COLUMN next_at TEXT;
ALTER TABLE leads ADD COLUMN next_text TEXT;
ALTER TABLE leads ADD COLUMN color TEXT;
ALTER TABLE leads ADD COLUMN response_minutes INTEGER;
ALTER TABLE leads ADD COLUMN who_replied TEXT;
ALTER TABLE leads ADD COLUMN replied_at TEXT;
ALTER TABLE leads ADD COLUMN updated_at TEXT;
CREATE INDEX IF NOT EXISTS leads_stage ON leads(stage);
CREATE INDEX IF NOT EXISTS leads_conversation ON leads(conversation_id);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  lead TEXT NOT NULL,                           -- leads.phone
  kind TEXT NOT NULL DEFAULT 'nota',            -- nota | sistema
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS notes_lead ON notes(lead, created_at);

UPDATE leads SET stage = 'contactado' WHERE status = 'enviado' AND stage = 'nuevo';
UPDATE leads SET updated_at = COALESCE(sent_at, created_at) WHERE updated_at IS NULL;
