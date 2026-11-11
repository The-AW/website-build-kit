# Cloudflare change runbook

Use this before changing a site's DNS, Worker domain/route, redirect rule, or certificate configuration. Cloudflare has several ways to send traffic to a Worker; switching between them by trial and error can leave duplicate DNS records, conflicting routes, or a hostname that points somewhere unexpected.

## 1. Identify the exact target and routing model

Record the site, account ID, zone ID, hostname, environment, Worker name, and intended operation in the site's release record. Choose one model for each hostname:

| Model | Worker role | DNS expectation | Use it when |
| --- | --- | --- | --- |
| Custom Domain | Worker is the origin for every path on that hostname | Cloudflare creates and manages the hostname's DNS record and certificate | The Worker serves the site directly |
| Worker Route | Worker runs in front of an existing origin | A proxied DNS record already resolves to that origin | The Worker must proxy traffic to an existing server |

Do not create both models for the same hostname. See Cloudflare's [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/) and [Routes and domains](https://developers.cloudflare.com/workers/configuration/routing/) documentation.

Decide separately how `www` behaves. It can be another Custom Domain on the same Worker, or a proxied hostname with a redirect rule to the apex. For the redirect design, verify it preserves the request path and query string. Do not create an overlapping `www` Worker domain and redirect rule.

## 2. Read and save current state before any write

Use the configured Cloudflare integration/API token or Wrangler credentials. Confirm identity with `npx wrangler whoami`; never print the token or put it in command arguments.

Read and save only the relevant state:

- account and zone identity, including the exact production versus staging zone;
- all DNS records for the apex, `www`, and any validation hostname, including type, name, content, proxy status, TTL and record ID;
- Worker custom domains and routes for both hosts;
- active deployment, version IDs and traffic percentages for the intended Worker;
- redirect rules and their order/phase;
- SSL mode and certificate status; review CAA records if certificate issuance may be affected;
- current origin target and an explicit rollback target.

Keep a machine-readable pre-change snapshot in the site repository. Do not export/import the whole zone as a shortcut. Preserve unrelated TXT verification, mail and sibling-service records.

## 3. Write down the intended delta

Before calling an API or changing the dashboard, write a short before/after table. Each row should name one resource and one exact operation.

Example first Custom Domain cutover:

| Resource | Before | Intended after |
| --- | --- | --- |
| Apex DNS | Existing proxied origin A record | Cloudflare-managed Worker Custom Domain record |
| Apex Worker mapping | None | Exact production Worker, enabled |
| `www` DNS | Proxied CNAME to apex | Preserved |
| `www` behavior | WordPress redirect | Explicit path/query-preserving Cloudflare redirect |
| Verification TXT | Present | Unchanged |

Cloudflare Custom Domains create DNS and issue certificates for the hostname. Do not manually add an A/AAAA/CNAME pointing to a guessed Worker or edge IP. If Cloudflare rejects a Custom Domain because an exact conflicting record exists, stop, read the error and current state, confirm the saved rollback target, then change only the conflicting record that the cutover requires. Preserve every unrelated record. Do not respond by adding another record of a different type.

## 4. Apply one change, then read it back

Keep the sequence small and observable:

1. Build and deploy the exact environment-specific Worker without changing production DNS unless this is the authorized first hostname attachment.
2. Before running Wrangler, inspect the selected generated config. The AW config declares the exact host as `custom_domain: true`; on a first deploy Wrangler may create the Worker mapping, DNS record and certificate in the same operation. Treat that command as the hostname cutover and do not also attach the domain through the dashboard/API. Existing releases keep the already-created mapping.
3. Read back the deployed version and traffic percentage. Confirm the intended version is at 100%, and read back Worker domains/routes and DNS. Confirm Cloudflare's managed record, proxy state, certificate status, and no overlapping route/domain.
4. If the chosen direct-upload flow did not create the hostname mapping, attach it once through its documented API/dashboard flow, then read it back. Do not repeat this step if Wrangler already attached it.
5. Add or update the `www` redirect separately if needed. Read back its expression/target/status, then request a representative deep URL with a query string and verify the exact `Location`.
6. Fetch the homepage, a deep content route, a static asset, `robots.txt`, sitemap, and unknown path from both the apex and `www` behavior. Record status, canonical host, and Worker version.

After an API error or timeout, do not blindly retry or start adding records. First GET the resource and determine whether the write partially succeeded. Compare actual state with the intended delta and continue from there. If the response names a permission issue, verify the token scope and target account/zone before changing credentials.

## 5. Roll back narrowly

Rollback is the inverse of the recorded delta, not a zone restore. Read the live state first. Remove only the site-specific Worker route or Custom Domain that intercepts the hostname, restore the exact prior DNS record and settings from the snapshot, and retain unrelated DNS, verification, mail and redirect records. Then confirm the old origin serves representative content and HTTPS correctly.

If the old origin or backup has not been independently verified, record that as unresolved in the release exception; the snapshot alone is not proof that recovery works.

## Evidence to keep

Record timestamps and IDs for the pre-change snapshot, each changed resource, the Worker deployment/version, post-change readback, smoke URLs/results, rollback steps and any exception. Never include API tokens, Turnstile secrets, upload JWTs or customer data.
