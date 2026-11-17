-- Contact-form leads, stored in the site's own D1 database (forms.choice "d1_leads").
-- No CRM and no shared secret: each verified submission is one row with status 'new'.
-- A later email/Slack job (not part of the kit) picks rows up and moves them on, e.g. to 'sent'.
-- Apply with `npx wrangler d1 migrations apply <database> --remote` (see docs/aw-migration-process.md).
CREATE TABLE IF NOT EXISTS leads (
  id          TEXT PRIMARY KEY,                       -- crypto.randomUUID()
  created_at  TEXT NOT NULL,                          -- UTC ISO 8601, e.g. 2026-11-15T12:34:56.789Z
  name        TEXT NOT NULL,
  email       TEXT NOT NULL,
  phone       TEXT,                                   -- NULL when not given
  message     TEXT NOT NULL,
  consent     INTEGER NOT NULL CHECK (consent IN (0, 1)),
  source_url  TEXT NOT NULL,                          -- the form page, no query or fragment
  user_agent  TEXT,                                   -- diagnostic only, capped at 512 characters
  status      TEXT NOT NULL DEFAULT 'new'
);

CREATE INDEX IF NOT EXISTS leads_status_created_at ON leads (status, created_at);
