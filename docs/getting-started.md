# Getting started

Install the kit, or scaffold a new site from the reviewed AW fork commit. For the reusable migration sequence and the Mae evidence, see [aw-migration-process.md](aw-migration-process.md); for launch acceptance, see [aw-migration-checklist.md](aw-migration-checklist.md).

## Install the kit for Claude Code

```bash
git clone https://github.com/The-AW/website-build-kit.git ~/coding/website-build-kit
cd ~/coding/website-build-kit
./install.sh              # symlinks — updates when you pull
./install.sh --copy       # copies instead, if you prefer snapshots
```

Verify: open any project in Claude Code and type `/` — `website-build` should be listed. `install.sh` is for the Claude skill; it is not the client-site scaffolder.

## Scaffold an AW migration from this fork

Do not use `npm create website-build-kit@latest` or `npx degit` for AW work: those fetch upstream, not the AW fork. After PR2 merges, reuse the clean kit clone from the install section, fast-forward it to AW `master`, then run the local scaffolder. It stamps that checkout's exact commit into the site package:

```bash
git -C "$HOME/coding/website-build-kit" checkout master
git -C "$HOME/coding/website-build-kit" pull --ff-only origin master
SITE_DIR="$HOME/coding/site-slug" # use a new, empty destination for this site's repository
node "$HOME/coding/website-build-kit/scripts/scaffold-aw.mjs" "$SITE_DIR"
cd "$SITE_DIR"
```

It copies only tracked template files, including `.gitignore`, scripts and `package-lock.json`, then records the kit commit in the site's `package.json`. It refuses a dirty template, a non-empty destination, or missing scaffold essentials. Keep each site in its own repository; do not copy client assets, URLs, credentials or secrets into the kit.

Fill `aw-migration.json` before deploy: source URL, distinct production/staging hosts, repository and per-environment Cloudflare account/zone/Worker IDs, route/media inventory paths, redirect exceptions, forms choice, acceptance criteria and rollback snapshot/WordPress origin/restore steps. Builds refuse example hosts/Workers and missing source/repository fields; set `template` to `false` after the real site intake is complete.

## Build and deploy

```bash
npm run recon -- https://<wordpress-source>
npm run extract
npm run media
npm run build:staging
npm run deploy:staging:dry-run
npm run deploy:staging
npm run verify -- https://<staging-host>
npm run build:production
npm run deploy:production:dry-run
npm run deploy:production -- --confirm-production
npm run verify -- https://<production-host>
```

The default output is static Astro plus Cloudflare Workers Static Assets. `.aw/wrangler-staging.jsonc` and `.aw/wrangler-production.jsonc` are generated from the manifest and target different Workers; the checked-in `wrangler.jsonc` is neutral and must not be deployed directly. Staging is noindex with no production sitemap; production canonicals, robots and sitemap use its verified hostname. Unknown paths return a real 404. Build/deploy refuses placeholders, host overrides and environment/Worker mix-ups.

Static migrations need no Worker runtime, form endpoint, Turnstile key, KV binding or notification provider. `forms.choice: "none"` is valid at launch. If a site selects `private_crm`, implement a same-origin API + Turnstile Siteverify + adapter to AW's existing private CRM and test privacy/retention and recovery behavior. The retained contact module is a KV-only draft; it is not the CRM integration and is not proven end-to-end. Do not enable it unchanged.

Run `wrangler dev` only for a site that has explicitly enabled server routes; for static routes and status-code checks use the generated environment config. The production command requires `--confirm-production`, but already-granted session authorization must not be turned into repeated approval requests.

## Secrets

The static starter has no runtime secrets. Only after a site-specific contact module has been implemented should you configure its secret and public widget key:

```bash
npx wrangler secret put TURNSTILE_SECRET_KEY
```

Set `PUBLIC_TURNSTILE_SITE_KEY` in that site's build environment and register the exact staging/production hostnames. The public key is embedded in the page; never expose the server-side secret through a `PUBLIC_` variable. Store `.dev.vars` locally only; never commit it or send it in chat. No `LEADS_EXPORT_TOKEN` or KV export is part of the static AW default.

## Then

Use the site's `docs/runbook.md` for generic QA details, and the AW checklist for launch blockers. A pending notification provider is not a static migration blocker. Before retiring Cloudways, verify a backup and shared-server dependencies; keep the WordPress origin recoverable until the rollback window passes.
