import { describe, expect, it } from "vitest";
import { seededRandom } from "../src/math/random";

describe("seededRandom", () => {
  it("repeats for the same seed", () => {
    const a = seededRandom("a");
    const b = seededRandom("a");
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it("differs between seeds", () => {
    const a = seededRandom("a");
    const b = seededRandom("b");
    expect([a(), a(), a()]).not.toEqual([b(), b(), b()]);
  });

  it("stays in [0, 1)", () => {
    const r = seededRandom("range");
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
