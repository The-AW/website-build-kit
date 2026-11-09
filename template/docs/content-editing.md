# Editing file-based content in the starter

This starter has no CMS. Its default blog and legal content are Markdown collections, while navigation, business facts and presentation remain in separate typed source files. A migrated project may use a different model; follow that project's own guide rather than moving its content into Markdown.

## Where to edit

| Content | Source of truth | Notes |
| --- | --- | --- |
| Blog articles | `src/content/blog/<slug>.md` | Frontmatter schema: `src/content.config.ts`; page route renders from the collection. |
| Legal/policy pages | `src/content/legal/<slug>.md` | Effective dates are calendar-date strings; the route checks for page-name collisions. |
| Main navigation and primary CTA | `src/data/nav.ts` | Use a route that exists; do not hard-code a second nav list in a page. |
| Business facts/contact details | `src/data/business.ts` | Shared visible UI and schema inputs; fill only owner-verified facts. |
| Services/categories | `src/data/services.ts`, `src/data/categories.ts` | These are source data, not generated `dist/` files. |
| Original media | `media/source/` | Run `npm run media`; generated AVIF/WebP/JPEG variants and manifests go under `public/img/`. |
| Page-specific design | `src/pages/`, components, project styles | Keep styling in the site project, not the generic content guide. |

To find a page by slug, check the route file and collection loader rather than searching `dist/`:

```sh
rg -n 'slug|title|description' src/content/blog src/content/legal src/pages src/content.config.ts
```

## New-page intake

Use [`new-page-brief.md`](new-page-brief.md). Collect the site/repository and exact route, page type and purpose, language, visible H1/body, meta title and description, image source/provenance/alt and dimensions, real author and dates where relevant, category/navigation/internal links, indexability and any schema facts that need evidence. Ask for missing required meta title or description together once; offer drafts from supplied facts if requested. The schema requires a nonblank H1, meta title and description, while title/description length guidance stays advisory rather than an invented Google character limit.

Add a blog post as a new `.md` file under `src/content/blog/` using the current frontmatter schema. Add a legal page under `src/content/legal/` only when it is genuinely a policy/legal document. A route change requires an exact redirect and internal-link update; deletion needs an explicit destination/410 decision. Keep drafts marked `draft: true`; do not use `noindex` as a substitute for review.

## Metadata and schema

Use the matching page type and `src/components/StructuredData.astro`. A blog post may use `BlogPosting` when it is truly editorial content; the generic Organization node is not automatically `LocalBusiness`, and a Person author is emitted only when that author is explicitly supplied. A subtype such as `LocalBusiness`, `Product`, `Review` or `FAQPage` requires the real visible facts and evidence for that page. Missing organization fields and unavailable image URLs are omitted. Breadcrumbs must match the page's actual route hierarchy. Preserve meaningful migrated schema unless a scoped correction is approved.

Schema.org syntax being valid does not guarantee a Google rich result. See [Google Article structured data](https://developers.google.com/search/docs/appearance/structured-data/article), [structured-data policies](https://developers.google.com/search/docs/appearance/structured-data/sd-policies), [Review snippet policies](https://developers.google.com/search/docs/appearance/structured-data/review-snippet), [Schema.org Article](https://schema.org/Article) and [Schema.org AggregateRating](https://schema.org/AggregateRating). Never fabricate a business, person, date, price, review, rating count or quote. If an owner opts into a custom metric, keep its formula and provenance site-specific; do not emit formula-derived estimates as actual `AggregateRating` data.

## Images and internal links

Place originals in `media/source/`, give each a meaningful filename, record its source/provenance and meaningful alt, then run `npm run media`. Reference generated media by its manifest key through `<Img />`, not by an external URL or a hand-written `public/img/` path. An empty `alt=""` is correct only when the image is decorative. The generated `dist/` and `public/img/` are output, not source locations.

Use root-relative links for internal routes, confirm the target exists, and add new navigation only when the page belongs there. External images/hotlinks are not a substitute for a missing local asset. Preserve required client affiliate settings; do not copy them from another site.

## Checks and PR

Run from the site root:

```sh
npm run check
npm run check:copy
npm run check:alt
npm run check:sitemap
npm run build:staging
npm run deploy:staging:dry-run
```

For HTTP-level route, internal-link and local-asset checks before a PR, build staging and run the static preview in one terminal, then `verify` from another:

```sh
# Terminal 1 (leave running)
npm run preview -- --port 8788
# Terminal 2
npm run verify -- http://localhost:8788
```

The local run intentionally warns that its canonical points at the built staging host; the route and link/asset checks still run. `verify` against the deployed staging URL is the final environment check after the authorized release owner publishes. The kit PR workflow also runs `npm ci`, `npm run test:content` (a temporary article with refusal fixtures, cleaned up afterward), a clean staging build, Astro types, design tells, sitemap/noindex checks and the kit refusal tests. Run the site's own tests if present. Inspect the built route for its canonical, metadata, schema, local media and indexability. Do not deploy from a content-editing PR; the site's documented release owner validates latest main/master and handles any approved release. A dry-run does not publish.

## Existing migrated sites

This Markdown path is the starter's model, not a mandate for every project. For an already-scaffolded or in-flight site, check its `AGENTS.md`, durable `CLAUDE.md`, README, route loader and current source format. The kit is copied and pinned, so changes do not arrive automatically. Adopt only the relevant guide/checks in a focused change, then test against that site's real model; never overwrite its content, configuration, design, assets, release owner or existing instructions.
