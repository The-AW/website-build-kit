# The template

An Astro starter for AW content migrations. Static output with Cloudflare Workers Static Assets is
the default; there is no Astro adapter, contact endpoint, KV binding or Turnstile requirement.
Hosts and distinct staging/production Worker targets come from `aw-migration.json`. A site may
enable a Worker runtime only when it selects and implements the optional contact module.

Node **22.12+** (Astro's floor). `.node-version` pins **24.19.0** — the active LTS, the version it is tested on
and the one CI reads.

## The command arc

The scripts follow the shape of a job. Each one exists because the step it covers was prose in
a reference file that somebody had to remember to do.

| | Command | When |
| --- | --- | --- |
| **Before** | `npm run recon` · `npm run dns` · `npm run seo` · `npm run shots -- --before` | Capture everything you could lose, before touching it |
| **Extract** | `npm run extract` | Once, after recon — captured HTML → reviewable markdown |
| **During** | `npm run media` · `npm run tells` · `npm run check` | Continuously |
| **Building** | `npm run build:staging` · `npm run build:production` | Every deploy; hosts are manifest-derived |
| **Deploying** | `npm run deploy:staging:dry-run` · `npm run deploy:staging` · `npm run deploy:production:dry-run` · `npm run deploy:production -- --confirm-production` | Distinct generated Worker targets; production writes are explicitly guarded |
| **After** | `npm run verify -- https://…` · `npm run console` · `npm run shots -- --after` | After every deploy, staging and production |
| **Delivery** | `npm run handover` | Once, at the end |

Everything else is occasional: `cards`, `lastmod`, `indexnow`, `reflow`, `a11y`.

**The two ends matter most.** `recon` produces the URL inventory that the redirect map, the
go-live route check and week-one 404 triage all read. `verify` checks the deployed site, which
is the only thing that proves anything — every regression this kit documents was green in a
build.

## What each part is for

```
scripts/recon.mjs              inventory the OLD site → recon/urls.txt, preserved, integrations
scripts/dns-snapshot.mjs       the zone before you move it, and the diff after. MX, CAA, SPF
scripts/redirects.mjs          proposes a redirect map. never writes public/_redirects
scripts/check-alt.mjs          alt text read as text — a filename, a slug, a word
                               that adds nothing, one description on two pictures
scripts/check-contact.mjs      what the site shows against what it dials. the one
                               phone pair that cannot be derived, and a UK trunk
                               zero is not a mismatch
scripts/verify.mjs             the deployed site, as a gate. exits non-zero.
                               includes the internal link crawl and its inverse — a
                               route nothing links to — coverage against
                               recon/urls.txt, page weight and blocking counts
scripts/extract.mjs            recon/html → recon/extracted/*.md. real converter,
                               portable image paths, flags what needs a person
scripts/check-a11y.mjs         pa11y-ci at WCAG2AA, in BOTH colour schemes
scripts/lib/schemes.mjs        the scheme list, and the forced-scheme config
scripts/lib/inventory.mjs      the one parser for recon/urls.txt. paths or
                               absolute URLs; tags already-dead ones
scripts/shots.mjs              before/after screenshots, both sides off recon/urls.txt,
                               paired into shots/index.html for the handover
scripts/optimize-media.mjs     media/source → public/img as AVIF + WebP, plus a manifest
scripts/tells.mjs              what is still undecided, and design.md §3 checked mechanically
scripts/check-env.mjs          manifest host/Worker vs generated .aw/wrangler-<env>.jsonc
scripts/check-sitemap.mjs      no URL is both in the sitemap and noindex
scripts/staging-headers.mjs    X-Robots-Tag on non-production builds. refuses on production
scripts/check-reflow.mjs       WCAG §1.4.10 and §1.4.4, in a real browser
scripts/check-console.mjs      console errors + failed requests — a status check cannot see these
scripts/lib/preserved.mjs      paths other systems point at. shared by recon and verify
scripts/a11y-evidence.mjs      the dated evidence pack — machine half filled, human half blank
scripts/lastmod.mjs            per-route content dates from git → src/data/lastmod.json
scripts/og-cards.mjs           social card generator — machinery only
scripts/og-cards.config.mjs    …and the project's palette, faces and cards. Ships as a stub
scripts/indexnow.mjs           submit URLs to Bing/Yandex/Seznam/Naver. Not Google
scripts/md-to-pdf.mjs          any project markdown → PDF, in the site's own type
scripts/lib/routes.mjs         route discovery, shared. No script carries a route list
src/data/                      single sources of truth — nothing else holds these facts
  business.ts                  name, locale, phone, address, hours, areas, credentials, schema types
  nav.ts                       routes, and the one action that counts as a win
  fonts.ts                     which self-hosted faces get preloaded (empty on arrival)
  services.ts                  what you sell
  areas.ts                     service-area pages (empty unless you can write them distinctly)
  categories.ts                blog taxonomy
  site.ts                      environment derivation, analytics IDs, lead retention
  image-manifest.json          generated; do not edit
  lastmod.json                 generated by `npm run lastmod`; commit it
src/lib/                       validation, email, bindings, post helpers, lastmod reader
modules/contact/               draft-only optional contact code; not the CRM integration or E2E-proven
src/pages/api/                 empty in the static default; runtime routes are opt-in
src/pages/index.astro          a scaffold. Replace it — there is no starter home page
src/pages/accessibility.astro  the statement — a required artefact under the EAA and PSBAR
src/styles/                    tokens → prose → global → project
src/components/                header, footer, form, page opening, CTA, SEO, structured data
  EnvBadge.astro               standing non-production marker. verifies the DOM, never asserts
src/env.d.ts                   Cloudflare Workers types, so the runtime file is type-checked
tsconfig.json                  astro/tsconfigs/strict. Without it every Props interface is decorative
public/_headers                cache rules for unfingerprinted assets, plus security headers
public/_redirects              the legacy URL map. Path-only — host rules are CDN rules
docs/                          runbook, content, traps, analytics, handover
  a11y-evidence/               dated packs from `npm run a11y:evidence`. COMMIT these
.github/workflows/gates.yml    the gates that need no deployed site
.pa11yci.json                  one URL per template family, for `npm run a11y`
```

## The parts worth understanding before changing

**`aw-migration.json` and `src/data/site.ts`** — the manifest holds verified hosts, distinct
Workers and per-environment Cloudflare IDs; build/deploy guards generate and check separate
`.aw/wrangler-<env>.jsonc` files. `PUBLIC_SITE_ENV` derives indexability/canonical and analytics.
No KV namespace or lead retention applies to the static default.

**`modules/contact/` is draft-only.** The active static contact page has phone/email details, not a
form or API route. The retained API code still archives to KV; it is not AW's existing-private-CRM
adapter and has not been proven end-to-end. Do not enable it unchanged. A site-selected form must
use a same-origin API, Turnstile Siteverify and a site-specific adapter to AW's existing private
CRM. No email/Slack/Brevo notification provider is mandatory. A static migration with
`forms.choice: "none"` is not blocked by optional contact work. `npm run test:turnstile`,
`npm run test:origin` and `npm run test:form` cover helper behavior only; they do not prove CRM
delivery or end-to-end contact success.

The default CSP explicitly permits Turnstile's iframe and intentionally does not restrict scripts.
If a project adds an effective `script-src` or `default-src`, allow `https://challenges.cloudflare.com`
for the API script and frame per [Cloudflare's CSP guidance](https://developers.cloudflare.com/turnstile/reference/content-security-policy/).

**Retention is conditional on an enabled form module.** The static default has no lead store or
lead-retention field. If a site enables its private-CRM form, document the actual CRM retention and
deletion mechanism in that site's privacy terms; do not inherit the isolated KV draft's policy.

**`scripts/optimize-media.mjs`** — components reference a manifest key (`photos/hero`), never
a URL. Note the two deliberate exceptions: favicons render from the vector, and social cards
stay JPEG because Facebook and LinkedIn still will not render a WebP `og:image`. It also
**preserves manifest keys it does not own** — a generator that rewrites a shared manifest and
resets it to `{}` deletes every entry another generator wrote, silently.

**`src/styles/`** — five files. `tokens.css` is the only place a raw value is written.
`prose.css` is long-form markdown. `global.css` carries the interactive **states** (`hover`,
`focus-visible`, `disabled`, `busy`, `invalid`), never a look. `project.css` is the seam for
this project's cards, heroes and bands — it ships empty, and it exists because without it those
land in `global.css` and the next site inherits them.

`index.css` is the only one the layout loads, and it is what makes that seam hold: it imports
the kit's three into `@layer kit` and `project.css` unlayered, so **a project rule beats a kit
rule regardless of specificity.** Load order alone settled a tie and nothing more — `.on-dark
.btn` is 0,2,0 and a project's own `.btn` is 0,1,0, so the kit won and the answer was
`!important`. Measured in a browser both ways before and after.

It ships **undecided**: a grey placeholder ramp, the system stack for both faces, a `--unset`
marker, no typefaces in `public/fonts/`, and an `index.astro` that says so. This is the single
most important thing about the template — the version that shipped a green palette and a
Fraunces/Inter pairing produced sites that looked like each other.

**`.btn.btn`** in `global.css` is not a mistake. It is the same element matched twice, purely
to raise specificity above a vendor stylesheet. A chat widget once took three pages from 0
accessibility errors to failing contrast on `.btn`. It looks exactly like something a
tidy-minded person deletes.

**`scripts/tells.mjs`** — two questions. *Undecided*: are the placeholders all present (fresh
clone, fine), all gone (real project, fine), or half-cleared (someone set a colour and left the
typeface — that is the failure). *Tells*: the checkable half of `design.md` §3. No browser and
no dependency, so it runs anywhere.

**`astro.config.mjs`** — the CI guard throws when `CI` is set and `PUBLIC_SITE_ENV` is not.
Without it a bare CI build publishes `localhost` canonical tags cleanly and with no error. The
sitemap `filter` and the pages' own `noindex` are two lists that must agree; `check-sitemap`
is what keeps them honest, because `@astrojs/sitemap` decides inclusion before any page
renders and cannot know.

**`src/data/business.ts`, `schemaTypes`** — the organisation's schema.org types. Set the
subtype or leave the two generic ones. A wrong subtype is worse than none: it is a specific
claim and local classification acts on it. This shipped as `HVACBusiness` for two projects, so
every site built from the template quietly declared itself a heating company.

**`src/data/site.ts`, the `ANALYTICS` block** — emits nothing unless both IDs are set, so an
unset ID can never fall back to another project's container. `cfBeaconToken` is separate on
purpose: cookieless, and it gives real-user Core Web Vitals from the first visitor, months
before CrUX covers a new domain.

**`docs/`** — `runbook.md` (setup, verification, go-live, first week), `content.md` (editing),
`traps.md` (silent failures, seeded), `analytics.md` (the rules whose failure looks like
success) and `handover.md`. **The first four are for a developer; `handover.md` is the one the
client reads** — what they own, what it costs, what breaks if a payment fails, and what you
deliberately did not build.

## Which gates run when

| | staging | production | CI | after deploy |
| --- | :-: | :-: | :-: | :-: |
| `tells` | | ✅ placeholders only | ✅ fails at 3 tells | |
| `astro check` | | ✅ | ✅ | |
| build | ✅ | ✅ | ✅ | |
| `check-env` | ✅ | ✅ | ✅ via `build:staging` | |
| `check-sitemap` | | ✅ | ✅ no-op, staging has no sitemap | |
| `verify` | | | | ✅ |

`build:staging` deliberately runs fewer gates: a clean clone has to build green, and staging is
where you look at half-finished work.

## Deliberately not included

- **A palette.** The ramp is grey placeholder; sample the real one
- **A typeface.** `public/fonts/` is empty and neither `--font-display` nor `--font-body` names
  a face. The display/body pairing is the largest premium lever there is and it is not the
  kit's to spend
- **A home page.** `index.astro` is a scaffold. Section order comes from the archetype
- **A hero treatment.** `PageHero` is breadcrumbs, an `h1` and a slot
- **A social card design.** The generator ships; `og-cards.config.mjs` is a stub, so the kit
  carries the contrast lessons and renders nothing
- Card, band and grid styles — `global.css` carries states, not a look
- A brand overlay / preloader — a measured ~160ms of LCP, so a decision, not a default
- Page layouts beyond a contact page
- A CMS — content stays in version-controlled files; no CMS is selected and no `.pages.yml` should
  be added. Cloudflare EmDash is a future possibility only, not a current dependency.
- Any legal *content* — `src/content/legal/` ships the route, the schema and the footer
  wiring, and not one word of a policy. Nobody should inherit a privacy notice
- Testimonials, pricing, galleries — project-shaped, not skeleton-shaped

## Checklist for a new site

**Before designing routes**

- [ ] `npm run recon -- https://old-site.com` — inventory, preserved paths, integrations
- [ ] `npm run shots -- --before https://old-site.com` — the visual record, while it still exists
- [ ] `npm run extract` — captured HTML into markdown, then read the flagged pages
- [ ] Redirect map in `public/_redirects` from `recon/urls.txt`. Never to the homepage
- [ ] Sitemap filename from `recon/preserved.md` — emit at the old path or 301 to it

**Data and config**

- [ ] `src/data/business.ts` filled in, including `locale`, `timeZone` and `schemaTypes` —
      everything reads from it, and the defaults are neutral rather than correct
- [ ] `src/data/nav.ts` — the real routes, and the one action that counts as a win
- [ ] `aw-migration.json` — source URL, verified production/staging hosts, repository, per-env
      account/zone/Worker IDs, route/media inventory paths, redirect exceptions, form choice,
      acceptance criteria and rollback snapshot/WordPress origin/restore steps
- [ ] `src/data/site.ts` — the client's **own** analytics IDs (or empty); `PRODUCTION_HOSTS`
      derives from the production host in the manifest
- [ ] Content and schemas remain in version-controlled files in the site's repository; document
      the authorized editing/review workflow without adding a CMS
- [ ] Category slugs match the source CMS exactly, if this is a migration
- [ ] Do not configure a shared Worker or KV binding; scripts generate separate ignored
      `.aw/wrangler-staging.jsonc` and `.aw/wrangler-production.jsonc` configs from the manifest

**Design**

- [ ] Brand assets in `media/source/brand/`, then `npm run media`
- [ ] Tokens: real brand ramp, `--unset` deleted — contrast checked at token level, `.on-dark` too
- [ ] Two faces: woff2 in `public/fonts/`, `@font-face` in `global.css`, named in `fonts.ts`
- [ ] `src/pages/index.astro` replaced — section order from the archetype
- [ ] Privacy and terms written as `src/content/legal/*.md` — the footer links
      derive from the collection, so a page that is not written is not linked
- [ ] `npm run tells` clean: nothing undecided, fewer than three tells

**Before go-live**

- [ ] Static migrations (`forms.choice: "none"`) need no Turnstile key, Worker secret, KV archive,
      email/Slack provider or contact runtime; optional modules do not block launch.
- [ ] If `forms.choice: "private_crm"`, implement a same-origin API, Turnstile Siteverify and a
      site-specific adapter to AW's existing private CRM; test invalid/expired/replayed tokens,
      service outage, request limits, recovery and staging/production hostname behavior. The
      retained KV-only module draft is not this integration and is not proven end-to-end.
- [ ] For an enabled form only, document fields, CRM data flow, privacy/retention/deletion and
      failure ownership. Do not add Brevo by default or change root MX/mail flow as a side effect.
- [ ] `src/pages/accessibility.astro` — dates, known gaps, a contact route that works
- [ ] `.pa11yci.json` — a URL for every template family
- [ ] `public/site.webmanifest` — name and description match `business.ts`
- [ ] `npm run lastmod`, committed alongside the content it dates
- [ ] `npm run build:staging`, `npm run deploy:staging:dry-run`, `npm run deploy:staging`, then
      `npm run verify -- https://<staging-host>` green; staging remains noindex
- [ ] Only if the CRM module is enabled, run its module tests locally and against staging; do not
      interpret existing Turnstile unit tests as proof of CRM delivery or end-to-end success
- [ ] `npm run a11y` and `npm run reflow` clean, plus a keyboard pass by hand
- [ ] If required by the verified host policy, configure www → apex as a separate Cloudflare Single Redirect

**Delivery**

- [ ] `npm run build:production` and `npm run deploy:production:dry-run` green for the manifest target
- [ ] `npm run deploy:production -- --confirm-production`, then `npm run verify -- https://<production-host>` green
- [ ] `npm run shots -- --after https://<production-host>`, and the pairs looked at — a page that
      came out worse is the one thing no script can flag
- [ ] `docs/handover.md` filled in — every ⚠ — and `npm run handover`
- [ ] `BUILD-STATE.md` folded into the handover and deleted
