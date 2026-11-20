-- ⚠ TEST FIXTURE ONLY. A mirror of the shared lead schema owned by github.com/The-AW/websites-contact-crm
-- (migrations/0001_initial.sql + 0002_shared_sites.sql), so scripts/test-leads-schema.mjs can run the real
-- INSERT against it. Sites never apply a schema; never copy this into a migrations/ folder.

CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY NOT NULL,
  form_type TEXT NOT NULL CHECK (form_type IN ('contact', 'service')),
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  message TEXT,
  service TEXT,
  city TEXT,
  niche TEXT,
  neighborhood TEXT,
  consent INTEGER NOT NULL CHECK (consent IN (0, 1)),
  source_url TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_leads_created_at_id
  ON leads (created_at DESC, id DESC);

ALTER TABLE leads ADD COLUMN site TEXT;
ALTER TABLE leads ADD COLUMN utm_source TEXT;
ALTER TABLE leads ADD COLUMN utm_medium TEXT;
ALTER TABLE leads ADD COLUMN utm_campaign TEXT;
ALTER TABLE leads ADD COLUMN utm_term TEXT;
ALTER TABLE leads ADD COLUMN utm_content TEXT;
ALTER TABLE leads ADD COLUMN user_agent TEXT;
ALTER TABLE leads ADD COLUMN status TEXT NOT NULL DEFAULT 'new';

UPDATE leads
   SET site = lower(substr(source_url, 9, instr(substr(source_url, 9) || '/', '/') - 1))
 WHERE site IS NULL AND source_url LIKE 'https://%';
UPDATE leads SET site = substr(site, 5) WHERE site LIKE 'www.%';
UPDATE leads SET site = CASE site
    WHEN 'site.maeexperiente.com.br' THEN 'minhamaexperiente.com.br'
    WHEN 'site.belezaplastica.com.br' THEN 'belezaplastica.com.br'
    WHEN 'site.criancasnaplateia.com.br' THEN 'criancasnaplateia.com.br'
    ELSE site END;

CREATE INDEX IF NOT EXISTS idx_leads_site_created_at_id
  ON leads (site, created_at DESC, id DESC);
