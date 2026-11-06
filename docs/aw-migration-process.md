# AW website migration process

This is AW's reusable process for moving an existing marketing or content site into a site-specific repository. It is a process guide, not a client specification. Record client URLs, content, screenshots, credentials, analytics identifiers and form submissions only in that client's repository or approved private systems; never in this public kit.

## Baseline decisions

- **Keep repositories separate.** The kit contains reusable methods and a generic starter. Every site gets its own repository, deployment configuration, content, assets, secrets and persistent `CLAUDE.md` context. A kit change does not update a site already scaffolded from it; make site-specific changes in the site repository, not by copying client files into this kit.
- **No CMS by default.** Keep content as versioned Markdown, JSON or TypeScript data in the site repository. Do not add PagesCMS, Keystatic or another CMS unless the owner explicitly needs non-developer publishing. Cloudflare EmDash is a possible later evaluation, not a present dependency or assumed integration.
- **Use Astro with Cloudflare Workers when the site fits.** This is the starting point for a content-first marketing site whose pages can be rendered at build time and whose small runtime needs fit a Worker. Cloudflare documents both a static-assets path, which does not need the Astro adapter, and adapter-based on-demand routes and bindings. The current kit template uses Astro static output with the Cloudflare adapter and a non-prerendered contact API route. Choose a different stack when the site is an application, needs unsuitable runtime behavior, or has an existing platform that should remain. Re-check the official framework guides and the lockfile when starting each project; this is not a blanket claim that every site needs a Worker. [Astro Cloudflare integration](https://docs.astro.build/en/guides/integrations-guide/cloudflare/) · [Cloudflare Workers Astro guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/astro/)
- **Own the contact-form path.** Do not preserve or re-embed LeadConnector. Use the source-controlled same-origin form endpoint pattern already present in the MIT-licensed kit as a starting point, then configure its storage and notification transport for the site. The current template's notification adapter is Brevo; that is existing template behavior, not an AW-mandated provider.
- **Treat deployment and DNS as separate approvals.** A migration may prepare a build and a cutover plan, but must not publish, change production DNS, or alter MX/email records unless those actions are separately authorized.

## Migration stages and gates

### 1. Reconnaissance before implementation

Capture a baseline while the source site is still available. Inventory URLs from `robots.txt`, every sitemap index and child sitemap, navigation, feeds, search results, archived routes and any platform export. For WordPress, inspect the REST API when available, but compare it with rendered pages; a database or API export alone may omit builder-rendered content. Use a real browser for JavaScript-rendered pages and for the visual baseline.

For every route, record the source URL, final path, page family, response status, canonical, title, description, language, indexability and intended disposition. Inventory redirects, pagination, taxonomy, image and download URLs, structured data, verification files, analytics, consent, booking, chat, search and all forms. Record email hosting and DNS records read-only. Mark inaccessible resources and make no silent substitutions.

**Gate:** route inventory, integrations inventory, desktop/mobile screenshots and an owner-visible list of missing access or content exist before routes or designs are rewritten.

### 2. Extract content and media without changing meaning

Preserve the source language, route slugs, headings, body copy, image alt text, internal links, metadata and structured data unless an owner-approved change is recorded. Use rendered HTML as the visual/content reference; use CMS exports or APIs as additional sources, not as proof that every rendered page was captured. Store content in files with a documented schema and preserve one source of truth.

Keep media in the site repository where appropriate. Create a manifest with the original URL, local path, fetch status, hash, alt text and any usage/licensing note. Keep source originals apart from generated responsive formats. A failed or blocked image is a review item, not permission to invent a replacement. Verify that every intended local media reference resolves after the build.

**Gate:** route-to-content mapping and media manifest have no unexplained gaps; every exception has an owner decision or an explicit open item.

### 3. Create the site-specific project

Scaffold from the kit only after recon establishes that its architecture fits. Keep the site in a separate repository. Update that repository's README and `CLAUDE.md` with the chosen stack, route and content conventions, service accounts, form behavior, privacy/retention assumptions and deployment boundaries. Never copy project material, tokens or account IDs into this kit.

Use file-based content by default. Add CMS configuration only after an owner has chosen an editorial workflow. EmDash may be assessed later if requested; evaluate its current maturity, editorial workflow, hosting and migration/export behavior at that time rather than assuming it is available or suitable now.

### 4. Implement routes, content and integrations

Build reusable components around the source site's page families without imposing the kit's sample design on the migrated site. Keep canonical URLs, sitemap behavior and redirects tied to the route inventory. Do not redirect an old route to the homepage as a catch-all. Keep structured data truthful and based on verified business facts.

Replace third-party forms as a distinct integration task. A form's visual embed is not the same as its lead-capture, CRM, notification or autoresponder behavior. Document which capabilities are intentionally retained, replaced or dropped. If a third-party account is unavailable or prohibited, do not silently leave its script or iframe in production.

### 5. Contact form and email architecture

The recommended AW baseline is a **first-party, source-controlled endpoint** in the site's Astro/Workers project:

1. The browser submits a native HTML form to a same-origin route such as `/api/contact`.
2. The Worker validates content type, field types, lengths and required fields; checks origin where available; applies a honeypot and rate limiting; and returns accessible field errors. Add Turnstile only if the owner accepts that dependency and its privacy implications.
3. If the owner wants a submission archive, persist the minimum necessary fields before attempting email notification. Use a defined retention period, avoid personal data in logs and storage metadata, and secure any export route. If no archive is required, do not retain submissions merely because the code can.
4. Send a notification from a verified address on the site's domain to the owner-selected inbox. Put the visitor's address in `Reply-To`, never in the `From` header. A mail outage must not silently discard a lead that has already been stored.

This is the recommended open-source/self-controlled approach: the MIT-licensed kit's first-party handler runs in the site owner's Worker account and is copied into that site's separate repository. It removes the LeadConnector form/CRM dependency and keeps validation, form behavior, storage choices and tests in the site's own source. The current reference is [`template/src/pages/api/contact.ts`](../template/src/pages/api/contact.ts), with validation in [`template/src/lib/lead.ts`](../template/src/lib/lead.ts) and notification in [`template/src/lib/brevo.ts`](../template/src/lib/brevo.ts).

Reuse the handler as a pattern, not an unchecked drop-in: the current route validates, checks `Origin`, uses a honeypot, writes to KV before attempting Brevo, and applies the configured TTL, but it does **not** implement request rate limiting. Its lead record currently stores IP, user-agent and country; remove fields not needed for an explicit security/service purpose and reflect any retained personal data in the privacy and retention decisions. The email adapter remains Brevo until replaced; it is separate from the open-source form handler. For a simple append-only archive, KV with TTL may be sufficient; choose D1 only when queryable/admin workflows are documented requirements. Neither is a CRM.

**Cloudflare Email Routing and Email Sending are different capabilities.** Email Routing handles *incoming* mail for a domain and can forward it to a verified destination or process it with a Worker; it is not a mailbox and is not the outbound transport for a website contact form. It requires Cloudflare DNS and onboarding changes the domain's root MX records, which can conflict with an existing mail host. Use it only after reviewing the current mail setup and receiving explicit owner approval. [Email Routing setup](https://developers.cloudflare.com/email-service/get-started/route-emails/)

Cloudflare Email Service **Email Sending** is the separate outbound feature. As of 2026-11-06, Cloudflare's official overview still labels Email Sending as **Beta**, and Cloudflare announced public beta on 2026-04-16. A Worker can use the native `send_email` binding. Sending to arbitrary recipients requires Workers Paid; before a sending domain is onboarded, destinations are limited to verified account addresses. The current pricing page lists 3,000 outbound emails included per month on Workers Paid and $0.35 per additional 1,000, while new accounts start with conservative daily limits that can change with sending behavior. Sending-domain onboarding adds authentication/bounce DNS records (including records under `cf-bounce` and a DMARC record); these are distinct from Email Routing's root MX setup. Treat the service as an optional low-volume pilot only if the owner accepts beta status, plan eligibility, quota and deliverability risk. Do not change DNS as part of this process. [Email Service overview](https://developers.cloudflare.com/email-service/) · [Workers send API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/) · [Email Sending limits](https://developers.cloudflare.com/email-service/platform/limits/) · [Email Service pricing](https://developers.cloudflare.com/email-service/platform/pricing/) · [Domain configuration](https://developers.cloudflare.com/email-service/configuration/domains/) · [Public beta announcement](https://blog.cloudflare.com/email-for-agents/)

If beta email is not acceptable, use a mail provider explicitly chosen by the owner, or separately scope a self-hosted open-source mail transfer service. Self-hosting mail brings ongoing responsibility for queues, bounce handling, reputation, SPF/DKIM/DMARC, abuse controls and deliverability; do not make it the default for a low-volume contact form without an operator who will own it.

### 6. Verify parity and behavior

Use the complete source URL inventory as the expected set. Build and type-check the site, then compare built and served routes with the old inventory. Test internal links, redirects, sitemap and robots behavior, canonical and metadata parity, structured data, local assets, real 404 status, console/network failures, accessibility and representative desktop/mobile layouts. Check each page family, not only the homepage.

Exercise the contact route with valid, invalid, malformed, cross-origin, empty, duplicate and honeypot submissions. Verify rate limiting and any bot challenge. Confirm storage and notification separately, including provider failure, duplicate retry behavior, retention, export authorization and the visitor-facing success/failure state. Never use a test that sends real email to an external recipient without an approved test plan.

**Gate:** automated checks pass, visual differences are reviewed, and each known gap has a tested fix or a written owner acceptance.

### 7. Handover and rollout planning

Deliver the source repository, content/media manifests, route and redirect inventory, test evidence, service/binding list, secrets setup instructions, contact-form data-flow description, retention policy, rollback instructions and open decisions. Capture DNS and email records read-only before any cutover. Check MX, SPF, DKIM, DMARC and verification records independently from website records.

Deployment, production cutover, DNS changes and changes to existing email routing are not implied by a successful build. They require a separate, explicit owner-approved rollout step with a tested rollback and monitoring plan. During the first week after an authorized launch, check 404s, form submissions, delivery failures, analytics continuity and Search Console coverage.

## References checked

The Astro and Cloudflare framework behavior and Cloudflare Email Service facts above were checked against the official documentation on 2026-11-06. Product availability, limits, prices and beta status can change; re-check the linked provider pages before each project decision.
