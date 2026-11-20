import test from 'node:test';
import assert from 'node:assert/strict';
import { validateLeadSubmission } from '../src/lib/lead-submission.ts';
import { rateLimitKey } from '../src/lib/rate-limit.ts';
import { INSERT_LEAD, storeLead } from '../src/lib/lead-store.ts';
import { maskEmail, maskMessage, maskName, maskPhone, presentLead } from './lib/leads-mask.mjs';

const VALID_INPUT = {
  name: 'Test Person',
  email: 'test@example.invalid',
  phone: '+1 (555) 010-0199',
  message: 'A synthetic test message; not a real enquiry.',
  turnstileToken: 'synthetic-turnstile-token',
  consent: true,
};

/** A stand-in for the D1 binding: records the statement and bound values. */
function mockDatabase({ fail = false } = {}) {
  const calls = [];
  return {
    calls,
    prepare(query) {
      return {
        bind(...values) {
          return {
            async run() {
              calls.push({ query, values });
              if (fail) throw new TypeError('D1_ERROR: synthetic failure');
              return { success: true };
            },
          };
        },
      };
    },
  };
}

const LEAD = {
  site: 'www.example.org',
  name: 'Test Person',
  email: 'test@example.invalid',
  phone: '15550100199',
  message: 'A synthetic test message; not a real enquiry.',
  sourceUrl: 'https://www.example.org/contact/',
  userAgent: 'TestAgent/1.0',
  utm: { source: 'google', medium: 'cpc', campaign: 'synthetic', term: null, content: null },
};

test('validates and normalizes the submission fields', () => {
  const result = validateLeadSubmission({ ...VALID_INPUT, name: '  Test Person  ' });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.name, 'Test Person');
  assert.equal(result.value.phone, '+1 (555) 010-0199');
  assert.equal(result.value.consent, true);
  assert.equal(result.value.turnstileToken, 'synthetic-turnstile-token');
});

test('the phone is optional: absent, null and blank all become null', () => {
  for (const phone of ['  ', '', null, undefined]) {
    const result = validateLeadSubmission({ ...VALID_INPUT, phone });
    assert.equal(result.ok, true, `phone ${JSON.stringify(phone)}`);
    if (result.ok) assert.equal(result.value.phone, null);
  }
});

test('rejects invalid fields, missing consent, a number as text and extra properties', () => {
  for (const [input, field] of [
    [{ ...VALID_INPUT, email: 'invalid' }, 'email'],
    [{ ...VALID_INPUT, name: 'A' }, 'name'],
    [{ ...VALID_INPUT, name: 'x'.repeat(121) }, 'name'],
    [{ ...VALID_INPUT, phone: 'phone' }, 'phone'],
    [{ ...VALID_INPUT, phone: '123' }, 'phone'],
    [{ ...VALID_INPUT, phone: 5551234567 }, 'phone'],
    [{ ...VALID_INPUT, message: '   ' }, 'message'],
    [{ ...VALID_INPUT, message: 'x'.repeat(5001) }, 'message'],
    [{ ...VALID_INPUT, consent: false }, 'consent'],
    [{ ...VALID_INPUT, consent: 'true' }, 'consent'],
    [{ ...VALID_INPUT, name: { toString: () => 'Test' } }, 'name'],
    [{ ...VALID_INPUT, ip: '203.0.113.1' }, 'message'],
    [{ ...VALID_INPUT, source: 'other.example' }, 'message'],
    [null, 'message'],
    [[], 'message'],
  ]) {
    const result = validateLeadSubmission(input);
    assert.equal(result.ok, false, JSON.stringify(input));
    if (!result.ok) assert.ok(result.errors[field], `${field} for ${JSON.stringify(input)}`);
  }
});

test('creates a stable pseudonymous rate-limit key without exposing the source IP', async () => {
  const first = await rateLimitKey('203.0.113.10', 'a'.repeat(64));
  const same = await rateLimitKey('203.0.113.10', 'a'.repeat(64));
  const rotated = await rateLimitKey('203.0.113.10', 'b'.repeat(64));
  assert.equal(first, same);
  assert.notEqual(first, rotated);
  assert.match(first, /^contact:[0-9a-f]{64}$/);
  assert.equal(first.includes('203.0.113.10'), false);
  await assert.rejects(rateLimitKey('203.0.113.10', 'short'), /rate_limit_configuration_invalid/);
});

