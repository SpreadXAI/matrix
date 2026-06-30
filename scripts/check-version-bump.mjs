#!/usr/bin/env node
// Detects whether the plugin version was bumped when it needed to be.
//
// Policy: a version bump is REQUIRED only when release-relevant files changed
// vs the baseline — `skills/**` or non-test files under `src/**`. Docs, tooling
// (.husky, package.json devDeps), tests, and CI changes are exempt. A version
// regression (current < baseline) always fails.
//
// Usage: node scripts/check-version-bump.mjs [--base <ref>] [--mode warn|enforce]
//   --base   git ref to compare against (default: origin/main)
//   --mode   enforce → exit 1 on failure (CI); warn → exit 0, just print (pre-push)
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const argOf = (name, def) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : def;
};
const base = argOf("--base", "origin/main");
const mode = argOf("--mode", "warn");
const enforce = mode === "enforce";

const sh = (cmd) => execSync(cmd, { encoding: "utf8" }).trim();
const fail = (msg) => {
  console.error(`${enforce ? "✗" : "⚠"} version-bump check — ${msg}`);
  process.exit(enforce ? 1 : 0);
};
const pass = (msg) => {
  console.log(`✓ version-bump check — ${msg}`);
  process.exit(0);
};

let basePkg;
try {
  basePkg = sh(`git show ${base}:package.json`);
} catch {
  // Baseline unreachable (shallow clone, or remote ref not fetched).
  if (enforce) fail(`cannot read ${base}:package.json — fetch the base ref with full history first`);
  console.log(`• version-bump check skipped — ${base} not available locally`);
  process.exit(0);
}

const parse = (v) => String(v).split(".").map(Number);
const cmp = (a, b) => {
  const x = parse(a);
  const y = parse(b);
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
};

const curVer = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
const baseVer = JSON.parse(basePkg).version;

let changed = [];
try {
  changed = sh(`git diff --name-only ${base}...HEAD`).split("\n").filter(Boolean);
} catch {
  changed = sh(`git diff --name-only ${base} HEAD`).split("\n").filter(Boolean);
}

const isRelevant = (f) =>
  f.startsWith("skills/") ||
  (f.startsWith("src/") && !/\.(test|spec)\.ts$/.test(f) && !f.includes("__tests__"));
const relevant = changed.filter(isRelevant);

const delta = cmp(curVer, baseVer);

if (delta < 0) fail(`version regressed: ${curVer} < ${base} (${baseVer})`);

if (relevant.length === 0) {
  pass(`no release-relevant changes vs ${base}; bump not required (version ${curVer})`);
}

if (delta > 0) pass(`release-relevant changes bumped ${baseVer} → ${curVer}`);

const sample = relevant.slice(0, 8).join(", ") + (relevant.length > 8 ? ` (+${relevant.length - 8} more)` : "");
fail(
  `release-relevant files changed vs ${base} but version is still ${curVer}.\n` +
    `    changed: ${sample}\n` +
    `    bump the version in all five manifests (${baseVer} → next) before ${enforce ? "merging" : "pushing"}.`,
);
