# AW WordPress migration path

Use this path for the next AW migrations. Each site lives in its own repository; this kit contains no client URLs, content, assets, credentials, CRM data or analytics IDs. Keep file-based content, no CMS, and no Brevo integration.

## 1. Pin and scaffold this fork

Do not use `npm create website-build-kit@latest` or `npx degit` for an AW site: those fetch the upstream distribution, not this fork. Clone AW `master` at the reviewed kit commit; the clean checkout's current commit is stamped into the site `package.json`. The scaffolder copies only tracked template files, including `.gitignore`, scripts and `package-lock.json`.

```bash
git clone --branch master https://github.com/The-AW/website-build-kit.git "$HOME/coding/website-build-kit"
SITE_DIR="$HOME/coding/site-slug" # use a new, empty destination for this site's repository
node "$HOME/coding/website-build-kit/scripts/scaffold-aw.mjs" "$SITE_DIR"
cd "$SITE_DIR"
```

Fill in `aw-migration.json` before any deploy. It records the WordPress source URL; separate staging and production hosts; repository, per-environment Cloudflare account/zone/Worker targets; route and media inventory paths; redirect exceptions; `forms.choice`; acceptance criteria; and a rollback snapshot, preserved WordPress origin and restore steps. Do not copy client assets or secrets into the kit. Builds refuse placeholder hosts/Workers and missing source/repository fields; after intake is complete, set `template` to `false`. Deploys also require real account/zone IDs and route/media inventories; production additionally requires recorded acceptance and an existing rollback snapshot.

### Per-site operator setup and kickoff

Use a separate Work project/chat, local folder, The-AW repository and Manus project/task group for every website; give each site different staging and production Worker targets. Never share a client checkout. Pin the shared kit to the reviewed commit. Before long implementation, verify access to the exact GitHub repo and both Cloudflare connectors (record both connector IDs); confirm the injected BYOK token with `npx wrangler whoami` when available. Pass complete context to any delegate and never pass a token value. Keep one live writer per site. Manus does roughly 98% of implementation; Codex coordinates and reviews. Persist status, decisions, task links and release SHA in the site's checked-in status document and `AGENTS.md` where used. Every delegated task must return its Manus link to the owner; do not assume a new chat inherited prior context.

Reusable kickoff prompt:

> Implement the next AW migration. Source WordPress: `<URL>`; production host: `<domain>`; proposed staging host: `<domain>`; site repo/slug: `<owner/repo>`; required contact behavior: `<none or private_crm>`; cutover authority: `<who/what session authorizes it>`. Use kit commit `<reviewed SHA>`. Work only in this site's project, folder and repository. Before substantial work, verify repo access and both Cloudflare connector IDs/BYOK access; include those IDs, domain/repo/commit and dependencies in any delegation, but never share secrets. Keep one live writer, record decisions/status/task links/release SHA in this repo, and return each Manus task link to the owner. Do not publish, change DNS, or deploy beyond the stated cutover authority. If contact is `private_crm`, fill `forms.crmEndpoints` and `forms.turnstileSiteKeys` in `aw-migration.json` and follow the CRM setup checklist in §2 before testing the form. Read `AGENTS.md` for deploy commands and CRM setup details. Keep optional contact limitations explicit.

## 2. Inventory, migrate and build

```bash
npm run recon -- https://<wordpress-source>
npm run extract
npm run media
npm run build:staging
npm run check:sitemap
npm run deploy:staging:dry-run
npm run deploy:staging
npm run verify -- https://<staging-host>
```

Review the full route and media inventories before implementation. `inventories.media` defaults to `recon/media.csv` with columns `source_url,local_path,status,sha256,alt,usage` and a reviewed row for every source asset (or an explicit no-media row); `npm run media` separately writes the processed-image manifest. Keep `public/_redirects` empty until reviewed; every rule must match a `redirectExceptions` item with `source`, `destination`, `status` and `reason`. Preserve useful crawl, media, URL, redirect, accessibility and 404 checks. `aw-migration.json` is the host source of truth: build scripts refuse placeholders and conflicting `PUBLIC_SITE_URL` values. Generated `.aw/wrangler-staging.jsonc` and `.aw/wrangler-production.jsonc` use different Worker names and exact hostnames, set `workers_dev: false` and `preview_urls: false`, and retain only their intended custom-domain route. If contact is selected, the assets config routes only `/api/*` Worker-first and keeps `not_found_handling: "404-page"`. Immediately before invoking Wrangler, deploy validates the exact selected file again, including the generated `dist/server/wrangler.json` entrypoint and API routing. The checked-in `wrangler.jsonc` is neutral and must not be deployed directly.

