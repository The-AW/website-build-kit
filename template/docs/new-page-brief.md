# New-page brief

Use this for a new route; the site's owner may answer all fields in one message. If title or description is missing, ask for both together and offer a draft only from supplied facts. Leave project-specific values blank until verified.

| Field | Owner/editor input |
| --- | --- |
| Site/repository and current branch | |
| Page type and purpose | What should the reader do/understand? |
| Exact URL/slug | Include trailing-slash convention; note any old URL and redirect need. |
| Language/locale | |
| Visible H1 and body copy/approved outline | |
| Meta title | Required; suggestion is optional and must be approved. |
| Meta description | Required; suggestion is optional and must be approved. |
| Category/collection and navigation | Existing route(s), or explicit instruction to add one. |
| Primary image | Original/source/provenance, filename, actual dimensions, alt text or reason for `alt=""`. |
| Author and dates | Real author/profile and actual publication/modification time, only where relevant. |
| Internal links | Existing routes to link to/from; do not use guessed paths. |
| Indexability | Indexable by default? If not, why and for how long? |
| Structured data | Explicit page type and each required fact/source; omit unsupported types/properties. |
| Product/affiliate facts | Only owner-approved products, destination URLs, disclosure and existing site-specific tracking config. |
| Review/acceptance | Who confirms final copy, metadata, image and route? |

**Before merge:** confirm the source file and route loader, collection/navigation/sitemap inclusion, self-canonical from the active host, metadata, schema-to-visible-content consistency, local image resolution/alt, internal link targets and expected indexability. Record build/check commands and release owner in the PR. Do not publish or delete/redirect routes without the site's authorized release owner and explicit disposition.
