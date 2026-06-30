import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

// Drift guardrail: the plugin version lives in FIVE files and they must move in
// lockstep. Bump them together by hand on each release — this test locks them so
// CI catches a stray edit that touches one file and misses another.
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
