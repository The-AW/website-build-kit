import rss from '@astrojs/rss';
import type { APIRoute } from 'astro';
import { getPosts } from '../lib/posts';
import { business } from '../data/business';
import { site } from '../data/site';
import { renderCurrentYear } from '../lib/current-year';

export const prerender = true;

export const GET: APIRoute = async (context) => {
  // Staging must not publish a feed a reader could subscribe to.
  if (!site.indexable) return new Response('Not found\n', { status: 404 });

  const posts = await getPosts();

  return rss({
    title: `${business.name} — Insights`,
    description: business.description,
    site: context.site!,
    trailingSlash: true,
    items: posts.map((post) => ({
      title: renderCurrentYear(post.data.title),
      description: post.data.description,
      pubDate: post.data.publishedAt,
      link: `/${post.id}/`,
      categories: post.data.categories,
    })),
    customData: `<language>${business.locale.replaceAll('_', '-').toLowerCase()}</language>`,
  });
};
