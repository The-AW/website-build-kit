# Production cutover — a Worker route over the existing record

The cutover for a migration whose hostname **already serves the old site**. The default is **option A**:
a zone Worker route `<host>/*` over the existing proxied DNS record. DNS does not change, and
**rollback is deleting the route**: the old origin answers again within seconds. Generalised from the
Itens de Casa cutover (a WordPress site on a shared Cloudways server, 615 posts); every step names its
readback, and a failed or ambiguous readback stops the cutover.

Use it with [`aw-migration-checklist.md`](aw-migration-checklist.md) (what must be true) and
[`aw-migration-process.md`](aw-migration-process.md) §3 (the commands). This file is the order of
operations in the window and the way back out.

## 1. How the Worker takes the hostname

| | Worker route ✅ (`attach: "route"`) | Custom domain (`attach: "custom_domain"`, the config default) |
|---|---|---|
| DNS | **Unchanged.** The proxied A/CNAME to the old origin stays | Cloudflare **replaces** the hostname's record with a Worker record; it refuses while the old record exists unless asked to override |
| Cutover | The deploy that carries the route is the switch | Deploy, then the domain attaches and overrides the record |
| Rollback | `DELETE` the route. Edge effect in about 30 s, no resolver wait | Delete the domain, then **recreate** the proxied record. Between the two the hostname has no record, and a resolver that asks in that gap caches NXDOMAIN for the zone's SOA negative TTL, as much as 30 minutes |
| Token rights | Workers Routes: Edit | Workers Routes + **DNS: Edit** (a Wrangler OAuth token usually has no DNS rights) |
| Use | Cutting over a hostname that already exists. **The default for a migration** | A new hostname with nothing behind it (staging) |

Set it per environment in `aw-migration.json`:

```json
"targets": { "cloudflare": { "production": { "accountId": "…", "zoneId": "…", "attach": "route" } } }
```

The generated `.aw/wrangler-production.jsonc` then carries exactly one route
`{ "pattern": "<host>/*", "zone_id": "<zone>" }`, and `build:production`, `check-env` and
`deploy:production` refuse any other route, another zone, or a custom domain in its place. Staging keeps
the custom domain. `workers_dev` and `preview_urls` stay `false`.

⚠ The route sits **in front of** the old origin for every path on that host: anything the new site does
not answer, it must answer for itself (a real 404, the redirect map), because it will not fall through to
the old server. If some paths must keep going to the old origin, they need a narrower route pattern.

## 2. Prerequisites (before the window)

1. **Acceptance recorded** in `aw-migration.json` (`acceptance.criteria`, `recordedBy`, `recordedAt`), and
   the checklist's blocking items green on the **deployed staging** site, not the build.
2. **Money pages** (affiliate and product-roundup sites): both launch gates pass on deployed staging, §6.
3. **Prestate snapshot, read-only**, committed to the site repository (`rollback.snapshotPath`), with the
   exact restore steps in `rollback.restoreSteps`. Read back:
   - the zone's Workers routes (`GET /zones/<zone>/workers/routes`) and custom domains;
   - the Worker list, confirming the production Worker is absent (or its current version);
   - the proxied DNS record for the host: its ID, type, content and proxied flag. **Record the ID**:
     the old origin's address lives only here;
   - public DNS for the host, the apex and `www` (`npm run dns -- <domain>` captures MX and TXT too);
   - a fresh **uncached** GET of `/` and one deep page through Cloudflare, confirming the old site answers
     (`curl -s "https://<host>/?cb=$RANDOM" -o /dev/null -w '%{http_code}'`). The direct origin IP may
     time out from a build machine; the uncached GET through Cloudflare is the evidence that matters.
4. **Production build and dry run are clean** (no Cloudflare writes):
   ```bash
   npm run build:production
   npm run deploy:production:dry-run
   ```
   Check the route, the file count against the plan cap, `workers_dev`/`preview_urls` false, no `noindex`,
   production canonicals, robots and sitemap on the production host, and no test-only vars.
   The dry run also prints **"a real deploy would refuse"** when the checkout is not `origin/<default branch>`.
   Clear that before the window (§3.3), not in it.
5. **Other domains** that point at the old server are inventoried (§8). Do this *before* the window; it is
   the step that decides whether the old server can ever be retired.
6. **A second person or a written go**, one release candidate, **one live writer**. Pick a low-traffic hour.
   Free disk on the build machine for a large media set.

## 3. Steps (inside the window)

