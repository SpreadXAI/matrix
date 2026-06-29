import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { TOOLS } from "./tools.js";

// Pure CI drift guardrail (no server, no network): the matrix tool surface may
// never reference a tool the platform doesn't expose. registry ⊆ manifest is the
// one that matters at runtime (gate, harness allowedTools, and mock all derive
// from TOOLS); skill-table ⊆ registry gives skill ⊆ registry ⊆ manifest transitively.
const registry = new Set(TOOLS.map((t) => t.name));

/** Vendored snapshot of the platform tool surface — see docs/usage.md for provenance. */
function loadManifest(): Set<string> {
  const raw: unknown = JSON.parse(
    readFileSync(new URL("./spreadx-tools.json", import.meta.url), "utf8"),
  );
  if (!Array.isArray(raw) || raw.length === 0 || !raw.every((n) => typeof n === "string")) {
    throw new Error("spreadx-tools.json must be a non-empty array of strings");
  }
  return new Set(raw);
}

/**
 * Bare tool names from each row of the `## Tools` table in the skill. Scoped to
 * that one markdown table → zero false positives (the rest of the file backticks
 * many non-tool tokens: confirmation_token/open/target/tags/plan_id/pool_size/…).
 */
function skillTableTools(): string[] {
  const skill = readFileSync(
    new URL("../../skills/spreadx-agent/SKILL.md", import.meta.url),
    "utf8",
  );
  const start = skill.indexOf("## Tools");
  if (start === -1) throw new Error("`## Tools` section not found in SKILL.md");
  const end = skill.indexOf("\n## ", start + 1); // -1 ⇒ table is the last section
  const section = skill.slice(start, end === -1 ? undefined : end);
  return [...section.matchAll(/^\|[^|]+\|\s*`([a-z_]+)`/gm)].map((m) => m[1]);
}

test("registry ⊆ manifest (no phantom tool can be called)", () => {
  const manifest = loadManifest();
  for (const name of registry) expect(manifest.has(name)).toBe(true);
});

test("skill ## Tools table ⊆ registry (skill documents no unregistered tool)", () => {
  const named = skillTableTools();
  expect(named.length).toBeGreaterThan(0); // table parsed & non-empty (guards drift in the table format itself)
  for (const name of named) expect(registry.has(name)).toBe(true);
});
