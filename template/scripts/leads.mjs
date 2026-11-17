/**
 * List the latest contact-form leads stored in a site's D1 database (`forms.choice: "d1_leads"`).
 *
 *   npm run leads:staging                 # latest 20, personal data MASKED
 *   npm run leads:production -- 50        # latest 50 (max 200)
 *   npm run leads:staging -- --reveal     # unmasked: names, emails, phones, messages
 *   npm run leads:staging -- --status new # only rows with this status
 *
 * Read-only: one fixed SELECT run through `wrangler d1 execute --remote`; the limit is an integer and
 * the status is checked against [a-z_]+ before either reaches the query. Which database is read comes
 * from `forms.leadsDatabases.<env>` in aw-migration.json, in the account `targets.cloudflare.<env>`.
 *
 * ⚠ These rows are personal data. The default shows a masked view so the output is safe to read over a
 * shoulder, paste into a ticket while debugging, or leave in a terminal log; `--reveal` is for the person
 * who answers the enquiry, on a trusted machine, and says so on stderr.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { presentLead } from './lib/leads-mask.mjs';

const args = process.argv.slice(2);
const env = args[0];
const reveal = args.includes('--reveal');
const statusAt = args.indexOf('--status');
const status = statusAt >= 0 ? args[statusAt + 1] : undefined;
const limitArg = args.slice(1).find((a, i, all) => /^\d+$/.test(a) && all[i - 1] !== '--status');

const fail = (message) => { console.error(`✗ ${message}`); process.exit(1); };
if (!['staging', 'production'].includes(env)) fail('usage: node scripts/leads.mjs <staging|production> [limit] [--reveal] [--status <status>]');
if (status !== undefined && !/^[a-z_]{1,32}$/.test(status)) fail('--status must be lowercase letters and underscores, e.g. new');

let manifest;
try { manifest = JSON.parse(readFileSync('aw-migration.json', 'utf8')); } catch { fail('aw-migration.json is missing or not valid JSON.'); }
if (manifest.forms?.choice !== 'd1_leads') fail('forms.choice is not "d1_leads"; there is no D1 lead table to read.');
const db = manifest.forms?.leadsDatabases?.[env];
const accountId = manifest.targets?.cloudflare?.[env]?.accountId;
if (!db?.name || !accountId) fail(`aw-migration.json needs forms.leadsDatabases.${env}.name and targets.cloudflare.${env}.accountId.`);

const limit = Math.min(200, Math.max(1, Number.parseInt(limitArg ?? '20', 10) || 20));
const where = status ? `WHERE status = '${status}' ` : '';
const query = `SELECT id, created_at, status, name, email, phone, consent, source_url, message, user_agent FROM leads ${where}ORDER BY created_at DESC LIMIT ${limit}`;

if (reveal) console.error('! --reveal: personal data follows. Do not paste it anywhere public.');
const run = spawnSync('npx', ['--no-install', 'wrangler', 'd1', 'execute', db.name, '--remote', '--json', '--command', query], {
  env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: accountId, WRANGLER_SEND_METRICS: 'false' },
  encoding: 'utf8',
  shell: process.platform === 'win32',
});
if (run.status !== 0) {
  console.error(run.stderr || run.stdout);
  process.exit(run.status ?? 1);
}
const rows = JSON.parse(run.stdout)?.[0]?.results ?? [];
console.log(`${rows.length} lead(s) in ${db.name} (newest first${reveal ? '' : ', personal data masked; --reveal shows it'})\n`);
for (const stored of rows) {
  const r = presentLead(stored, { reveal });
  console.log(`${r.created_at}  [${r.status}]  ${r.name} <${r.email}>${r.phone ? `  ${r.phone}` : ''}  consent=${r.consent}`);
  console.log(`  ${r.source_url}  ·  ${r.id}`);
  console.log(`  ${reveal ? String(r.message).replace(/\s+/g, ' ') : r.message}`);
  if (r.user_agent) console.log(`  ${r.user_agent}`);
  console.log('');
}
