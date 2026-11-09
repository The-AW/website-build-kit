# AW WordPress migration path

Use this path for the next AW migrations. Each site lives in its own repository; this kit contains no client URLs, content, assets, credentials, CRM data or analytics IDs. Keep file-based content, no CMS, and no Brevo integration.

## 1. Pin and scaffold this fork

Do not use `npm create website-build-kit@latest` or `npx degit` for an AW site: those fetch the upstream distribution, not this fork. After PR2 is merged, clone AW `master` and run this exact entry sequence; the clean checkout's current commit is stamped into the site `package.json`. The scaffolder copies only tracked template files, including `.gitignore`, scripts and `package-lock.json`.

```bash
git clone --branch master https://github.com/The-AW/website-build-kit.git "$HOME/coding/website-build-kit"
SITE_DIR="$HOME/coding/site-slug" # use a new, empty destination for this site's repository
node "$HOME/coding/website-build-kit/scripts/scaffold-aw.mjs" "$SITE_DIR"
cd "$SITE_DIR"
```

Fill in `aw-migration.json` before any deploy. It records the WordPress source URL; separate staging and production hosts; repository, per-environment Cloudflare account/zone/Worker targets; route and media inventory paths; redirect exceptions; `forms.choice`; acceptance criteria; and a rollback snapshot, preserved WordPress origin and restore steps. Do not copy client assets or secrets into the kit. Builds refuse placeholder hosts/Workers and missing source/repository fields; after intake is complete, set `template` to `false`. Deploys also require real account/zone IDs and route/media inventories; production additionally requires recorded acceptance and an existing rollback snapshot.

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

Review the full route and media inventories before implementation. `inventories.media` defaults to `recon/media.csv` with columns `source_url,local_path,status,sha256,alt,usage` and a reviewed row for every source asset (or an explicit no-media row); `npm run media` separately writes the processed-image manifest. Keep `public/_redirects` empty until reviewed; every rule must match a `redirectExceptions` item with `source`, `destination`, `status` and `reason`. Preserve useful crawl, media, URL, redirect, accessibility and 404 checks. `aw-migration.json` is the host source of truth: build scripts refuse placeholders and conflicting `PUBLIC_SITE_URL` values. Generated `.aw/wrangler-staging.jsonc` and `.aw/wrangler-production.jsonc` use different Worker names and exact hostnames, set `workers_dev: false` and `preview_urls: false`, and retain only their intended custom-domain route. Immediately before invoking Wrangler, deploy validates the exact selected file again, including `dist/server/wrangler.json` if runtime is enabled. The checked-in `wrangler.jsonc` is neutral and must not be deployed directly.

The default is static Astro plus Cloudflare Workers Static Assets: no Astro Worker adapter, contact API, Turnstile key, KV binding or notification service. The build gate checks staging page-meta/header/robots noindex, absence of a staging sitemap, and environment-specific canonicals; production requires its own robots/sitemap host and a real 404. Optional modules do not block a static migration.

`forms.choice` defaults to `none`. If a site explicitly needs a form, the target design is a same-origin API, server-side Turnstile Siteverify and an adapter to AW's existing private CRM. No notification provider is mandatory. The current contact module is still in implementation: its retained KV-only draft is not the CRM path and has not been proven end-to-end. Do not enable it or claim it works until the site-specific adapter, recovery behavior, privacy/retention and staging tests are implemented and reviewed.

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

## 4. Cloudflare auth and asset-upload fallback

The proven auth path is BYOK `CLOUDFLARE_API_TOKEN` in the environment. Run `npx wrangler whoami` first. If it succeeds, missing Wrangler OAuth is not missing configured API access and `wrangler login` is unnecessary. Never print or pass the token as a command-line argument.

If Wrangler's bulk asset transfer fails with `fetch failed` before activation, first confirm the failure and target; do not report a successful deploy. Use Cloudflare's [official Workers Static Assets direct-upload API](https://developers.cloudflare.com/workers/static-assets/direct-upload/): `POST /accounts/{account}/workers/scripts/{worker}/assets-upload-session` with the full manifest; upload only requested missing hashes to `/accounts/{account}/workers/assets/upload?base64=true` in bounded multipart batches using the short-lived upload JWT; `POST /accounts/{account}/workers/scripts/{worker}/versions` with completion JWT and Worker module/metadata; verify the returned version; then `POST /accounts/{account}/workers/scripts/{worker}/deployments` for that exact version at 100% and read back the deployment. Keep the BYOK token in the environment and use `curl --config -` for transient JWTs so neither token appears in argv/logs. Attach a custom domain separately only for a first cutover. For later releases retain the existing domain/DNS and rollback version; do not detach or recreate DNS.

This flow is evidenced by Mae Experiente production: the injected BYOK token passed `wrangler whoami`, Wrangler's standard bulk transfer failed before activation, and the official API path completed version/deployment/domain readback. The one-off Mae helper was pinned to its PR and first-deploy-only; do not reuse it unchanged. See the [final cutover task aTJVRFYyXThd6nA8LNJLdL](https://manus.im/app/task/aTJVRFYyXThd6nA8LNJLdL) and [merged Mae PR #12](https://github.com/The-AW/mae-experiente/pull/12). That cutover had one release candidate and one live writer; unrelated sites stayed isolated. Parallel work is safe only for independent tasks supplied with the complete site, repository, domain, target-ID and decision context; review the final meaningful diff, not repeated approval rounds.

## 5. After launch

Check representative routes and media, production canonicals/indexability, production sitemap and robots, unknown-path 404 status, redirects and any enabled CRM path. Record results in the site repository. Keep after-launch copy, design and non-blocking integration polish separate from the minimum launch gate.
