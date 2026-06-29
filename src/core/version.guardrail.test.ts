import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

// Drift guardrail: the plugin version lives in FIVE files and they must move in
// lockstep. release-please keeps them in sync on release (see its `extra-files`
// config + .release-please-manifest.json), but a stray manual edit could touch
// one and miss another. This locks them together so CI catches the drift.
//
// `release-please-config.json` is the source of truth for WHICH files/paths
// carry the version — keep these two lists in step.
const VERSION_SOURCES: { path: string; pick: (json: any) => unknown }[] = [
  { path: "package.json", pick: (j) => j.version },
  { path: ".claude-plugin/plugin.json", pick: (j) => j.version },
  { path: ".codex-plugin/plugin.json", pick: (j) => j.version },
  { path: ".claude-plugin/marketplace.json", pick: (j) => j.plugins[0].version },
  { path: "docs/distribution/marketplace.json", pick: (j) => j.plugins[0].version },
];

function readVersion(rel: string, pick: (json: any) => unknown): unknown {
  const json: unknown = JSON.parse(readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8"));
  return pick(json);
}

test("all plugin manifests declare the same version (no drift)", () => {
  const [first, ...rest] = VERSION_SOURCES;
  const baseline = readVersion(first.path, first.pick);
  expect(typeof baseline, `${first.path} version must be a string`).toBe("string");
  for (const src of rest) {
    expect(readVersion(src.path, src.pick), `${src.path} version`).toBe(baseline);
  }
});

test("the release-please manifest matches the committed version", () => {
  const manifest: Record<string, string> = JSON.parse(
    readFileSync(new URL("../../.release-please-manifest.json", import.meta.url), "utf8"),
  );
  const committed = readVersion("package.json", (j) => j.version);
  expect(manifest["."], "release-please manifest root version").toBe(committed);
});
