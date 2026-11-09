# Optional contact runtime (work in progress)

The base AW scaffold is static and has no form endpoint, Turnstile key, Worker runtime, or KV binding. Do not copy this draft into an AW site or describe it as end-to-end proven.

The current reusable endpoint contract is same-origin `POST /api/leads`, server-side Turnstile Siteverify, then the site's adapter for AW's existing private CRM. With `forms.choice: "private_crm"`, Astro's adapter runs only explicitly on-demand API routes; content pages stay prerendered and `/api/*` is routed Worker-first. Email, Slack, Brevo, and a KV archive are not required notification transports.

The files in this directory still contain the previous KV-archive implementation at the older `/api/contact` path. They are retained for reference only and are not the approved AW CRM integration. Do not copy them into a site or claim the CRM/browser flow is proven. The kit's synthetic local adapter test proves only that the API route is routed by the Worker.

A site may enable contact runtime only after implementing and reviewing its private-CRM adapter, request limits, error/recovery behavior, privacy/retention terms, and staging/production tests. The migration manifest must record `forms.choice: "private_crm"` and the adapter path. The build/deploy guard refuses the unchanged KV-only draft.