The default is static Astro plus Cloudflare Workers Static Assets: no Astro Worker adapter, contact API, Turnstile key, KV binding or notification service. The build gate checks staging page-meta/header/robots noindex, absence of a staging sitemap, and environment-specific canonicals; production requires its own robots/sitemap host and a real 404. Optional modules do not block a static migration.

`forms.choice` defaults to `none`. `private_crm` enables Astro's supported server output, but all ordinary pages/endpoints must explicitly use `prerender = true`; only API routes use `prerender = false`. Workers Static Assets serves built pages first, runs `/api/*` through the Worker, and retains `404-page`. Build gates preserve staging noindex and host-specific robots, sitemap and canonicals. See [Astro on-demand rendering](https://docs.astro.build/en/guides/on-demand-rendering/) and [Cloudflare Worker-first asset routing](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/).

The agreed reusable contact endpoint is same-origin `POST /api/leads`, then server-side Turnstile Siteverify, then the site's adapter to AW's private CRM. The kit's generated-project test uses a synthetic local adapter only; it does not prove a hosted CRM, secret setup or live/browser contact flow. The retained `modules/contact/` files are still a KV-only draft, not the CRM integration. Do not enable that draft or claim contact end-to-end success; wait for site-specific adapter, privacy/retention, recovery, staging and real-browser evidence. No notification provider is mandatory.

### CRM and Turnstile setup checklist

All AW sites share one CRM Worker (The-AW/websites-contact-crm) backed by D1. Each site's Worker validates its own form, enforces Turnstile and rate limits, and forwards only its approved fields. The CRM authenticates each source with a shared secret and differentiates submissions by the `source` field.

When `forms.choice` is `private_crm`, complete this checklist per environment before the form will work:

1. **Create a Turnstile widget** in Cloudflare dashboard for this site's hostname (one per environment — staging and production use separate widgets)
2. **Record the public site key** in `aw-migration.json` → `forms.turnstileSiteKeys.<env>`
3. **Record the CRM endpoint** in `aw-migration.json` → `forms.crmEndpoints.<env>`
4. **Install three Worker secrets** on the site's Worker (`wrangler secret put`):
   - `TURNSTILE_SECRET_KEY` — from the Turnstile widget (different per environment)
   - `LEADS_INGESTION_SECRET` — must match the CRM Worker's `INGESTION_SECRET`
   - `LEADS_RATE_LIMIT_HMAC_SECRET` — any random 32+ character secret
5. **Verify CRM Worker has matching `INGESTION_SECRET`** — the site sends this header, the CRM validates it. Rotating it on one side without the other breaks all sites using that CRM environment.
6. **Build and deploy** — `npm run deploy:staging` or `npm run deploy:production -- --confirm-production`
7. **Test form submission end-to-end** — submit, verify delivery in CRM, delete the test record

The form renders disabled ("temporarily unavailable") when `PUBLIC_TURNSTILE_SITE_KEY` is empty at build time. This is the correct fail-closed behavior — the form cannot be submitted without a valid Turnstile challenge.

**Do not rotate the shared CRM ingestion secret** without updating every site Worker that uses it. A missed caller means silently lost lead submissions.

## 3. Production release and rollback

```bash
npm run build:production
npm run deploy:production:dry-run
npm run deploy:production -- --confirm-production
npm run verify -- https://<production-host>
```

Production build/deploy refuses example or staging hosts, reused Worker names, an incomplete migration manifest, missing acceptance criteria, or a missing rollback snapshot/WordPress origin. `--confirm-production` is an explicit command guard, not a request for repeated approval: honor the active session's already-granted scope and do not insert new approval gates for the same authorized release.

Minimal launch blockers are: the production build targets the production host and Worker; every inventoried source URL resolves or has a reviewed redirect/disposition; production robots/sitemap/canonicals and a real 404 are correct; staging stays noindex; acceptance and rollback records exist; and the old WordPress origin remains recoverable. If `forms.choice` is `none`, forms, CRM and optional analytics are not blockers. After-launch polish is tracked separately and must not be confused with a release blocker.

