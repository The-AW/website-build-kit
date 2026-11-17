/**
 * Contact-form leads stored in this site's own Cloudflare D1 database
 * (`forms.choice: "d1_leads"`, binding LEADS_DB, schema in migrations/0001_create_leads.sql).
 *
 * No CRM and no shared ingestion secret: each verified submission becomes one row with
 * status 'new'. Read them with `npm run leads:staging` / `npm run leads:production`, which
 * mask personal data unless asked not to. Email or Slack delivery from the table is a later,
 * separate step.
 */

/** The slice of the D1 binding this module uses, so tests can pass a stand-in. */
export interface LeadDatabase {
  prepare(query: string): { bind(...values: unknown[]): { run(): Promise<unknown> } };
}

export interface LeadRecord {
  name: string;
  email: string;
  phone: string | null;
  message: string;
  sourceUrl: string;
  userAgent: string | null;
}

export type StoreResult = { ok: true; id: string } | { ok: false; reason: 'not_configured' | 'insert_failed'; detail: string };

export const INSERT_LEAD = `INSERT INTO leads (id, created_at, name, email, phone, message, consent, source_url, user_agent, status)
VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, ?8, 'new')`;

/** Longest user agent kept; it is diagnostic only. */
const MAX_USER_AGENT = 512;

/**
 * Insert one lead. Consent is always 1: the route refuses a submission without it before this
 * is reached. Never throws; a failure carries only a fixed description, never the submission.
 */
export async function storeLead(
  db: LeadDatabase | undefined,
  lead: LeadRecord,
  now: Date = new Date(),
  id: string = crypto.randomUUID(),
): Promise<StoreResult> {
  if (!db || typeof db.prepare !== 'function') {
    return { ok: false, reason: 'not_configured', detail: 'LEADS_DB binding is missing' };
  }
  const userAgent = lead.userAgent ? lead.userAgent.slice(0, MAX_USER_AGENT) : null;
  try {
    await db
      .prepare(INSERT_LEAD)
      .bind(id, now.toISOString(), lead.name, lead.email, lead.phone, lead.message, lead.sourceUrl, userAgent)
      .run();
    return { ok: true, id };
  } catch (error) {
    return { ok: false, reason: 'insert_failed', detail: error instanceof Error ? error.name : 'unknown error' };
  }
}
