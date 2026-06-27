import { describe, it, expect } from "vitest";
import { ALLOWED } from "./client.js";
import { READ_TOOLS, WRITE_TOOLS } from "../core/writeGate.js";

describe("harness allowedTools", () => {
  it("never auto-allows a write tool (writes must route through the gate)", () => {
    for (const t of ALLOWED) expect(WRITE_TOOLS.has(t)).toBe(false);
  });
  it("auto-allows exactly the read tools", () => {
    expect(new Set(ALLOWED)).toEqual(READ_TOOLS);
  });
});