Before cutover, preserve a rollback snapshot and the WordPress origin. Do not retire Cloudways until a backup is verified and shared-server dependencies are checked; other sites may share that server. Keep the WordPress application/server until production smoke checks pass.

## 4. Deploy troubleshooting

`npm run deploy:staging` and `npm run deploy:production` handle the full build-and-deploy pipeline. Never split these steps or deploy pre-built artifacts from a different machine.

**Why the build and deploy must happen on the same machine:** The Astro Cloudflare adapter generates `dist/server/wrangler.json` with absolute local paths to the assets directory and Worker entry point. When `forms.choice` is `private_crm`, the deploy script selects this generated config. Copying `dist/` to another machine and deploying will fail because the paths do not exist there.

**Common deploy failures:**

| Symptom | Cause | Fix |
|---|---|---|
| "Wrangler identity check failed" | No `CLOUDFLARE_API_TOKEN` in environment | Set the token; run `npx wrangler whoami` to verify |
| "missing dist/server/wrangler.json" | Build failed, or `forms.choice` is `private_crm` but the Cloudflare adapter is not configured | Check build output for errors |
| Deploy succeeds, site shows 503 | Worker/custom domain exists but no code was deployed (e.g. placeholder from dashboard setup) | Run the full `npm run deploy:staging` — not just wrangler deploy |
| Deploy succeeds, site shows old content | Cloudflare edge cache | Wait 1-2 minutes or purge cache in dashboard |
| "staging resolves to the production Worker" | `aw-migration.json` has the same Worker name for both environments | Use distinct Worker names |

**For AI agents (Manus, Codex, etc.):** The deploy is a single command. Do not attempt to run `wrangler deploy` separately, do not deploy the root `wrangler.jsonc` (it is a neutral base config), and do not try to upload assets manually unless the standard deploy fails with `fetch failed` (see §4b below).

## 4b. Cloudflare auth and asset-upload fallback

The proven auth path is BYOK `CLOUDFLARE_API_TOKEN` in the environment (see §4 above for troubleshooting). Run `npx wrangler whoami` first. If it succeeds, missing Wrangler OAuth is not missing configured API access and `wrangler login` is unnecessary. Never print or pass the token as a command-line argument.

If Wrangler's bulk asset transfer fails with `fetch failed` before activation, first confirm the failure and target; do not report a successful deploy. Use Cloudflare's [official Workers Static Assets direct-upload API](https://developers.cloudflare.com/workers/static-assets/direct-upload/): `POST /accounts/{account}/workers/scripts/{worker}/assets-upload-session` with the full manifest; upload only requested missing hashes to `/accounts/{account}/workers/assets/upload?base64=true` in bounded multipart batches using the short-lived upload JWT; `POST /accounts/{account}/workers/scripts/{worker}/versions` with completion JWT and Worker module/metadata; verify the returned version; then `POST /accounts/{account}/workers/scripts/{worker}/deployments` for that exact version at 100% and read back the deployment. Keep the BYOK token in the environment and use `curl --config -` for transient JWTs so neither token appears in argv/logs. Attach a custom domain separately only for a first cutover. For later releases retain the existing domain/DNS and rollback version; do not detach or recreate DNS.

This flow is evidenced by Mae Experiente production: the injected BYOK token passed `wrangler whoami`, Wrangler's standard bulk transfer failed before activation, and the official API path completed version/deployment/domain readback. The one-off Mae helper was pinned to its PR and first-deploy-only; do not reuse it unchanged. See the [final cutover task aTJVRFYyXThd6nA8LNJLdL](https://manus.im/app/task/aTJVRFYyXThd6nA8LNJLdL) and [merged Mae PR #12](https://github.com/The-AW/mae-experiente/pull/12). That cutover had one release candidate and one live writer; unrelated sites stayed isolated. Parallel work is safe only for independent tasks supplied with the complete site, repository, domain, target-ID and decision context; review the final meaningful diff, not repeated approval rounds.

## 5. After launch

Check representative routes and media, production canonicals/indexability, production sitemap and robots, unknown-path 404 status, redirects and any enabled CRM path. Record results in the site repository. Keep after-launch copy, design and non-blocking integration polish separate from the minimum launch gate.