test('stores a verified lead as one parameterised D1 insert with status new', async () => {
  const db = mockDatabase();
  const now = new Date('2026-11-15T12:00:00.000Z');
  const result = await storeLead(db, LEAD, now, '00000000-0000-4000-8000-000000000001');

  assert.deepEqual(result, { ok: true, id: '00000000-0000-4000-8000-000000000001' });
  assert.equal(db.calls.length, 1);
  const { query, values } = db.calls[0];
  assert.equal(query, INSERT_LEAD);
  assert.match(query, /VALUES \(\?1, 'contact', \?2, \?3, \?4, \?5, \?6, 1, \?7, \?8, \?9, \?10, \?11, \?12, \?13, 'new', \?14\)/);
  assert.deepEqual(values, [
    '00000000-0000-4000-8000-000000000001',
    'www.example.org',
    LEAD.name, LEAD.email, LEAD.phone, LEAD.message, LEAD.sourceUrl,
    'google', 'cpc', 'synthetic', null, null,
    LEAD.userAgent,
    '2026-11-15T12:00:00.000Z',
  ]);
  assert.ok(!query.includes(LEAD.email), 'values are bound, never interpolated into SQL');
});

test('stores a missing phone and user agent as NULL and caps a long user agent', async () => {
  const db = mockDatabase();
  await storeLead(db, { ...LEAD, phone: null, userAgent: null });
  assert.equal(db.calls[0].values[4], null);
  assert.equal(db.calls[0].values[12], null);
  const long = mockDatabase();
  await storeLead(long, { ...LEAD, userAgent: 'x'.repeat(2000) });
  assert.equal(long.calls[0].values[12].length, 512);
});

test('refuses to store without a site (LEADS_SITE), and lowercases it', async () => {
  const db = mockDatabase();
  assert.deepEqual(await storeLead(db, { ...LEAD, site: '' }), { ok: false, reason: 'not_configured', detail: 'LEADS_SITE is missing' });
  assert.equal(db.calls.length, 0);
  await storeLead(db, { ...LEAD, site: 'WWW.Example.org' });
  assert.equal(db.calls[0].values[1], 'www.example.org');
});

test('UTMs from the form are kept when sane and dropped (never refused) when not', () => {
  const base = { name: 'Test Person', email: 'test@example.invalid', phone: '15550100199', message: 'Synthetic.', turnstileToken: 't', consent: true };
  const ok = validateLeadSubmission({ ...base, utm: { source: ' google ', medium: 'cpc', campaign: 'x'.repeat(201), term: 5, other: 'ignored' } });
  assert.equal(ok.ok, true);
  if (ok.ok) assert.deepEqual(ok.value.utm, { source: 'google', medium: 'cpc', campaign: null, term: null, content: null });
  for (const utm of [undefined, null, 'utm_source=x', ['x']]) {
    const r = validateLeadSubmission({ ...base, utm });
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.value.utm, { source: null, medium: null, campaign: null, term: null, content: null });
  }
});

test('fails closed without a binding and reports an insert failure without the submission', async () => {
  assert.deepEqual(await storeLead(undefined, LEAD), { ok: false, reason: 'not_configured', detail: 'LEADS_DB binding is missing' });
  const result = await storeLead(mockDatabase({ fail: true }), LEAD);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'insert_failed');
  assert.equal(result.detail, 'TypeError');
  assert.ok(!JSON.stringify(result).includes(LEAD.email), 'a failure never carries the submission');
});

// ── The reader masks personal data by default ──────────────────────────────────

test('masks name, email, phone and message; keeps enough to recognise a row', () => {
  assert.equal(maskName('Maria da Silva'), 'M*** d*** S***');
  assert.equal(maskName('X'), '*');
  assert.equal(maskEmail('maria.silva@gmail.com'), 'm***@g***.com');
  assert.equal(maskEmail('a@b.co.uk'), '*@b***.uk');
  assert.equal(maskEmail('not-an-email'), 'n***');
  assert.equal(maskPhone('+55 (11) 99999-1234'), '***34');
  assert.equal(maskPhone(''), '');
  assert.equal(maskMessage('hello'), '[5 characters]');
});

test('the default view carries no personal data from the row; --reveal is the row as stored', () => {
  const row = {
    id: 'id-1', created_at: '2026-11-15T12:00:00.000Z', status: 'new', name: 'Maria Silva', email: 'maria@example.org',
    phone: '+55 11 99999-1234', consent: 1, source_url: 'https://www.example.org/contact/', message: 'Please call me about the kitchen.',
    user_agent: 'Mozilla/5.0 (X11)',
  };
  const masked = JSON.stringify(presentLead(row));
  for (const secret of ['Maria', 'Silva', 'maria@', 'example.org/contact/'.slice(0, 0) + '99999', 'kitchen', 'Mozilla']) {
    assert.equal(masked.includes(secret), false, `masked view leaked ${secret}`);
  }
  assert.match(masked, /id-1/);
  assert.match(masked, /2026-11-15/);
  assert.deepEqual(presentLead(row, { reveal: true }), row);
});
