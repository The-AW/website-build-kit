# Working on this site

Astro (static) on Cloudflare Workers. Built from
[website-build-kit](https://github.com/nurkamol/website-build-kit).

## Commands

```bash
npm run dev                                  # localhost:4321 — no bindings, /api/* will not work
npm run media                                # after adding or replacing any image
npm run build:staging                        # static output; no Worker runtime or secrets
npm run deploy:staging:dry-run               # generated staging Worker/config only
npm run deploy:staging
npm run a11y                                 # accessibility check, one URL per family, both schemes
npx puppeteer browsers install chrome        # ...if that says Chrome is missing. npm 11 withholds
#                                              install scripts, so the download may not have run
npm run tells                                # what is undecided, and the design tells
npm run check:copy                           # author notes that reached the rendered page
npm run recon -- https://old-site.com        # inventory the old site BEFORE designing routes
#   --allow-internal                         # ...if the old site is on a VPN or a private address
npm run dns -- old-site.com                  # capture the zone. MX loss kills client email
npm run seo -- https://old-site.com          # optional: SEO baseline to diff after cutover
npm run verify -- https://new.example.com    # the deployed site, not the build. exits non-zero
npm run console                              # console errors + failed requests, in a real browser
npm run shots -- --before https://old-site.com  # visual record, WHILE the old site is still up
npm run extract                              # captured HTML → recon/extracted/*.md
npm run deploy:production:dry-run
npm run deploy:production -- --confirm-production   # only from a clean checkout equal to origin/<default>
```

⚠ **Production equals `origin/<default branch>`.** Merge to the default branch, push, then deploy from
it. `deploy:production` refuses a dirty tree, a failed `git fetch` or a `HEAD` that is not
`origin/<default>`, and stamps every deploy (staging too) with `--tag <sha> --message "<branch> <sha>"`.
A deploy from a branch is silently undone by the next deploy from the default branch: that kept one
site's contact form dead for five days. `--allow-unmerged "<reason>"` is the emergency escape and
writes itself into `BUILD-STATE.md`.

Node **22.12+**. `.node-version` pins the version this was built against.

The default is static Astro + Cloudflare Worker assets. Use `wrangler dev --config
.aw/wrangler-staging.jsonc` only after a site explicitly enables a server module; static deploys
need no runtime route, KV binding or secret.

## Rules for this codebase

⚠ **The phone number is written ONCE.** `business.ts` used to hold four copies of it —
`display`, `e164`, `href`, `sms` — and two of the email address. `href` and `sms` are now built
from one constant, because the fourth copy is how a tap-to-call button ends up dialling last
year's number: somebody changes the number they can *see* and has no reason to suspect another
two lines below. What is left is `display` against `e164`, which cannot be derived either way,
and `npm run check:contact` compares them on every build. Never type a `tel:` or `mailto:` out.

**`src/data/business.ts` is the only place business facts live.** Name, phone, address,
hours, service areas, credentials — plus `locale`, `timeZone` and `schemaTypes`, whose
defaults (`en`, `UTC`, `Organization`) are scaffold values, not verified facts. Confirm the
locale/time zone and the visible organization identity before using them; add a subtype such as
`LocalBusiness` only when the relevant facts are verified and visible. The header, footer, every
call-to-action and the JSON-LD all read from this file. Never hard-code a phone number in a component.

**Content stays in version-controlled files.** No CMS is selected or installed; do not add
PagesCMS or a `.pages.yml`. Cloudflare EmDash is a future possibility only, not a current
integration. The site's authorized editing and review workflow belongs in its project-specific
handover.

**`src/styles/tokens.css` is the only place a raw colour, size, radius or duration is
written.** Components reference tokens and nothing else. If you are typing a hex or a px in a
component, add a token instead.

**This template has no design, and adding one to it is not the job.** It ships a grey
placeholder ramp, the system stack for both faces and a scaffold home page — deliberately, so
that two sites built from it cannot look alike. Decide the palette, the two typefaces and the
page shapes *for this project*, in this project. Do not add a card style, a hero treatment or
a component library to the shared layer; `global.css` carries the interactive **states**, not
a look. Run `npm run tells` before showing anyone a page.

**Legal pages are markdown, never `.astro` files.** `src/content/legal/<slug>.md` is served at
`/<slug>/` by one route and linked in the footer from the collection itself, so the link cannot
exist without the page. Do not write `privacy.astro`. The root-level `[slug].astro` refuses to
build if a legal slug shadows a real page — Astro would give the page precedence and the legal
one would be built, linked and unreachable.

**`src/data/nav.ts` is the only place routes and the primary call to action live.** The
header, the mobile menu, the footer columns and the 404's onward links all read it, so the
404 can never offer a page that no longer exists.

**Every non-production build shows a badge**, driven by `site.indexable` — it cannot be left
on in production and cannot be turned on by hand. It reads the live DOM rather than printing
the build variable, so it alarms when the page disagrees with the environment (`NOT NOINDEX`,
`ANALYTICS LIVE`). `?nobadge=1` hides it for a session; never make that persistent.

**`aw-migration.json` is the source of truth for hosts and targets.** It records separate staging
and production hosts, accounts, zones and Worker names. Build scripts derive `PUBLIC_SITE_ENV` and
`PUBLIC_SITE_URL` from it, validate the generated `.aw/wrangler-<environment>.jsonc`, and refuse
placeholder or crossed targets. `src/data/site.ts` derives canonical/indexability/analytics from
the validated build environment; it does not choose a KV namespace in the static default.

**Images are AVIF + WebP.** `optimize-media.mjs` emits both per width and `<Img />` renders a
`<picture>`; AVIF is 26% smaller at better quality (measured — see `stacks.md` §3). WebP is the
fallback and is never dropped. Turning it off is `FORMATS = ['webp']` and nothing else. Note
that a `.parent > img` selector stops matching once there is a `<picture>` — see `docs/traps.md`.

**Images go through the manifest.** Put the original in `media/source/`, run `npm run media`,
reference it by key (`photos/hero-home`) via `<Img />`. Never an external URL, never a raw
path. This is what keeps `width`/`height` on every image so nothing shifts.

**Migrated WordPress uploads are opt-in and never ship at their original weight.** Set
`media.legacyUploads: true` in `aw-migration.json` only for a migration whose pages reference
`/wp-content/uploads/…`; originals go in `media/source/legacy/wp-content/uploads/` (never
`public/`). The build then stages the uploads the built pages use, deploys each as one WebP,
rewrites every reference and fails on a missing file, checks the file count against the Workers
Free cap, and writes old URLs as static `_redirects` rules (`scripts/legacy-redirects.mjs`, at most
2,000); an unknown URL is the static 404 (`not_found_handling: "404-page"`). No Worker runs for any
of it: Workers Free is 100k Worker requests a day for the whole account, and `"none"` once spent
them on crawler 404s until every site's form answered 429. `build.md` §5b has the steps and
`npm run test:legacy-media` proves them. Upload filenames are cached immutable for a year, so a replaced image gets a new name.

⚠ **TWO LEAD DATABASES FOR THE WHOLE COMPANY. NEVER CREATE ONE PER SITE.** Every The-AW site's
contact leads go into `websites-contact-crm-staging` (`61bc71ad-a87c-4d60-9b94-7ee4f5ce0b62`) from staging
builds and `websites-contact-crm-production` (`e31827c7-4909-4478-866e-cd538231cd3b`) from production builds.
Each row carries `site` (the production hostname, set by the build as `LEADS_SITE`) and the page's UTMs. The
account is on Workers Free (10 D1 databases); per-site lead databases used all 10 on 2026-11-20. The schema,
the private inbox and the 2-year retention job belong to github.com/The-AW/websites-contact-crm (its
`docs/site-contract.md` is the contract); a site never runs `wrangler d1 create` or `d1 migrations apply` for
leads, and the build refuses any other `LEADS_DB` id. **Turnstile widgets are shared per group of sites, not
per site:** `aw-loans` (secured-loan lead-gen), `aw-affiliate` (blogs / product recommendations), `aw-other`
(agency site and the rest), each with up to 10 root domains (a root domain covers its `staging.` subdomain).
Use the group's sitekey for staging and production; the Worker's exact Siteverify `hostname` check is what
keeps one site's token from being accepted by another, so never loosen it.

| `forms.turnstileGroup` | Widget | Sitekey (staging and production) |
| --- | --- | --- |
| `loans` | `aw-loans` | `0x4AAAAAAGI_5MENUiEK9Iek` |
| `affiliate` | `aw-affiliate` | `0x4AAAAAAGD0eg5NV7IMhbc5` |
| `other` | `aw-other` | `0x4AAAAAAGFvJc24kRMM91rU` |

The build refuses a d1_leads site without a group or with another sitekey (`TURNSTILE_GROUPS` in
`scripts/lib/aw-migration.mjs`). New site: add its root domain to the group's widget
(`npx wrangler turnstile widget update <sitekey> --domain <every current domain>,<new root domain>`; the list
replaces the old one) and pipe the secret, never printed:
`npx wrangler turnstile widget get <sitekey> --json | jq -r .secret | npx wrangler secret put TURNSTILE_SECRET_KEY --config .aw/wrangler-<env>.jsonc`.
Past 10 root domains a group gets a second widget (`aw-<group>-2`), added to `TURNSTILE_GROUPS`.

**`forms.choice: "d1_leads"` is the simple form when no CRM is required.** Each verified submission is
one row in the shared lead database: same-origin `POST /api/leads`, HTTPS-only exact-Origin
and host checks, a 16 KiB body cap, a per-visitor rate limit (the Workers rate-limiting binding,
`LEADS_RATE_LIMITER`, keyed by an HMAC of the IP), field validation and explicit consent, Turnstile
Siteverify (hostname and action checked), then one parameterised INSERT. No CRM, no shared secret. It ships
in the template: `src/lib/lead-api.ts` (handler), `lead-submission.ts` (fields and every visitor-facing
message), `lead-store.ts`, `src/components/LeadForm.astro` (no `migrations/`: the schema is the CRM repo's). A site adds
a two-line API route file (leads.ts in the api pages folder; the validator prints it if missing) and the `forms` block in
`aw-migration.json` (the group's Turnstile site key, the two shared database names + ids and a rate-limiter namespace per environment). Production
stays **closed** (`LEADS_ENABLED=false`) until `forms.productionEnabled` is true with a recorded
`productionAcceptance`. Read leads with `npm run leads:staging` / `leads:production`: personal data is
**masked** unless you pass `--reveal`, and only this site's rows (`site` = production hostname); all sites
together are in the CRM inbox (`/admin/` on the websites-contact-crm Worker, Cloudflare Access). `docs/aw-migration-process.md` §Contact has the setup order; delivery
of rows by email or Slack is a separate, later step. Retention is the CRM's daily job: rows older than
730 days (2 years) are deleted. `npm run test:form`, `test:leads` and
`test:leads-worker` prove it; the last builds the template with the choice on and runs the Worker.

**Launch checks that exist because they failed silently.** `npm run verify` fails when `http://` on the production
host does not 301 to `https://` (a Worker route does not redirect by itself). For a product-roundup / affiliate site:
`npm run lcp` (observed median LCP ≤ 500 ms, CLS < 0.1, real Chrome, 1440 and 390 px) and `npm run check:money`
(outbound affiliate links, tables and text identical to the old site; links visible and clickable) are the launch gate,
on the DEPLOYED site. Cut over with a Worker route (`targets.cloudflare.production.attach: "route"`), not a custom domain:
DNS unchanged, rollback = delete the route (`docs/production-cutover.md`). If the media is kept outside Git, CI sets
`AW_ALLOW_MISSING_MEDIA=1` through `scripts/media-available.mjs`: the media steps are skipped with a notice and the
build is marked undeployable; a production build ignores the switch.

**The static default has no contact form runtime, KV archive or Turnstile requirement.** The
retained `modules/contact/` code is an implementation draft that archives to KV; it is not AW's
existing-private-CRM path and has not been proven end-to-end. Do not copy/enable it unchanged.
If a site selects forms, implement same-origin `POST /api/leads` + Turnstile Siteverify + a
site-specific adapter to AW's existing private CRM; no email/Slack/Brevo notification provider is
mandatory. Astro switches to server output, but every non-API route must explicitly export
`prerender = true` and API routes `prerender = false`. Cloudflare serves static assets first and
runs only `/api/*` Worker-first; keep `not_found_handling: "404-page"`. The build refuses
`forms.choice: "private_crm"` until the site's lead API route and adapter exist and the handler
calls `submitToExistingCrm()`. The local synthetic adapter test proves routing only, not hosted
CRM or browser end-to-end behavior.

**Content pages work without JavaScript.** Keep interactive page content visible when bundles fail;
the static contact-details page remains usable without an optional form module.

**Analytics IDs are the client's own, or empty.** `src/data/site.ts` emits no tag unless both
are set, so an unset ID cannot fall back to another project's container. Never copy one in.
The rules whose failure looks like success — double-counted pageviews, a conversion sent down
two pipes, a trigger on `sent=1` that catches almost nothing — are in `docs/analytics.md`.
Read it before adding any tag.

**`package.json` records which kit this site came from.** The local AW scaffolder stamps
`websiteBuildKit.version` and the exact reviewed Git commit; the template is copied, not linked.
Do not update the stamp without actually refreshing the site's kit files.

**`npm run check:drift` says what this site is behind on.** The kit is copied, not linked, so
nothing fixed upstream arrives here. It reports and changes nothing.

**Text over a photograph is measured, not forbidden.** Declare the region in
`src/data/contrast.json` — image, box, scrim strength, text colour — and `npm run check:contrast`
composites it and fails production below 4.5:1. ⚠ **The danger is never the photograph, it is a
weakened scrim.** On a real site two of three regions could not fail at any photograph; the one
exposure was a scrim lightened from 92% to 62% so a client's photography could show its colour.
This check is what makes weakening one safe.

**Content, navigation and schemas are file-based.** `check:cms` is a safety tool for an
existing project-specific CMS configuration; this starter has no `.pages.yml` and the check is
a no-op without one. Do not add a CMS by default. Redirects remain developer-controlled in code.

⚠ **UPLOADS GO TO `media/source/`, NEVER `public/img/`.** The direction is the whole bug:
`optimize-media.mjs` **reads** `media/source/` and **writes** `public/img/`. Putting new source
images in the generated output produces files with no variants, no width/height and no manifest
entry, so `<Img>` throws. Keep editable source assets and generated media output separate.

⚠ **LEGACY KV DRAFT ONLY:** the isolated `modules/contact/` form uses a `company` honeypot and
`api/contact.ts` discards any submission that fills it in, silently and with a 200. This is not the
reusable AW `/api/leads` contract; do not copy the draft unchanged. For that legacy form, add a real
"Company" field only as `companyName`; `npm run check:form` fails on duplicate control names.

**Alt text is read as text.** `npm run check:alt` reads `dist/` and reports an alt that exists and
says nothing — a filename, a manifest key, `image`, `Photo of a…`, or one description shared by two
different pictures. axe proves the attribute is *there* and `<Img>` makes it required; **nothing read
the value**, and most of it on a finished site is typed by the client into a CMS field. ⚠ `alt=""` is
never a finding — an empty alt is how you say *this picture adds nothing, skip it*, and it is the
right answer for decoration. Warns on staging, refuses on production.

**Notes to yourself never ship.** `check:copy` reads the text a browser would show — not the
source, not comments, not `<script>` — and looks for the markers people actually leave: `TODO`,
`FIXME`, `⚠ CONFIRM:`, `Lorem ipsum`, an unrendered `{{ placeholder }}`. It warns on staging and
**refuses on production**, because a note is normal while building and unacceptable at go-live.
One shipped as body copy on a service page — *"⚠ CONFIRM: the old site advertised classes every
Saturday at 9am…"* — past clean types, clean axe and clean tells. **The question is usually real:
move it to `BUILD-STATE.md`, do not just delete it.**

**`npm audit` reports a high, and it cannot be fixed.** One advisory, in accessibility *testing*
tooling — `pa11y-ci → puppeteer → @puppeteer/browsers → extract-zip` — with **no patched version
published**. Production dependencies report **zero**, nothing under `src/` imports it, and a
production install does not pull it. `docs/dependencies.md` carries the chain, the three reasons
it cannot be fixed here, and the wording to give a client who asks. Do not answer that question
from memory, and never claim the site has "no vulnerabilities".

**Evidence, not assertions.** `npm run a11y:evidence` writes a dated pack to
`docs/a11y-evidence/` — commit it. It fills in the machine half and leaves the keyboard,
screen-reader and forms passes **blank**, because no tool does those; a pack with them still
blank is an incomplete pack, not a passing one. It also warns when `/accessibility` claims a
review date older than the run.

**`/accessibility` is a published artefact, not filler.** Required under the EAA and PSBAR,
footer-linked from every page. Keep its dates current and its known-gaps list honest — a
documented gap is worth more than a clean claim. Never write "fully compliant".

**Astro scoped styles do not reach a class passed *into* a component.** If you write
`<Icon class="thing" />` and then `.thing { … }` in the same file, it will not match. Use
`:global()`. This has caused real bugs; see `docs/traps.md`.

## Before debugging anything strange

Read **`docs/traps.md`**. Every entry failed silently — clean build, clean deploy, wrong
result. The recurring ones:

- Scoped styles not reaching a class passed into a component
- Handlers bound behind a `transition:persist` guard holding stale, replaced elements
- `justify-content: center` making overflowing content unreachable — use `margin: auto`
- `100vh` being taller than the visible area on mobile — use `100dvh`
- DNS negative caching: if `dig` and `getaddrinfo` disagree, it is your cache

## Verifying

Against the **deployed** site, not the build. A green build proves the bundler ran.

The AW launch gate is `docs/aw-migration-checklist.md`: every inventoried route resolves or has a
reviewed disposition, unknown paths return a real 404, redirects resolve, staging is noindex,
production canonicals/robots/sitemap use the verified host, acceptance is recorded and rollback
restores to the preserved WordPress origin. Forms are tested only when explicitly selected; a
notification provider is not a static-site launch criterion. See `docs/aw-migration-process.md`
for the exact command order and upload fallback.

## Handover

`docs/handover.md` is the only doc written for the **client**, not a developer. Fill in every
⚠ and render with `npm run handover`. Its "what we deliberately did not build" section is not
optional — the difference between a decision and an oversight is whether it was written down.

## Content

Start with [`AGENTS.md`](AGENTS.md), which points here for durable project conventions. `docs/content.md`
documents the Markdown frontmatter; [`docs/content-editing.md`](docs/content-editing.md) and
[`docs/new-page-brief.md`](docs/new-page-brief.md) cover the ongoing no-CMS process and new-route intake.
Posts are in `src/content/blog/`; H1, explicit `seoTitle`, and description are required and typed, so
missing metadata or a bad edit fails the build instead of silently publishing a fallback.

## Do not

- Hard-code a colour, size, phone number or business fact in a component — including inside a
  JavaScript error string, which is where one hides longest
- Ship with `--unset` still in `tokens.css`, or the scaffold home page still in place
- Add a card, hero or section style to `global.css` — it belongs to this project, not the kit
- Add a second environment flag
- Reference an image by URL instead of manifest key
- Call a third-party API before writing the submission down
- Describe unverified work as done — check it against the deployed site
- Copy an analytics ID from another project
- Claim the site is "fully accessible" or "fully compliant"
