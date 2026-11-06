# AW website migration process

This is AW's reusable process for moving an existing marketing or content site into a site-specific repository. It is a process guide, not a client specification. Record client URLs, content, screenshots, credentials, analytics identifiers and form submissions only in that client's repository or approved private systems; never in this public kit.

## Baseline decisions

- **Keep repositories separate.** The kit contains reusable methods and a generic starter. Every site gets its own repository, deployment configuration, content, assets, secrets and persistent `CLAUDE.md` context. A kit change does not update a site already scaffolded from it; make site-specific changes in the site repository, not by copying client files into this kit.
- **No CMS is selected.** Keep content in version-controlled files in the site's repository (for example Markdown, JSON and typed data modules) and keep one source of truth. Do not configure PagesCMS or add a `.pages.yml`. Cloudflare EmDash is the only future CMS possibility mentioned here; it is not selected, installed or a current dependency.
- **Use Astro with Cloudflare when the site fits, and separate static hosting from runtime.** A purely static Astro build can deploy `dist/` as Workers Static Assets with Wrangler; it needs no Astro adapter, application Worker script or runtime bindings. On-demand routes, server rendering or Cloudflare bindings require a Worker runtime; use the supported Astro Cloudflare adapter for those Astro features. The current kit template is not static-only because it has a contact API route and KV bindings. Choose a different stack when the site is an application, needs unsuitable runtime behavior, or has an existing platform that should remain. Re-check the official guides and lockfile for each project. [Astro Cloudflare integration](https://docs.astro.build/en/guides/integrations-guide/cloudflare/) · [Cloudflare Workers Astro guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/astro/)
- **Use a first-party form endpoint and Cloudflare Turnstile for anti-bot protection.** Turnstile is the selected anti-bot service. The generic template renders the widget and validates each non-honeypot submission through Siteverify, checking token success, hostname and the `contact` action. Set `PUBLIC_TURNSTILE_SITE_KEY` in the build environment and `TURNSTILE_SECRET_KEY` as a Worker secret. Rate limiting, an overall body-size cap and duplicate/idempotency handling remain launch requirements. [Turnstile client widget](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/) · [Server-side validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)
- **Email and Slack notification transport is pending.** No provider or channel is selected; do not add Brevo or Slack as a default or imply that the template sends notifications. Record the owner's decision, the data shared, destinations, retention, failure handling and accountable operator before enabling a live form. Until then the generic template's lead archive is not an alerting or delivery channel.
- **Treat deployment and DNS as separate approvals.** A migration may prepare a build and a cutover plan, but must not publish, change production DNS, or alter MX/email records unless those actions are separately authorized.

## Migration stages and gates

### 1. Reconnaissance before implementation

Capture a baseline while the source site is still available. Inventory URLs from `robots.txt`, every sitemap index and child sitemap, navigation, feeds, search results, archived routes and any platform export. For WordPress, inspect the REST API when available, but compare it with rendered pages; a database or API export alone may omit builder-rendered content. Use a real browser for JavaScript-rendered pages and for the visual baseline.

For every route, record the source URL, final path, page family, response status, canonical, title, description, language, indexability and intended disposition. Inventory redirects, pagination, taxonomy, image and download URLs, structured data, verification files, analytics, consent, booking, chat, search and all forms. Record email hosting and DNS records read-only. Mark inaccessible resources and make no silent substitutions.

**Gate:** route inventory, integrations inventory, desktop/mobile screenshots and an owner-visible list of missing access or content exist before routes or designs are rewritten.

### 2. Extract content and media without changing meaning

Preserve the source language, route slugs, headings, body copy, image alt text, internal links, metadata and structured data unless an owner-approved change is recorded. Store the migrated content in version-controlled files in the site's repository and preserve one source of truth. Existing source CMS exports or APIs are additional extraction sources only; they do not select a CMS for the new site.

Keep media in the site repository where appropriate. Create a manifest with the original URL, local path, fetch status, hash, alt text and any usage/licensing note. Keep source originals apart from generated responsive formats. A failed or blocked image is a review item, not permission to invent a replacement. Verify that every intended local media reference resolves after the build.

**Gate:** route-to-content mapping and media manifest have no unexplained gaps; every exception has an owner decision or an explicit open item.

### 3. Create the site-specific project

Scaffold from the kit only after reconnaissance establishes that its architecture fits. Keep the site in a separate repository. Update that repository's README and `CLAUDE.md` with the chosen stack, route and file-based content conventions, service accounts, form behavior, privacy/retention assumptions and deployment boundaries. Never copy project material, tokens or account IDs into this kit.

Keep content in versioned files in the site's repository. Do not configure PagesCMS or another CMS as part of the AW baseline. EmDash may be evaluated in the future only if the owner requests reconsideration; assess its maturity, editorial workflow, hosting and migration/export behavior at that time, without presuming adoption.

### 4. Implement routes, content and integrations

Build reusable components around the source site's page families without imposing the kit's sample design on the migrated site. Keep canonical URLs, sitemap behavior and redirects tied to the route inventory. Do not redirect an old route to the homepage as a catch-all. Keep structured data truthful and based on verified business facts.

Replace third-party forms as a distinct integration task. A form's visual embed is not the same as its lead-capture, CRM, notification or autoresponder behavior. Document which capabilities are intentionally retained, replaced or dropped. If a third-party account is unavailable or prohibited, do not silently leave its script or iframe in production.

### 5. Contact form, anti-bot protection and notifications

The recommended AW baseline is a **first-party, source-controlled endpoint** in the site's repository. Use a Worker runtime when the endpoint is implemented on Workers; a purely static Astro build has no server route or bindings:

1. The browser submits a native HTML form to a same-origin route such as `/api/contact/`. Match Astro's configured trailing-slash behavior and test that the POST reaches the handler directly; a redirect after POST can lose the submission.
2. Allow only intended content types and fields, cap the total request-body size before parsing, and validate field types, lengths and required values. Check `Origin` when present as defense in depth, then apply a honeypot and rate limiting. Turnstile is selected: include it in the AW baseline and call Siteverify on the server for each submitted token. Reject missing, invalid, expired or replayed tokens and handle Siteverify outages with a recoverable error; never bypass verification silently. The client widget alone does not protect the endpoint.
3. If the owner wants a submission archive, persist only the minimum necessary fields. Set retention and deletion rules for each store, avoid personal data in logs and storage metadata, and secure any export route. KV expiry does not expire copies in an inbox, Slack workspace, provider logs or backups. If no archive is required, do not retain submissions merely because the code can.
4. **Notification transport remains pending.** Email and Slack are both undecided; no email provider, Brevo adapter or Slack destination is selected. Do not configure or describe a notification channel until the owner makes an explicit decision. Before a live form, document the selected transport, recipient/channel, fields shared, staging destination, privacy/retention, failure/retry path and accountable operator. Do not send the visitor's address in a sender field if an email channel is later approved.
5. Define partial success and recovery for the chosen design. A stored lead with no alert is not delivery. Do not tell a visitor to resubmit after a partial failure; provide an operator-visible recovery path and test it before launch. A provider acknowledgment does not prove that a person read or acted on a lead.

The generic template keeps content in files, has no CMS configuration, validates Turnstile, and can archive leads in KV. It does **not** send email or Slack notifications. Reuse the endpoint as a pattern, not an unchecked drop-in: it still lacks an overall request-body size cap, request rate limiting, duplicate/idempotency protection and durable notification recovery. Do not treat the archive as an operational notification system or use the starter form in production until the owner has selected and tested a notification path and the remaining abuse/recovery controls are addressed. Minimize fields and include every processor and copy in privacy, access, retention and deletion decisions.

Cloudflare Email Routing is for inbound mail, not outbound form notification; changing it can affect existing MX records. No provider, mail routing, DNS or MX change is selected by this process. Capture existing records read-only and require separate owner approval for any future change.

### 6. Verify parity and behavior

Use the complete source URL inventory as the expected set. Build and type-check the site, then compare built and served routes with the old inventory. Test internal links, redirects, sitemap and robots behavior, canonical and metadata parity, structured data, local assets, real 404 status, console/network failures, accessibility and representative desktop/mobile layouts. Check each page family, not only the homepage.

Exercise the contact route with valid, invalid, malformed, cross-origin, empty, duplicate and honeypot submissions. Verify rate limiting and Turnstile Siteverify behavior, including missing, expired, replayed and invalid tokens plus Siteverify outage. Confirm storage, and separately test every notification channel only after an owner has selected it; include provider failure, duplicate retry behavior, retention, export authorization and visitor-facing success/failure states. Never send real email or post personal data to a production Slack channel during tests; use approved staging destinations.

**Gate:** automated checks pass and visual differences are reviewed. The form must have server-side Turnstile validation, a rate-limit control, a tested recovery path for every enabled notification channel, and privacy/retention rules covering the archive and notification copies. An unresolved email/Slack transport decision blocks launch readiness; any other exception needs a named owner decision and written risk acceptance.

### 7. Handover and rollout planning

Deliver the source repository, content/media manifests, route and redirect inventory, test evidence, service/binding list, secrets setup instructions, contact-form data-flow description, retention and deletion policy for the archive and each notification copy, rollback instructions and open decisions. Capture DNS and email records read-only before any cutover. Check MX, SPF, DKIM, DMARC and verification records independently from website records.

Deployment, production cutover, DNS changes and changes to existing email routing are not implied by a successful build. They require a separate, explicit owner-approved rollout step with a tested rollback and monitoring plan. During the first week after an authorized launch, check 404s, form submissions, delivery failures, analytics continuity and Search Console coverage.

## References checked

The Astro/Cloudflare framework and Turnstile behavior above are linked to their official documentation. Product availability and limits can change; re-check the linked pages before any later project decision. The generic template's remaining form gaps are listed explicitly above; do not infer that a checklist item is implemented just because the starter has a contact route.
