import { describe, expect, it } from "vitest";
import { apply, IDENTITY, multiply, type Affine } from "../src/math/affine";

describe("affine", () => {
  it("leaves points unchanged with the identity", () => {
    expect(apply(IDENTITY, 3, 4)).toEqual([3, 4]);
  });

  it("is associative", () => {
    const a: Affine = [2, 0, 0, 3, 5, 7];
    const b: Affine = [0, 1, -1, 0, 1, 2];
    const c: Affine = [1, 0, 0, 1, -4, 9];
    const l = multiply(multiply(a, b), c);
    const r = multiply(a, multiply(b, c));
    l.forEach((v, i) => expect(v).toBeCloseTo(r[i]));
  });

  it("applies the right-hand matrix first", () => {
    const translate: Affine = [1, 0, 0, 1, 10, 0];
    const scale: Affine = [2, 0, 0, 2, 0, 0];
    expect(apply(multiply(translate, scale), 1, 1)).toEqual([12, 2]);
  });
});
