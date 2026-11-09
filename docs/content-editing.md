# File-based content editing standard

Use this process in every migrated website repository because a CMS is not assumed. The site repository is the content system: the source files, routes, media and site-specific instructions must be clear enough for the owner and the next editor to maintain them safely.

## Start with the repository, not a guessed file format

Before editing, read that site's `AGENTS.md`, existing `CLAUDE.md`, `README.md`, content guide and release notes. Inspect the route renderer and loader, then locate the requested route in the actual source files. A WordPress migration may preserve JSON page records, HTML fragments, TS/JS data, Markdown, or another typed collection; do not assume Markdown because the starter template uses it.

Confirm the exact URL, corresponding source record, shared site configuration, media handling, route/collection inclusion, canonical generation, sitemap and deploy owner. If the repo is not clear, write a project-specific guide first; do not wholesale copy the kit template over a site's content, design or production configuration.

## Routine edit versus new page

For an existing page, preserve its title, meta description, author, dates, canonical, schema, hierarchy, image order/alt text, internal links and affiliate settings unless the owner requests a change. Ask only about a material ambiguity; do not interrupt a simple typo fix with a full brief.

For a new page, use the site's `docs/new-page-brief.md` (or equivalent). Ask once for any missing essentials in one concise grouped request; offer proposed meta-title and meta-description drafts only if the owner wants suggestions based on supplied facts. Do not publish blank or invented metadata. Confirm the page type, language, purpose, exact slug, visible H1/body, SEO title and description, image/alt, real author/dates where relevant, internal links/navigation/collection, indexability and any required supporting facts.

A page must be included in the correct route collection and, where appropriate, navigation and sitemap. A canonical is derived from the active environment host and the page's own route, not a stale copy-pasted host. A URL change requires a reviewed redirect from the old URL plus internal-link updates; never redirect all unknown paths to the homepage. A page deletion needs an explicit disposition before the route is removed.

## Images

Keep owner-supplied originals and provenance. Use the site's declared media pipeline and source directory, not generated output, for new originals. Record the approved source, meaningful filename, intrinsic dimensions, aspect ratio and alt text; an intentionally empty alt is valid only for a decorative image. Verify every placement, including repeated placements and responsive sources, in built output. Do not hotlink arbitrary external media, replace a missing product image with an invented one, strip required affiliate IDs, or alter owner files where preservation was specified.

If the migrated repo has no media pipeline, say so in that site's guide and choose a documented local asset path without silently adding a new optimizer. Do not assume the starter's `media/source/` convention exists in an archive repo.

## Structured data

Choose schema from the page type and the site's verified public identity; never infer a business, author, address, rating, price or rich-result eligibility from a keyword. An editorial article may use `Article` or `BlogPosting` when it is actually editorial content; ordinary pages use a suitable `WebPage` type; breadcrumbs must match actual visible hierarchy. `Product`, `Review`, `FAQPage` and `LocalBusiness` are opt-in only when the relevant content and required facts are real, present and visible. Omit missing properties and nonexistent image URLs. Preserve meaningful archived schema by default; correct legacy schema only in a scoped, reviewed change.

A deterministic owner-defined metric belongs in a site-specific opt-in config with provenance and a tested calculation; it is not a default for all migrated sites. Do not equate a formula or URL-length estimate with real votes/ratings. Schema.org vocabulary validity is different from eligibility under Google Search Central's rich-result policies. See [Article structured data](https://developers.google.com/search/docs/appearance/structured-data/article), [structured-data policies](https://developers.google.com/search/docs/appearance/structured-data/sd-policies), [Review snippets](https://developers.google.com/search/docs/appearance/structured-data/review-snippet), [Schema.org Article](https://schema.org/Article) and [Schema.org AggregateRating](https://schema.org/AggregateRating).

## Review and release

Edit source files, not `dist/` or generated assets. Keep the diff focused, run the repository's real content/schema/build tests, inspect the built route and record exact commands and results in the PR. Checks should fail on blank new-page metadata, malformed/contradictory new schema, duplicate routes, broken local assets/internal links, wrong canonical and unintended `noindex`—while limiting new strict rules to touched/new content so unrelated legacy migration debt is not rewritten incidentally. Title/description length guidance is advisory, not a made-up hard Google limit.

Do not publish from a content PR. Use the site's documented sole release owner and release procedure after merge; validate the latest main/master SHA and environment before any authorized deployment. A successful local build or a Wrangler dry-run is not a live release.

## Sites already copied from the kit

The kit is copied and version-pinned; future commits do not flow into an already-scaffolded or in-flight site. Adoption is deliberate: compare the reviewed kit commit, add only the reusable guide/template/checks that fit the site's actual architecture, and preserve its `CLAUDE.md`, content records, design, assets, site facts, secrets, Worker settings and deploy boundaries. Update its pin/status documentation only after the owner approves the tested change. Never replace a site's project-specific files with the generic template.

The template implementation of this standard is [template/docs/content-editing.md](../template/docs/content-editing.md); use it for the starter's Markdown collections only. Migrated repositories must adapt it to their real source model, as Mae does with JSON records.