1. **Re-read the prestate** (§2.3). Stop if anything differs from the snapshot.
2. **Create the contact resources now and not before**, if the site has a form (`forms.choice`
   `d1_leads`: the shared production lead database (never a new one) and the group's shared Turnstile widget with the site's root domain on it,
   a rate-limiter namespace; production opens only with `forms.productionEnabled` and a recorded
   acceptance). Then `npm run build:production` and the dry run again.
3. **Merge to the default branch, push, then deploy from it.** Merge the release PR on GitHub, then:
   ```bash
   git switch <default> && git pull --ff-only     # <default>: git ls-remote --symref origin HEAD
   git status --short                             # prints nothing
   ```
   `deploy:production` refuses unless the tree is clean, `git fetch origin` succeeds and `HEAD` **equals**
   `origin/<default>`, and says what to run instead. It refuses a checkout ahead of origin (unpushed), behind it
   (a rollback past merged work) or beside it (an unmerged PR). Never deploy production from a feature or
   migration branch: the next deploy from the default branch silently undoes it. That is how a contact form stayed
   dead for five days on a site whose every check was green (audit, 2026-11-23).
   `--allow-unmerged "<reason>"` is the emergency escape only. It deploys, warns, and appends the reason, commit
   and date to `BUILD-STATE.md`; the go-live stays **open** until a deploy from the default branch replaces it.
   Every deploy, staging too, is stamped `--tag <short sha> --message "<branch> <sha>"`, so
   `npx wrangler versions list --name <worker>` shows which commit is live.
4. **Deploy.** `npm run deploy:production -- --confirm-production`. With `attach: "route"` **this deploy is the
   switch**: the route goes live with the upload; DNS is untouched. Read back the route ID, version ID and
   deployment ID and write them down now. If Wrangler's bulk asset transfer fails, use the direct-upload API
   path in the process doc §4 and create the route only after the version is active.
5. **Secrets** (form sites): set `TURNSTILE_SECRET_KEY` and `LEADS_RATE_LIMIT_HMAC_SECRET` on the Worker
   (pasted or piped, never echoed or committed). Until they are set the form answers "unavailable" and the
   rest of the site is unaffected. Read bindings and secrets back **by name only**.
6. **Smoke test** (§4), inside the first five minutes. **Any red: roll back (§5), then investigate.**
7. **Record** the route ID, version and deployment IDs, release SHA and time in the site's `BUILD-STATE.md`, and get
   that commit onto the default branch (a commit that touches only records changes nothing that is deployed).

**The go-live is done only when production equals `origin/<default>`**: the live Worker version's tag is a commit
on `origin/<default>`, `git diff --stat <tag> origin/<default>` shows nothing but records such as `BUILD-STATE.md`,
and no `--allow-unmerged` record in `BUILD-STATE.md` is still open. "Deployed from a branch, PR open" is not done.

## 4. The five-minute smoke test

Run from a machine that is not the build machine if you can. Each line is a command with an expected answer.

| Check | Expect |
|---|---|
| `npm run verify -- https://<host>` | exits 0, reading as **production** |
| Home, one post, one category, one archive, the contact page, an HTML sitemap | 200, production canonical, **no** `noindex`, no staging badge |
| A path that cannot exist | a real **404** (status, not just a 404-looking page) |
| A sample of the redirect map, and an attachment or old URL | **301**, one hop, to the final target |
| A sample of images, an old `.png`/`.jpg`, a `-WxH` variant | 200 `image/webp` `immutable`; the old URLs 301 in **one hop** to the WebP |
| `http://<host>/<path>?x=1` | **301** to `https://<host>/<path>?x=1` (`verify` checks this; §7) |
| `robots.txt` and the sitemap | on the production host; `Sitemap:` named |
| Money pages (affiliate sites) | 200, the affiliate links present: `npm run check:money` against the source |
| The contact page (form sites) | renders with the Turnstile widget; a **bad** request is refused (`npm run verify` probes without creating a row) |
| `npm run console -- https://<host>` | no console errors, no failed requests |

## 5. Rollback

Decide fast. If a smoke check fails and the cause is not obvious within ten minutes, roll back first.

| Situation | Action | Takes effect |
|---|---|---|
| A new release is bad and the previous Worker release was good | `npx wrangler rollback <previous-version-id> --name <worker>` | Seconds; the hostname stays on the Worker |
| Back to the old site (route) | `DELETE /zones/<zone>/workers/routes/<route-id>` (the ID from §3.4) | About 30 s at the edge. No DNS change, no resolver wait, about 2 minutes by hand |
| Back to the old site (custom domain) | Delete the custom domain, **then** recreate the proxied record from the snapshot | Edge in about a minute once the record exists; resolvers that cached NXDOMAIN wait up to the SOA negative TTL |

