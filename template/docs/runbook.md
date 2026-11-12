# AW migration runbook

This runbook is for the static-first AW WordPress path. `aw-migration.json` is the site-specific source of truth; keep each site's routes, assets, credentials and acceptance evidence in that site's repository. No CMS, Brevo, KV archive or notification service is part of the default.

## 1. Intake and source capture

Use Node 22.12+ and install from the committed lockfile. Before building routes, fill `aw-migration.json` with the source URL; separate staging/production hosts; repository and per-environment Cloudflare account/zone/Worker targets; route/media inventories; redirect exceptions; forms choice; acceptance; rollback snapshot; WordPress origin and restore steps.

```bash
npm ci
npm run recon -- https://<wordpress-source>
npm run extract
npm run media
```

Review the complete route and media inventories. `recon/media.csv` is the source inventory and must contain `source_url,local_path,status,sha256,alt,usage` plus at least one reviewed asset row (or an explicit no-media row). `npm run media` separately generates `src/data/image-manifest.json` for the site pipeline. Preserve each source path or record its redirect/disposition. Keep `public/_redirects` empty until rules are reviewed; every shipped rule must match a `redirectExceptions` item with `source,destination,status,reason`. Do not change DNS or mail records outside the authorized cutover scope.

## 2. Static staging

The starter builds static Astro output plus Cloudflare Workers Static Assets. It has no runtime adapter, contact API, Turnstile key, KV namespace or API secret by default. Generated `.aw/wrangler-staging.jsonc` and `.aw/wrangler-production.jsonc` use distinct Worker names and manifest hosts; `wrangler.jsonc` is neutral and not a deploy target.

```bash
npx wrangler whoami
npm run build:staging
npm run deploy:staging:dry-run
npm run deploy:staging
npm run verify -- https://<staging-host>
npm run a11y
npm run reflow
```

A configured `CLOUDFLARE_API_TOKEN` provided through BYOK is valid auth when `wrangler whoami` succeeds. Missing Wrangler OAuth by itself does not mean API access is missing; do not run `wrangler login` when the configured token works. The build refuses host overrides/placeholders and staging/production target reuse. Its environment-aware search gate verifies staging page meta, response header and robots disallow-all, rejects any staging sitemap, and checks every canonical host; production requires a host-matched sitemap index and robots directive.

## 3. Production release gate

**Minimum blockers:** every inventoried old URL resolves or has a reviewed redirect/disposition; the production build targets the verified production host and separate Worker; production canonicals, robots and sitemap are correct; unknown paths return a real 404; staging stays noindex; acceptance criteria are recorded; a rollback snapshot exists and restores to the preserved WordPress origin.

`forms.choice: "none"` needs no form, CRM, Turnstile or notification transport. If `private_crm` is selected, the adapter uses Astro server output while ordinary pages/endpoints explicitly prerender and only API routes remain on-demand; Workers Static Assets runs `/api/*` Worker-first and preserves the real static 404. The agreed endpoint is same-origin `POST /api/leads` + Turnstile Siteverify + that site's adapter to AW's existing private CRM. Build gates retain sitemap, robots, canonical and noindex checks.

The code under `modules/contact/` remains a KV-only draft, not the existing-private-CRM integration, and is not proven end-to-end. A synthetic local adapter test verifies the hybrid route mechanics only; it does not prove hosted CRM delivery or real-browser form success. Before claiming contact completion, test the implemented adapter, privacy/retention, limits, failures and recovery with approved staging evidence. No email/Slack/Brevo provider is mandatory.

```bash
npm run build:production
npm run deploy:production:dry-run
npm run deploy:production -- --confirm-production
npm run verify -- https://<production-host>
```

The production deploy flag is an explicit technical guard. Honor authorization already granted for this session's scope; do not insert repeated approval requests, and do not extend the scope implicitly. Use one release candidate and one live writer per site.

## 4. If Wrangler bulk asset upload fails

If Wrangler reports `fetch failed` before activation, confirm that the failure happened before any version/deployment became live and verify the target. Keep the BYOK token in the environment; never pass or print it in argv/logs. Use Cloudflare's [official Workers Static Assets direct-upload API](https://developers.cloudflare.com/workers/static-assets/direct-upload/): `POST /accounts/{account}/workers/scripts/{worker}/assets-upload-session` with the full path/hash/size manifest; upload only requested missing hashes to `/accounts/{account}/workers/assets/upload?base64=true` in bounded multipart batches using the short-lived upload JWT; then `POST /accounts/{account}/workers/scripts/{worker}/versions` with the completion JWT and Worker module/metadata. Verify the returned version ID, then `POST /accounts/{account}/workers/scripts/{worker}/deployments` for that exact version at 100% and read back the deployment.

