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
- [ ] Configure PagesCMS as the AW default for owner-editable content: add a site-specific `.pages.yml`, map every editable file/field, limit repository access to approved editors, and test that an edit saves without dropping undeclared data. The generic starter does not ship a PagesCMS config; document a no-CMS exception only if there is no ongoing editorial editing need. [PagesCMS documentation](https://pagescms.org/docs/)
- [ ] Store media locally when permitted and create a source manifest with source URL, local path, fetch status, hash, alt text and usage note.
- [ ] Record unavailable media and broken source links with an owner-approved action or an open status.

## 3. Architecture and project setup

- [ ] Confirm the site is content-first and fits static-first Astro; identify every route that needs runtime behavior.
- [ ] Choose hosting based on runtime needs: a purely static `dist/` can use Workers Static Assets with Wrangler and no Astro adapter, Worker script or bindings; on-demand routes, server rendering and Cloudflare bindings need a Worker runtime and the supported Astro Cloudflare adapter.
- [ ] Re-check official Astro/Cloudflare docs and supported versions; commit the lockfile and document the Node/runtime requirements.
- [ ] Scaffold a separate site repository; keep client routes, content, media, credentials and analytics out of the kit.
- [ ] Decide where content and assets live; define schemas and ensure there is one source of truth.
- [ ] Confirm who will edit content after handover and map the PagesCMS collections to that workflow. Cloudflare EmDash is a future evaluation only, not the selected CMS or a current integration.
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
- [ ] Match the form action to the Astro route's trailing-slash configuration and verify the POST reaches the handler without a redirect.
- [ ] Allow only intended content types and fields; cap total request-body size before parsing; validate input types, lengths and required fields. Provide accessible error/success states and an accessible recovery path if scripts or verification are unavailable. Never bypass bot verification silently.
- [ ] Configure the generic template's Turnstile integration: set the public `PUBLIC_TURNSTILE_SITE_KEY` in the build environment and `TURNSTILE_SECRET_KEY` as a Worker secret; register the exact staging/production hostnames and use action `contact`. The handler validates Siteverify success, hostname and action on every non-honeypot submission. The widget alone is not protection. See [client-side rendering](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/) and [server-side validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/).
- [ ] Add a honeypot and endpoint rate limiting as additional controls. Test Turnstile missing, invalid, expired, replayed and Siteverify-unavailable cases; fail closed with a user-recoverable response.
- [ ] Decide whether submissions are stored. If yes, minimize PII, store before notifications, define retention/deletion for each store and notification copy, and secure any export route. A KV TTL does not expire email, Slack messages, provider logs or backups.
- [ ] Use Brevo as the AW default email notification provider. Verify a site-owned sender, keep `BREVO_API_KEY` in the Worker secret store, never put a visitor address in `From`, use visitor `Reply-To`, and isolate staging recipients.
- [ ] Add Slack only as an explicitly approved additional or alternative notification channel. The webhook URL is secret and channel-bound; Incoming Webhooks cannot delete posted messages. Use a staging channel, minimize shared fields, and document workspace retention/access. See [Slack Incoming Webhooks](https://api.slack.com/messaging/webhooks).
- [ ] The generic template supports Brevo email and Turnstile, but has no request-body size cap, request rate limiter, duplicate/idempotency protection, Slack adapter, durable notification retry or alert; if storage succeeds and Brevo fails, it still tells the visitor the submission succeeded. Implement and test an operator alert or durable retry before production use.
- [ ] Update the privacy notice to describe Turnstile and every form-data recipient/provider, the fields shared with each, and separate retention/deletion rules for KV, inboxes, Slack messages and provider copies. If Invisible mode is selected, include Cloudflare's required [Turnstile Privacy Addendum](https://developers.cloudflare.com/turnstile/concepts/widget/).
- [ ] Treat Cloudflare Email Service Email Sending as a researched alternative only. If the owner explicitly chooses it instead of Brevo, record acceptance of Beta status, Workers Paid requirement for arbitrary recipients, quotas, sending-domain DNS changes and deliverability risk.
- [ ] Do not confuse Email Routing with outbound sending; routing is for inbound mail and changes root MX records. It cannot coexist with another provider's MX records without a planned mail cutover.
- [ ] Do not change DNS, MX, SPF, DKIM or DMARC in this migration task. Capture current records and require a separately approved change plan.
- [ ] Test valid, invalid, malformed, oversized, cross-origin, honeypot, rate-limited, duplicate and retry submissions; verify missing/invalid/expired/replayed Turnstile tokens and Siteverify outage. Test storage and each enabled notification channel's success/failure independently. Never send test PII to production email or Slack destinations.

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
- [ ] Document form data flow, fields sent to each recipient/provider, storage and notification-copy retention/deletion, notification destinations, failure/retry ownership and any Beta dependency.
- [ ] Record unresolved owner decisions and accepted gaps; do not mark the project launch-ready while a decision is silently missing.
- [ ] Prepare rollback and post-launch monitoring for 404s, forms, delivery failures, analytics and search indexing.
- [ ] Stop before deployment, production cutover or DNS/mail changes unless separately authorized; those are not implied by a green build.
