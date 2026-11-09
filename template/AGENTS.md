# Agent instructions

This file is for any AI agent working on this site — Claude, Codex, Manus, or any other. Read it before doing any work.

1. Read [CLAUDE.md](CLAUDE.md) for this site's existing conventions and release boundaries; it is the durable project context, not something to replace.
2. Use [docs/content-editing.md](docs/content-editing.md) and [docs/new-page-brief.md](docs/new-page-brief.md) for file-based edits and new routes. Confirm the actual source model before editing; the starter's blog/legal files are Markdown, but migrated sites may differ.
3. Edit source files under `src/` and original media under `media/source/`; never edit `dist/` or generated `public/img/` output. Preserve site-specific content, facts, design and configuration.
4. Run the documented checks and record results in the PR. Do not deploy from a content-editing change; use the site's authorized release owner after merge.

## Deploying

**`npm run deploy:staging` is the only deploy command.** It builds, generates configs, and deploys in one step. Never run wrangler deploy manually or deploy pre-built artifacts from another machine — the build generates config files with absolute local paths that only work on the machine that built them.

What the deploy script does, in order:
1. Checks Wrangler auth (`wrangler whoami`) — requires `CLOUDFLARE_API_TOKEN` in the environment
2. Runs the full staging build internally
3. Generates `.aw/wrangler-staging.jsonc` with correct local paths
4. If `forms.choice` is `private_crm`, selects `dist/server/wrangler.json` (Astro-generated with Worker entry point) as the deploy config
5. Validates the selected config matches `aw-migration.json`
6. Runs `wrangler deploy --config <selected-config>`

**Common failures:**
- "Wrangler identity check failed" → `CLOUDFLARE_API_TOKEN` is not set or is invalid. Run `npx wrangler whoami` to verify.
- "missing dist/server/wrangler.json" → the build step failed silently, or `forms.choice` is `private_crm` but the Astro Cloudflare adapter is not configured. Check the build output.
- Deploy succeeds but site shows 503 → the Worker was created (e.g. via Cloudflare dashboard) but nothing was deployed to it yet. Run the full `npm run deploy:staging`.

**Never do these:**
- Deploy `wrangler.jsonc` (the root neutral config) directly
- Run `wrangler deploy` without the build step — the generated configs will be stale or missing
- Copy `dist/` from one machine and deploy on another — absolute paths will be wrong
- Deploy to the production Worker name from a staging build

For production: `npm run deploy:production -- --confirm-production`

If Wrangler's bulk asset transfer fails with `fetch failed`, see the direct-upload API fallback in `docs/aw-migration-process.md` §4.

## CRM and contact form setup

When `forms.choice` is `private_crm` in `aw-migration.json`, the site needs these configured before the contact form works:

### Build-time (in `aw-migration.json`)
- `forms.turnstileSiteKeys.staging` — public Turnstile site key for staging
- `forms.turnstileSiteKeys.production` — public Turnstile site key for production (separate widget)
- `forms.crmEndpoints.staging` — staging CRM Worker URL (e.g. `https://crm-staging.example.workers.dev/api/leads`)
- `forms.crmEndpoints.production` — production CRM Worker URL

### Worker secrets (per environment, via `wrangler secret put`)
- `TURNSTILE_SECRET_KEY` — Turnstile secret key (different per environment)
- `LEADS_INGESTION_SECRET` — shared secret matching the CRM Worker's `INGESTION_SECRET`
- `LEADS_RATE_LIMIT_HMAC_SECRET` — any random secret for IP hashing

### Worker vars (set in generated wrangler config from `aw-migration.json`)
- `LEADS_ENABLED` — `"true"`
- `LEADS_INGESTION_URL` — CRM endpoint URL
- `LEADS_INGESTION_AUTH_HEADER` — `"X-AW-Ingestion-Secret"`
- `LEADS_ALLOWED_ORIGINS` — the site's public URL
- `TURNSTILE_ALLOWED_HOSTNAME` — the site's hostname (no protocol)

### CRM Worker side
The CRM Worker (`INGESTION_SECRET`) must match the site Worker's `LEADS_INGESTION_SECRET`. This is the same secret on both sides — the site Worker sends it, the CRM Worker validates it.

### Checklist
1. Create Turnstile widget in Cloudflare dashboard (one per environment)
2. Record public site key in `aw-migration.json`
3. Install 3 Worker secrets on the site's Worker
4. Ensure CRM Worker has matching `INGESTION_SECRET`
5. Build and deploy
6. Test form submission end-to-end
7. Verify submission landed in CRM
8. Delete test record

## Multi-agent coordination

Multiple agents (Claude, Codex, Manus) may work on different aspects of a migration simultaneously. To avoid conflicts:

- **One live writer per site** — only one agent should push to the repo at a time
- **Every delegated task must include**: repo URL, branch, Worker name, account ID, domain, and what NOT to touch
- **Never assume context carries over** between agents or between tasks — include all necessary details in every delegation
- **Record task links and status** in the site's tracking document
- **Do not rotate secrets** that other sites depend on without coordinating — the shared CRM ingestion secret is used by all AW sites