Attach a custom domain separately only on first cutover. For later releases, retain the existing domain/DNS and rollback version; do not detach or recreate DNS. The Mae first-deploy helper was pinned to its own PR and must not be reused unchanged for subsequent releases. See the task and PR links in the kit's `docs/aw-migration-process.md`.

## 5. Rollback and Cloudways

Before production, save the release/deployment rollback snapshot in the path recorded by the manifest and confirm its restore steps reach the WordPress origin. Keep the WordPress origin available through the recovery window. If verification fails after cutover, restore the prior Worker version/domain routing or route traffic back to the preserved WordPress origin according to the recorded steps; verify critical routes and keep one live writer.

Do not retire Cloudways as part of the cutover. Before any later retirement, verify a backup and check whether other sites or services share the server. Update the manifest only after those checks are complete.

## 6. First-week watch

| When | Check |
| --- | --- |
| Day 1 | Production home, representative route families, top legacy URLs, redirects and actual 404 status |
| Day 1–3 | Search Console sitemap/canonical/indexing and Cloudflare Worker errors |
| Week 1 | 404 logs, selected analytics, and only the CRM path explicitly enabled for this site |
| Recovery window | Keep WordPress origin and rollback snapshot available |

Track visual/copy polish and non-essential integrations separately from the minimum launch gate.

## 7. Contact form — where submissions go

> **Reference implementation:** `https://belezaplastica.com.br/contato/`
> Copy the form structure (fields, Turnstile placement, consent checkbox) from that site
> when setting up a new migration. It is the first fully verified AW affiliate form.

### Request path (browser → database)

```
User fills form on /contato/  (or /contact/ on sites that use the AW private-CRM page)
  │
  ▼
POST /api/leads  (same-origin, Astro on-demand route)
  │  validates name/email/phone/message/consent
  │  verifies Cloudflare Turnstile token (server-side Siteverify API)
  │  rate-limits 10 req/min per IP via Cloudflare rate-limit binding
  │
  ▼
websites-contact-crm Worker  (The-AW/websites-contact-crm)
  URL: https://websites-contact-crm.theamazingworks.workers.dev  (staging)
       same Worker, shared secret differentiates site scope           (production)
  │  validates X-AW-Ingestion-Secret (constant-time, per-environment)
  │  validates payload shape (contact profile: name/email/phone/message/sourceUrl/consent)
  │
  ▼
Cloudflare D1 — table: leads
  Staging DB:    websites-contact-crm-staging    (id: 61bc71ad-4909-4478-866e-cd538231cd3b… see aw-migration.json)
  Production DB: websites-contact-crm-production (id: e31827c7-4909-4478-866e-cd538231cd3b)
  Columns: id · name · email · phone · message · source_url · consent · created_at
```

### Reading submitted leads

```bash
# From the websites-contact-crm repo root:
npx wrangler d1 execute websites-contact-crm-production --remote \
  --command "SELECT id, name, email, phone, message, source_url, created_at FROM leads ORDER BY created_at DESC LIMIT 20"

# Staging:
npx wrangler d1 execute websites-contact-crm-staging --remote \
  --command "SELECT id, name, email, phone, message, source_url, created_at FROM leads ORDER BY created_at DESC LIMIT 20"
```

The `source_url` column identifies which site sent the lead. All AW migrations write to the
same two databases; the site is distinguished by `source_url`, not by a separate table or DB.

### Deleting a test record

After verifying any synthetic submission, delete it immediately:

```bash
npx wrangler d1 execute websites-contact-crm-production --remote \
  --command "DELETE FROM leads WHERE id = '<uuid>'"
```

Record the deletion in `aw-migration.json` under `forms.productionAcceptance.testRecordDeleted: true`.

### How the form is enabled per site

| State | What it means |
| --- | --- |
| `forms.choice: "none"` | No form; static site only |
| `forms.choice: "private_crm"` + no `productionEnabled` | Form active on staging; **disabled in production build** |
| `forms.choice: "private_crm"` + `productionEnabled: true` + `productionAcceptance` filled | Form live in production |

The build will refuse `productionEnabled: true` without a complete `productionAcceptance` block
(staging submission verified, test record deleted, `acceptedOn` date, `acceptedBy` email).

### Worker secrets required per site

Each migrated site's production Worker needs three secrets set via `wrangler secret put`:

| Secret | What it is |
| --- | --- |
| `TURNSTILE_SECRET_KEY` | The secret key for **this site's** production Turnstile widget (from dash.cloudflare.com → Turnstile) |
| `LEADS_INGESTION_SECRET` | The shared production ingestion secret for `websites-contact-crm` (ask the AW team — do not rotate without updating all sites) |
| `LEADS_RATE_LIMIT_HMAC_SECRET` | Per-site HMAC secret for the rate-limit binding |

Staging uses separate versions of all three. Never copy a production secret to a staging Worker.
