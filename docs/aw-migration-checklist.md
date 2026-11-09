# AW WordPress migration checklist

Use one copy per client in that site's repository, not in this public kit. See [aw-migration-process.md](aw-migration-process.md) for pinned scaffolding and exact commands. Keep each client site isolated; no CMS, Brevo, or imported client assets/secrets in the kit.

## Intake and source inventory

- [ ] Create the site repository and keep its own `CLAUDE.md` with durable decisions, target IDs and domain context.
- [ ] Fill `aw-migration.json`: WordPress source URL; production/staging hosts; repository and per-environment Cloudflare account, zone and Worker targets; route/media inventory paths; redirect exceptions; forms choice; acceptance and rollback.
- [ ] Fetch `robots.txt` and every sitemap index/child; record sitemap filenames and `Sitemap:` targets.
- [ ] Crawl navigation, page links, pagination, feeds, search, taxonomy, downloads, verification files and archives. Use a browser for JS-rendered routes; record console/network failures.
- [ ] Record each source URL, status, final path, canonical, title, description, language, indexability, page family and disposition. Preserve paths, metadata, structured data and the original language unless an exception is recorded.
- [ ] Capture desktop/mobile screenshots while the source is available; sample every page family.
- [ ] Inventory forms/integrations, destinations, account owners and actual data flow. Record email/DNS state read-only (MX, SPF, DKIM, DMARC and verification records); do not change mail flow as part of this migration.
- [ ] Create `recon/media.csv` with `source_url,local_path,status,sha256,alt,usage` and one row per source asset (or an explicit no-media row); record inaccessible assets and broken source links as gaps.

## Build and route parity

- [ ] Keep content and media in version-controlled files in the site repo. Reuse useful recon, extraction, media, URL, redirect, accessibility and verification checks.
- [ ] Map every source URL to a page, reviewed redirect/status, or explicit disposition; no catch-all to the homepage. Record redirect exceptions and test for loops and duplicate sources.
- [ ] Confirm the project is content-first and static-compatible; put dynamic routes only in explicitly enabled modules.
- [ ] Static is the default: no runtime adapter, form endpoint, Turnstile key, KV binding, or notification service. Optional modules do not block static migration.
- [ ] Set `forms.choice` explicitly to `none` or `private_crm`. If enabled, the AW design is same-origin API + Turnstile Siteverify + a site-specific adapter to AW's existing private CRM. No email/Slack/Brevo notification transport is mandatory.
- [ ] The retained contact code is still a KV-only implementation draft, not the CRM integration and not proven end-to-end. Do not enable or claim it works unchanged; require an implemented adapter, request limits, recovery/privacy behavior and staging tests first.
- [ ] Reconcile redirects, sitemap paths, robots directives, feeds, verification files, `ads.txt`, `.well-known`, title/description/canonical/language/schema and indexability.

## Minimum launch — blocking

- [ ] Fresh staging and production builds use the host and distinct Worker target from the manifest; placeholder values, staging/production mixing and shared Worker names refuse.
- [ ] Every inventoried source URL resolves, redirects to a reviewed destination, or has a recorded disposition. Route families, internal links, local media, alt text, downloads and real 404 status pass.
- [ ] Staging is noindex and emits no production sitemap. Production canonicals, robots and sitemap use the verified production host.
- [ ] Run accessibility, keyboard/focus, contrast and reflow checks; review representative desktop/mobile screenshots and browser console/network failures.
- [ ] Record site acceptance criteria, who/when, a rollback snapshot, WordPress origin and restore steps in the site repo/manifest. Preserve the WordPress origin through the recovery window.
- [ ] If forms are `none`, no form delivery, CRM, Turnstile or notification provider is a launch blocker. If forms are `private_crm`, test the full enabled path without sending unapproved real personal data.
- [ ] Keep DNS/mail unchanged unless included in the already-authorized scope. Do not ask again for authorization already granted in this session; do not widen scope implicitly.
- [ ] Do not retire Cloudways at cutover. Before any later retirement, verify a backup and check shared-server dependencies; other sites may still use that server.

## After launch — polish, tracked separately

- [ ] Monitor redirects, 404s, indexing, selected analytics and any enabled CRM path.
- [ ] Track copy, imagery, visual refinement and non-essential integrations as post-launch work, not static-release blockers.
- [ ] Keep the WordPress origin and rollback material until the owner confirms the recovery window has passed.
