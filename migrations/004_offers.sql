CREATE TABLE IF NOT EXISTS offers (
  niche_key TEXT PRIMARY KEY,                   -- nicho sin tildes y en minúsculas
  niche TEXT NOT NULL,                          -- como se dice en la frase: "clínicas dentales"
  result TEXT NOT NULL,                         -- "tener un 30% más de citas"
  timeframe TEXT NOT NULL,                      -- "60 días"
  pain TEXT NOT NULL,                           -- "contratar a otra recepcionista"
  question_a TEXT,                              -- cierre de la variante A (pregunta)
  cta_b TEXT,                                   -- cierre de la variante B (demo); {negocio} se reemplaza
  status TEXT NOT NULL DEFAULT 'aprobada',      -- aprobada | sugerida
  updated_at TEXT NOT NULL
);
INSERT OR IGNORE INTO offers (niche_key, niche, result, timeframe, pain, status, updated_at)
VALUES ('clinicas dentales', 'clínicas dentales', 'tener un 30% más de citas', '60 días', 'contratar a otra recepcionista', 'aprobada', datetime('now'));
