import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { storeLead } from '../src/lib/lead-store.ts';

/**
 * D1 is SQLite. Apply the real migration to an in-memory SQLite and run the real storeLead against it,
 * through a D1-shaped adapter, so the schema and the INSERT cannot drift apart in silence: a renamed
 * column or a tightened CHECK would otherwise pass every mock and fail the first real lead.
 */
// The shared schema (websites-contact-crm migrations 0001 + 0002), mirrored as a fixture. Sites never apply it.
const migration = readFileSync(new URL('./fixtures/shared-leads-schema.sql', import.meta.url), 'utf8');

function d1(db) {
  return {
    prepare: (sql) => ({
      bind: (...values) => ({ async run() { return db.prepare(sql).run(...values); } }),
    }),
  };
}

const LEAD = { site: 'www.example.org', name: 'Test Person', email: 'test@example.invalid', phone: null, message: 'Synthetic.', sourceUrl: 'https://www.example.org/contact/', userAgent: null, utm: { source: 'google', medium: 'cpc', campaign: null, term: null, content: null } };

test('storeLead writes a row the shared schema accepts, with site, form_type and UTMs', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec(migration);
  const stored = await storeLead(d1(db), LEAD, new Date('2026-11-17T10:00:00.000Z'), 'id-1');
  assert.deepEqual(stored, { ok: true, id: 'id-1' });
  const row = db.prepare('SELECT * FROM leads').get();
  assert.equal(row.status, 'new');
  assert.equal(row.consent, 1);
  assert.equal(row.phone, null);
  assert.equal(row.created_at, '2026-11-17T10:00:00.000Z');
  assert.equal(row.site, 'www.example.org');
  assert.equal(row.form_type, 'contact');
  assert.equal(row.utm_source, 'google');
  assert.equal(row.utm_medium, 'cpc');
  assert.equal(row.utm_campaign, null);
});

test('a lead without a site is refused before the INSERT', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec(migration);
  const stored = await storeLead(d1(db), { ...LEAD, site: '' }, new Date(), 'id-2');
  assert.equal(stored.ok, false);
  assert.equal(stored.reason, 'not_configured');
  assert.equal(db.prepare('SELECT count(*) AS n FROM leads').get().n, 0);
});

test('the table rejects what the route would never send: a duplicate id, consent 0 or 2, a missing name', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec(migration);
  assert.equal((await storeLead(d1(db), LEAD, new Date(), 'dup')).ok, true);
  assert.equal((await storeLead(d1(db), LEAD, new Date(), 'dup')).ok, false, 'primary key');
  assert.throws(() => db.prepare("INSERT INTO leads (id, form_type, created_at, name, email, message, consent, source_url) VALUES ('c', 'contact', 't', 'n', 'e', 'm', 2, 's')").run(), /CHECK/);
  assert.throws(() => db.prepare("INSERT INTO leads (id, form_type, created_at, email, message, consent, source_url) VALUES ('d', 'contact', 't', 'e', 'm', 1, 's')").run(), /NOT NULL/);
});

test('the reader\'s SELECT runs against the real schema', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(migration);
  const query = "SELECT id, created_at, status, name, email, phone, consent, source_url, message, user_agent FROM leads WHERE site = 'www.example.org' AND status = 'new' ORDER BY created_at DESC LIMIT 20";
  assert.deepEqual(db.prepare(query).all(), []);
});
