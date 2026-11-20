/**
 * Contact-form leads stored in The-AW's SHARED lead database (`forms.choice: "d1_leads"`, binding
 * LEADS_DB): `websites-contact-crm-staging` for staging builds, `websites-contact-crm-production`
 * for production. Every site writes to the same `leads` table and stamps its own `site`
 * (LEADS_SITE, the production hostname). ⚠ Never create a database per site and never apply a
 * schema from a site: the schema, the inbox and the 180-day retention belong to
 * github.com/The-AW/websites-contact-crm (its docs/site-contract.md is the contract).
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

export interface LeadUtm {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  term: string | null;
  content: string | null;
}

export const NO_UTM: LeadUtm = { source: null, medium: null, campaign: null, term: null, content: null };

export interface LeadRecord {
  /** The production hostname of the site (LEADS_SITE). Set by the build, never from form input. */
  site: string;
  name: string;
  email: string;
  phone: string | null;
  message: string;
  sourceUrl: string;
  userAgent: string | null;
  /** The form page's utm_* parameters, NULL when absent. */
  utm: LeadUtm;
}

export type StoreResult = { ok: true; id: string } | { ok: false; reason: 'not_configured' | 'insert_failed'; detail: string };

export const INSERT_LEAD = `INSERT INTO leads
  (id, form_type, site, name, email, phone, message, consent, source_url,
   utm_source, utm_medium, utm_campaign, utm_term, utm_content, user_agent, status, created_at)
VALUES (?1, 'contact', ?2, ?3, ?4, ?5, ?6, 1, ?7, ?8, ?9, ?10, ?11, ?12, ?13, 'new', ?14)`;

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
  const site = lead.site?.trim().toLowerCase();
  if (!site) return { ok: false, reason: 'not_configured', detail: 'LEADS_SITE is missing' };
  const utm = lead.utm ?? NO_UTM;
  const userAgent = lead.userAgent ? lead.userAgent.slice(0, MAX_USER_AGENT) : null;
  try {
    await db
      .prepare(INSERT_LEAD)
      .bind(id, site, lead.name, lead.email, lead.phone, lead.message, lead.sourceUrl,
        utm.source, utm.medium, utm.campaign, utm.term, utm.content, userAgent, now.toISOString())
      .run();
    return { ok: true, id };
  } catch (error) {
    return { ok: false, reason: 'insert_failed', detail: error instanceof Error ? error.name : 'unknown error' };
  }
}
