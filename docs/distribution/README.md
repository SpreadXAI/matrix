# Distributing the `spreadx-matrix` plugin

This repo (`SpreadXAI/matrix`) **self-hosts its own marketplace** — it ships
[`.claude-plugin/marketplace.json`](../../.claude-plugin/marketplace.json) with `source: "./"`,
so there is no second repo to publish. Users install with:

```
/plugin marketplace add SpreadXAI/matrix
/plugin install spreadx-matrix@spreadx-marketplace
```

## Names vs source (why the two strings differ)

- **`add` takes a source** — where to fetch from. Here that's the repo path `SpreadXAI/matrix`
  (an `owner/repo` shorthand; a full git URL or local path also works). A bare name like
  `spreadx-marketplace` is **not** a source and won't resolve — there is no central registry.
- **`install` / `update` / `uninstall` take names** declared inside the manifest:
  - marketplace name: **`spreadx-marketplace`** (top-level `name`)
  - plugin name: **`spreadx-matrix`** (`plugins[].name`)

So you `add SpreadXAI/matrix`, then reference `spreadx-matrix@spreadx-marketplace`.

Codex installs straight from the same repo: `codex plugin marketplace add SpreadXAI/matrix`.

## Optional — a dedicated catalog repo (only if you ship multiple plugins)

The single-repo setup above is the mainstream choice for one plugin. A **separate** marketplace
repo only earns its keep once you want one entry point listing several plugins. If that day comes:

1. Create a repo, e.g. `SpreadXAI/spreadx-marketplace`.
2. Put [`marketplace.json`](./marketplace.json) (next to this file) at its
   `.claude-plugin/marketplace.json`. It references this plugin repo via a GitHub source:

   ```json
   "source": { "source": "github", "repo": "SpreadXAI/matrix" }
   ```

   Optionally pin a release with `"ref": "v0.2.0"` (or `"sha": "<commit>"`) inside `source`.
3. Push. Users then `add SpreadXAI/spreadx-marketplace` instead — the install name
   (`spreadx-matrix@spreadx-marketplace`) is unchanged.
