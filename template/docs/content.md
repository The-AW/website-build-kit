# Editing content

Everything here is a file in the repo. A bad edit **fails the build** rather than the page —
that is deliberate, and it means a broken page can never reach visitors.

---

## Where things live

| Change | File |
| --- | --- |
| Phone, address, hours, service areas, credentials | `src/data/business.ts` |
| What you sell | `src/data/services.ts` |
| Service-area pages | `src/data/areas.ts` |
| Blog categories | `src/data/categories.ts` |
| A blog post | `src/content/blog/<slug>.md` |
| Privacy, terms, house rules | `src/content/legal/<slug>.md` |
| Images | `media/source/…`, then `npm run media` |
| Colours, fonts, spacing | `src/styles/tokens.css` |

**`business.ts` is the single source.** The header, footer, every call to action and the
structured data all read from it. Change the phone number there and it changes everywhere —
including what Google reads. Never type a phone number into a page.

**Legal pages write themselves into the footer.** A file at
`src/content/legal/privacy.md` is served at `/privacy/` and linked in the footer automatically —
add the file and the link appears; delete it and the link goes. There is no list to keep in
step, which is the point: a footer link to a page nobody wrote yet is a 404 on *every* page of
the site and nothing reports it.

Each one needs a nonblank `title`, `description` and `effective` (the date the terms took effect, as
`YYYY-MM-DD`). Add `updated` only when it has genuinely changed, `navLabel` when the title is
too long for a footer, and `order` to move it in the row. Changing an effective date is editing
one line of frontmatter — no developer.

---

## Writing a post

Create `src/content/blog/my-post.md`. The filename is the root-level URL slug (`/my-post/`);
published posts render through `src/pages/[slug].astro` and appear in the RSS feed. Draft posts
are excluded from both. The route fails the build if a slug collides with a legal page or static route.

```markdown
---
title: 'What a pre-purchase survey actually covers'
seoTitle: 'What a pre-purchase survey covers | Example Business' # required <title>; length guidance is advisory
description: 'One sentence that accurately describes this article and its value to a reader.'
publishedAt: 2026-08-02 # a calendar date, kept stable across time zones
categories: ['Tips']
image: 'blog/example-post'          # a manifest key, never a URL or a path
imageAlt: 'A surveyor recording a reading'
author:
  name: 'OWNER INPUT: verified author name'
  type: 'Person'                    # optional; Person is the default
  url: '/about/author/'             # optional, real root-relative profile or HTTPS URL
draft: false
---

Body in markdown. Start with the answer, then explain it.

## Real headings, in order

Never skip a level to get a size — heading level is structure, size is a token. `h4` because
it "looked right" breaks the document outline for anyone using a screen reader.
```

**The frontmatter is typed and validated at build time** (`src/content.config.ts`). Missing or blank
H1, SEO title or description, malformed dates, an unknown category, a missing manifest image key,
missing image alt, or an update date earlier than publication fails the build with the file and
field named. Length guidance for title and description is advisory; there is no hard Google character limit.

- `draft: true` keeps it out of production entirely
- every `categories` value must match a `name` in `categories.ts` exactly
- `image` is a manifest key — see below
- `author` is optional; include only a real, owner-approved visible author
- `updatedAt` is optional; omit until the article has actually been updated

---

## Images

```bash
cp ~/Desktop/new-photo.jpg media/source/blog/example-post.jpg
npm run media
```

Then reference the **key**, not a path: `image: 'blog/example-post'`.

The pipeline emits a modern format at several widths, plus a JPEG social twin for anything used
as an `og:image`, plus a dimensions manifest so every `<img>` carries `width` and `height` and
nothing shifts as the page loads.

- **Never reference an external URL.** Hotlinked stock images rot — two Pexels URLs referenced
  by articles had already 404'd at source on the last migration
- **Brand assets copy byte-for-byte.** Do not run logos through the photo pipeline
- **Cap source images at ~2400px.** True camera originals belong outside version control
- **Write real alt text**, or `alt=""` if the image is decorative. An empty alt is correct far
  more often than people expect; a filename never is
- **Check for duplicate covers.** Ten of seventeen posts sharing one photo reads as a broken
  page, and nobody notices while writing

---

## Adding a service or a service area

Both are template + data: add an entry, the page generates.

**A service area is different.** Only add a place you can describe **distinctly** — which
authority issues the permit, what the housing stock is, what actually drives demand there.
Pages differing by nothing but the town name are doorway pages and can be penalised. A place
you cannot write about distinctly still belongs in `business.serviceAreas`; it just does not
get a page.

---

## Accessibility, when writing

The build cannot check these. They are the ones that matter and the ones that slip.

- **Headings in order.** Structure, not size
- **Link text that makes sense alone.** "Read more" is meaningless in a screen reader's link
  list; "read the compliance guide" is not
- **Alt text that says what the image conveys**, not what it depicts. If it conveys nothing,
  `alt=""`
- **Do not describe by position or colour.** "The button on the right", "the green box"
- **Expand an abbreviation on first use.** Assume no prior knowledge
- **Update `/accessibility`** — the statement is dated, and an undated statement reads as
  abandoned. If you know of a gap, name it there. A documented gap is worth more than a clean
  claim

---

## Publishing

Use [the content-editing process](content-editing.md) and [new-page brief](new-page-brief.md).
Do not push a content change directly to a tracked deployment branch.

```bash
npm run check
npm run check:copy
npm run check:alt
npm run check:sitemap
npm run build:staging
npm run deploy:staging:dry-run
```

Open a focused PR with the changed source, route, image provenance, exact checks, and any redirect
or navigation impact. Inspect the built article's title/description, self-canonical, Article JSON-LD,
author, image/alt and route. The site's authorized release owner handles publication after review;
the dry-run does not publish. To inspect a local staging build first:

```bash
npm run build:staging
npm run preview -- --port 8788                 # terminal 1; serves dist locally only
npm run verify -- http://localhost:8788         # terminal 2; routes, internal links and local assets
```

If the build fails, **read the error** — it names the file and the field. It has caught a real
mistake, not invented one.
