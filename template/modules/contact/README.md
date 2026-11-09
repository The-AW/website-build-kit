# Optional contact runtime (work in progress)

The base AW scaffold is static and has no form endpoint, Turnstile key, Worker runtime, or KV binding. Do not copy this draft into an AW site or describe it as end-to-end proven.

The intended AW form path is a same-origin API route, server-side Turnstile Siteverify, then the site's adapter for AW's existing private CRM. Email, Slack, Brevo, and a KV archive are not required notification transports. The existing files in this draft still contain the previous KV-archive implementation; they are retained for reference only and are not the approved AW CRM integration.

A site may enable contact runtime only after implementing and reviewing its private-CRM adapter, request limits, error/recovery behavior, privacy/retention terms, and staging/production tests. The migration manifest must record `forms.choice: "private_crm"` and the adapter path. The build/deploy guard refuses the unchanged KV-only draft.
