# AW website migration checklist

Use one copy per site in that site's repository. Do not store client-specific results in the public build kit. Keep the existing production site and DNS unchanged until a separate rollout is approved.

## 0. Scope and ownership

- [ ] Confirm site owner, decision-maker, business goal and one primary conversion.
- [ ] Create or select the site-specific repository; keep it separate from `website-build-kit`.
- [ ] Add/update the site repository's `README.md` and `CLAUDE.md` with durable project decisions.
- [ ] Record out-of-scope items and required owner approvals, including production deployment, DNS and mail-flow changes.
- [ ] Confirm access to source hosting, domain registrar/DNS, current email provider, analytics and business-owned service accounts; never place credentials in repository files.

## 1. Capture the source site

- [ ] Fetch `robots.txt` and every sitemap index/child sitemap; record sitemap filename and `Sitemap:` target.
- [ ] Crawl navigation, page links, pagination, feeds, search, taxonomy, downloads, verification files and archive candidates.
- [ ] Use a real browser for JavaScript-rendered routes and inspect console/network failures.
- [ ] Capture desktop and mobile screenshots while the source is still available; sample every page family.
- [ ] Record each source URL, status, final path, canonical, title, description, language, indexability, page family and disposition.
- [ ] Inventory all forms and third-party integrations: where data goes, who owns each account, and what the service actually does.
- [ ] Record the current email/DNS state read-only, especially MX, SPF, DKIM, DMARC and domain-verification records.
- [ ] List inaccessible pages, images, credentials and services as explicit gaps; do not replace or omit them silently.

## 2. Content and media extraction

- [ ] Extract rendered content; use WordPress REST/API/export as a second source when available, not as the sole completeness check.
- [ ] Preserve original language, page intent, slugs, headings, body copy, internal links, image alt text and downloadable assets.
- [ ] Preserve per-route metadata, canonical URLs, structured data and index/noindex intent; verify facts rather than copying unsupported claims.
- [ ] Keep content file-based in the site repository by default; do not add PagesCMS or another CMS without an explicit editorial need and owner decision.
- [ ] Store media locally when permitted and create a source manifest with source URL, local path, fetch status, hash, alt text and usage note.
- [ ] Record unavailable media and broken source links with an owner-approved action or an open status.

## 3. Architecture and project setup

- [ ] Confirm the site is content-first and fits static-first Astro; identify every route that needs runtime behavior.
- [ ] Confirm whether Cloudflare Workers are the right target. Use static assets without the Astro adapter for a purely static build; use the current supported Astro Cloudflare adapter when on-demand routes or bindings are required.
- [ ] Re-check official Astro/Cloudflare docs and supported versions; commit the lockfile and document the Node/runtime requirements.
- [ ] Scaffold a separate site repository; keep client routes, content, media, credentials and analytics out of the kit.
- [ ] Decide where content and assets live; define schemas and ensure there is one source of truth.
- [ ] Decide whether any CMS is genuinely required. Cloudflare EmDash is a future evaluation, not an assumed current integration.
- [ ] Choose storage, retention, analytics and consent behavior only when justified by site needs and owner decisions.

## 4. Routes, SEO and integrations

- [ ] Map every source URL to a destination route or explicit disposition.
- [ ] Implement redirects from a reviewed map; no catch-all redirects to the homepage.
- [ ] Preserve required sitemap paths, robots directives, feeds, verification files, `ads.txt` and `.well-known` files where applicable.
- [ ] Compare title, description, canonical, language, structured data and indexability route by route.
- [ ] Recreate or explicitly drop analytics, booking, CRM, chat, search, marketing and consent integrations; document account owner and test evidence.
- [ ] Remove LeadConnector form embeds/scripts. Do not leave an external form active as an undocumented fallback.

## 5. Contact form and email choice

- [ ] Implement the site's own same-origin form endpoint in the site repository; keep validation and tests source-controlled.
- [ ] Validate input types, lengths and content type; provide accessible error and success states and a non-JavaScript submission path where required.
- [ ] Add honeypot and rate limiting; add Turnstile only if the owner accepts the additional dependency and privacy implications.
- [ ] Decide whether submissions are stored. If yes, minimize PII, store before sending email, define retention/deletion and secure any export route.
- [ ] Select the email notification transport separately from the form endpoint; never put a visitor address in `From`, and use a verified site-owned sender with the visitor in `Reply-To`.
- [ ] If considering Cloudflare Email Service Email Sending, record acceptance of its Beta status, Workers Paid requirement for arbitrary recipients, quotas, and sending-domain DNS setup.
- [ ] Do not confuse Email Routing with outbound sending; routing is for inbound mail and may change root MX records.
- [ ] Do not change DNS, MX, SPF, DKIM or DMARC in this migration task. Capture current records and require a separately approved change plan.
- [ ] Test valid, invalid, malformed, cross-origin, honeypot, rate-limited and duplicate submissions; test storage and email failures independently.

## 6. Build and QA gates

- [ ] Clean install from the committed lockfile; run Astro checks and the production-equivalent build with the correct environment.
- [ ] Compare generated/served routes against the entire source inventory and confirm every gap is resolved or accepted.
- [ ] Crawl internal links and verify all local assets, image alts, downloads, redirects and real 404 status.
- [ ] Verify sitemap, robots, canonical URLs, metadata, JSON-LD, feeds and old verification paths.
- [ ] Test representative desktop/mobile viewports and every template family against the source screenshots.
- [ ] Run accessibility, keyboard, focus, contrast and reflow checks; inspect browser console and failed network requests.
- [ ] Test contact delivery without sending unapproved real email; verify persistence, retention and failure behavior.
- [ ] Record build, link, asset, form and visual QA evidence in the site's private repository.

## 7. Handover and release boundary

- [ ] Deliver source, runbook, content/media manifests, URL/redirect map, environment setup and service/binding inventory.
- [ ] Document form data flow, who receives messages, storage/retention, email provider, failure handling and any beta dependency.
- [ ] Record unresolved owner decisions and accepted gaps; do not mark the project launch-ready while a decision is silently missing.
- [ ] Prepare rollback and post-launch monitoring for 404s, forms, delivery failures, analytics and search indexing.
- [ ] Stop before deployment, production cutover or DNS/mail changes unless separately authorized; those are not implied by a green build.
