import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';
import { categoryByName } from './data/categories';
import imageManifest from './data/image-manifest.json';

const manifest = imageManifest as Record<string, { src: string }>;

/**
 * Blog posts. The schema is strict on purpose: a bad edit fails the build
 * rather than shipping a page with a missing title or a broken date.
 */
const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z.string().trim().min(1),
    /** Required <title> distinct from the H1; length guidance is advisory. */
    seoTitle: z.string().trim().min(1),
    /** No hard character limit: use search-preview guidance, not a guessed Google limit. */
    description: z.string().trim().min(1),
    publishedAt: z.coerce.date(),
    updatedAt: z.coerce.date().optional(),
    /** Portable reference into public/img — never an absolute CDN URL. */
    image: z.string().trim().min(1).refine((key) => Boolean(manifest[key]), 'must match a generated media manifest key').optional(),
    imageAlt: z.string().optional(),
    categories: z.array(z.string().trim().min(1)).min(1).refine(
      (items) => items.every((name) => Boolean(categoryByName(name))),
      'each category must exactly match a name in src/data/categories.ts',
    ),
    focusKeyword: z.string().optional(),
    author: z.object({
      name: z.string().trim().min(1),
      type: z.enum(['Person', 'Organization']).optional(),
      url: z.string().trim().min(1).refine(
        (value) => value.startsWith('/') && !value.startsWith('//') || /^https:\/\//i.test(value),
        'must be a root-relative profile route or HTTPS URL',
      ).optional(),
    }).optional(),
    draft: z.boolean().default(false),
  }).superRefine((post, context) => {
    if (post.image && !post.imageAlt?.trim()) {
      context.addIssue({ code: 'custom', path: ['imageAlt'], message: 'a featured image requires meaningful, nonblank alt text' });
    }
    if (post.updatedAt && post.updatedAt < post.publishedAt) {
      context.addIssue({ code: 'custom', path: ['updatedAt'], message: 'must not be earlier than publishedAt' });
    }
  }),
});

/**
 * Legal and policy pages — privacy, terms, house rules, cookie notice.
 *
 * One markdown file each, rendered through one route, so three near-identical
 * page files never get written and an editor can change an effective date
 * without a developer. Empty in a fresh template: it emits no routes until
 * somebody adds a file, which is why shipping it costs the template no pages.
 *
 * ── DATES ARE STRINGS HERE, DELIBERATELY ───────────────────────────────────
 * `z.coerce.date()` turns `2026-08-21` into 2026-08-21T00:00:00**Z**, and
 * formatting that instant anywhere west of Greenwich renders **20 August** —
 * measured: US Pacific and US Eastern both shift it, London and Tokyo do not.
 * So a legal page's effective date is correct on a European laptop and a day
 * early off a US CI runner, with nothing anywhere to report it.
 *
 * An effective date is a CALENDAR DATE, not an instant. Keeping it a string
 * removes the class of bug rather than handling it. `formatLegalDate` in
 * lib/legal.ts renders it, pinned to UTC.
 */
const isoDate = z
  .preprocess(
    /*
     * ⚠ ASTRO'S FRONTMATTER PARSER RETURNS A **Date** FOR AN UNQUOTED
     * `2026-08-21`, not a string — which is where this whole class of bug
     * starts, and it is invisible until something formats it. Editors write
     * dates unquoted because that is the natural thing to write, so accept
     * both and normalise to the UTC calendar date immediately. After this
     * point the value is a plain string and cannot drift again.
     */
    (value) => (value instanceof Date ? value.toISOString().slice(0, 10) : value),
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD')
      /* The regex accepts 2026-13-45. Confirm it is a date that exists. */
      .refine((v) => new Date(`${v}T00:00:00Z`).toISOString().startsWith(v), 'not a real date'),
  );

const legal = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/legal' }),
  schema: z.object({
    title: z.string().trim().min(1),
    description: z.string().trim().min(1),
    /** The date the terms took effect. Shown on the page. */
    effective: isoDate,
    /** Only when it has genuinely changed since. Omit otherwise. */
    updated: isoDate.optional(),
    /** Footer link text, when the title is too long for it. */
    navLabel: z.string().max(40).optional(),
    /** Footer ordering, low first. Ties fall back to the title. */
    order: z.number().default(50),
    /** A page that must exist and must not be indexed — rare, but real. */
    noindex: z.boolean().default(false),
  }),
});

export const collections = { blog, legal };
