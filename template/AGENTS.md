# Agent instructions

1. Read [CLAUDE.md](CLAUDE.md) for this site's existing conventions and release boundaries; it is the durable project context, not something to replace.
2. Use [docs/content-editing.md](docs/content-editing.md) and [docs/new-page-brief.md](docs/new-page-brief.md) for file-based edits and new routes. Confirm the actual source model before editing; the starter's blog/legal files are Markdown, but migrated sites may differ.
3. Edit source files under `src/` and original media under `media/source/`; never edit `dist/` or generated `public/img/` output. Preserve site-specific content, facts, design and configuration.
4. Run the documented checks and record results in the PR. Do not deploy from a content-editing change; use the site's authorized release owner after merge.
5. Before any Cloudflare DNS, Worker routing/domain, redirect or certificate change, read `docs/cloudflare-change-runbook.md`; snapshot current state, make one scoped change, then read back and verify it before continuing.