After any rollback to the old site: read back the route list (and DNS, for a custom domain); `curl` the home
page and a deep page and confirm the **old** markup; record the time and the reason. Keep the old origin
**running and unchanged** for the whole recovery window (at least 30 days): the rollback depends on it.
Retiring it is a separate decision (§8).

## 6. Launch gates for an affiliate site

A product-roundup site earns on the links, so two gates sit in front of the cutover on top of the checklist
(`archetypes.md` §Affiliate roundups):

```bash
npm run lcp -- https://<staging-host> /roundup-one/ /roundup-two/ …          # observed LCP <= 500 ms median, CLS < 0.1, 1440 and 390 px
npm run check:money -- https://<staging-host> /roundup-one/ /roundup-two/ … --source https://<old-site>   # conversion parity
```

Run both on **deployed** staging and again on production in the smoke test. Any conversion difference is a
stop, not a note. On the migration these came from, eight money pages measured 332–488 ms median LCP at 1440
px and 332–408 ms at 390 px (CLS ≤ 0.011), with every affiliate href, `rel`, `target`, button, price and table
cell identical to the source.

## 7. `http://` must 301 to `https://`

The old origin probably did this, so nobody checks. **A Worker route does not**: Cloudflare hands plain http to
the Worker, the Worker serves the page, and `http://<host>/<any path>` answers 200. On the migration this came
from that was found by the post-launch audit, not by the smoke test, because every https check was green.
`npm run verify -- https://<host>` now fails on it.

The fix is **one rule, not a zone setting** (flipping "Always Use HTTPS" zone-wide also changes every other
hostname in the zone): a Single Redirect rule

```
when   (http.host eq "<host>" and not ssl)
then   301 to  concat("https://<host>", http.request.uri.path)   with "preserve query string" on
```

Record the ruleset ID and its removal in the site repository. Rolling it back is deleting the rule.

## 8. Other domains that point at the old server

Before the old server is retired, inventory **every other domain that points at it**. A shared server often
carries the client's old brand names, typo domains and vanity domains, and each is a stream of visitors and
links that stops working the day the server goes.

1. List every candidate: `npm run dns -- <domain>` for each known domain; the server's own virtual hosts;
   the registrar and DNS account for lookalikes; search-console properties. Record each domain, its zone,
   its current records and **its MX/TXT** (mail on the same domain is a separate decision; do not touch it).
2. Decide per domain: **301 to the new site** (the default for anything with inbound links or brand value), keep, or let lapse.
3. Put the redirects **at the edge**, as Cloudflare Single Redirect rules in each domain's own zone, not on the
   old server: [sops/301-redirects-the-aw](https://github.com/The-AW/seo-sops/tree/HEAD/sops/301-redirects-the-aw)
   in The-AW/seo-sops has the rule shapes and the API calls, and the **Cloudflare token permissions table** to
   create them (the rights are per zone: Single Redirect / Rulesets edit, plus Zone Settings read for the http→https
   rule, and DNS edit only if a record changes). A Wrangler OAuth token usually lacks the rulesets scope, so
   expect a 403 and have the right token ready.
4. Once a domain's redirect is live, its apex record may be repointed at a placeholder that cannot serve the old
   server (a documentation address such as `192.0.2.1`, proxied), **only with the owner's go**, recording the old
   value for rollback.
5. Verify each: `curl -sI http://<old-domain>/x?y=1` and `https://www.<old-domain>/x?y=1` answer **301** to
   `https://<new-host>/x?y=1` in one hop.
6. Record the table (domain, zone ID, ruleset ID, old records, rollback) in the site's `BUILD-STATE.md`.

Retiring the server is a question only when this inventory is complete, the old origin has been unreferenced for the
recovery window, and a backup is verified (`rollback.cloudwaysRetirement`). Other sites may share it.

## 9. After the window

First day: production equals `origin/<default>` (§3, the closing paragraph), every later fix goes through a PR to the
default branch and is deployed from it; Search Console sitemap submitted (the client's account), robots and canonicals correct, form row read
back and deleted (form sites), analytics Realtime shows one pageview per visit, Workers requests and CPU against
the plan budget (Workers Free: 100,000 requests a day, 10 ms CPU), `npm run a11y` with the dated evidence pack.
First week: coverage and 404 reports against the pre-cutover SEO baseline, the Worker error rate each day.
