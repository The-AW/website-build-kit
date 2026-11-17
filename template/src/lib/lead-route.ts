/**
 * The Astro route for `forms.choice: "d1_leads"`. A site enables it with one two-line file,
 * src/pages/api/leads.ts:
 *
 *     export const prerender = false;
 *     export { POST } from '../../lib/lead-route';
 *
 * It lives here, not in src/pages, so a static site (forms.choice "none") never has an on-demand
 * route, which Astro refuses to build without an adapter. The logic is src/lib/lead-api.ts.
 */
import type { APIRoute } from 'astro';
import { bindings } from './runtime';
import { handleLeadPost } from './lead-api';

export const prerender = false;

export const POST: APIRoute = ({ request, clientAddress }) => handleLeadPost(request, bindings(), clientAddress);
