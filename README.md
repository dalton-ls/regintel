# RegIntel — Archive: AI Ingest Tools

> **This branch is archived.** It is preserved as a frozen snapshot of the
> Anthropic-API-powered ingest tools that were removed from the active
> development branches. Do not deploy from this branch and do not develop
> against it.

Archived on **2026-05-06** from `claude/remove-search-bar-CoPA5` at commit
`617614a` (just before the AI tools were removed in commit `ebdb009`).

## What's preserved here

| File | Description |
|---|---|
| `ingest-ai-parsed.html` | **AI Batch Parse** — uploads OpenLaws JSONL, calls Claude (Haiku 4.5) section-by-section to produce Parent + Child RegIntel records, runs them through an SME triage queue, and exports the accepted records as RegIntel JSON |
| `ingest-parser.html` | **Reg Parser** — paste/upload raw regulatory JSON or JSONL and Claude (Opus 4.7 by default) returns the full sheet-keyed RegIntel output in one streaming call |
| `regintel.html` | Variant of the main site that linked to both AI tools from the admin nav |
| `ingest.html` | WR Ingest as it existed at archive time |

Both AI tools used the Anthropic API directly from the browser via the
`anthropic-dangerous-direct-browser-access: true` header. The user's API key
was kept in `localStorage` under the key `regintel_anthropic_key`.

## Why these were removed

The product direction shifted to a simpler workflow where SMEs supply the
already-parsed JSON via three plain upload tabs (WR / Role / CS) on the
active development branch. The AI parsing pipeline is being deferred until
the data flow is stable.

## Restoring the AI tools

Three options, in increasing order of effort:

1. **Read-only inspection.** Browse the files on GitHub at
   `https://github.com/dalton-ls/regintel/tree/archive/ai-ingest-tools`.

2. **Cherry-pick into a feature branch.** From a clean working branch:
   ```bash
   git checkout -b feat/restore-ai-tools claude/remove-search-bar-CoPA5
   git checkout archive/ai-ingest-tools -- ingest-ai-parsed.html ingest-parser.html
   # Re-add the admin-nav links in regintel.html that were removed in ebdb009
   git commit -am "Restore AI ingest tools from archive"
   ```

3. **Resume development on this branch.** Branch from
   `archive/ai-ingest-tools`, but be aware that any unrelated improvements
   made on the active branches since 2026-05-06 will need to be merged in.

## Active branches (for reference)

| Branch | Role |
|---|---|
| `claude/remove-search-bar-CoPA5` | Active development |
| `claude/create-website-skeleton-hYJMa` | GitHub Pages deployment |
| `archive/ai-ingest-tools` | **(this branch)** archived AI tools — frozen |
