# Publishing the `spreadx-marketplace`

The README documents installing via:

```
/plugin marketplace add SpreadXAI/spreadx-marketplace
/plugin install spreadx-matrix@spreadx-marketplace
```

For `add SpreadXAI/spreadx-marketplace` to resolve, a **separate** GitHub repo at
`github.com/SpreadXAI/spreadx-marketplace` must serve the marketplace manifest. This repo
(`SpreadXAI/matrix`) is the **plugin**; the marketplace repo just points at it.

## One-time setup

1. Create an empty repo `SpreadXAI/spreadx-marketplace`.
2. Copy [`marketplace.json`](./marketplace.json) (next to this file) into it at
   `.claude-plugin/marketplace.json`. It references this plugin repo via a GitHub source:

   ```json
   "source": { "source": "github", "repo": "SpreadXAI/matrix" }
   ```

   Optionally pin a release: add `"ref": "v0.1.0"` (or `"sha": "<commit>"`) inside `source`.
3. Push. The documented commands now work.

## Until then — install straight from this repo

This plugin repo also ships its own `.claude-plugin/marketplace.json` (named
`spreadx-marketplace`, `source: "./"`), so you can install without the separate repo —
the install name is identical:

```
/plugin marketplace add SpreadXAI/matrix
/plugin install spreadx-matrix@spreadx-marketplace
```

Codex installs straight from this repo regardless: `codex plugin marketplace add SpreadXAI/matrix`.
