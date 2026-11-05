import { describe, expect, it } from "vitest";
import { pathBounds } from "../src/math/svgpath";

describe("pathBounds", () => {
  it("measures a closed polygon", () => {
    expect(pathBounds("M 0 0 L 100 0 L 50 86 Z")).toEqual({ x: 0, y: 0, width: 100, height: 86 });
  });

  it("pads by half the stroke on every side", () => {
    expect(pathBounds("M 0 0 L 100 0 L 50 86 Z", 4)).toEqual({ x: -2, y: -2, width: 104, height: 90 });
  });

  it("handles relative commands", () => {
    expect(pathBounds("m 10 10 l 20 0 l 0 20 z")).toEqual({ x: 10, y: 10, width: 20, height: 20 });
  });

  it("handles horizontal and vertical commands", () => {
    expect(pathBounds("M 10 5 H 60 V 45 H 10 Z")).toEqual({ x: 10, y: 5, width: 50, height: 40 });
  });

  it("treats extra pairs after a move as line-to", () => {
    expect(pathBounds("M 0 0 10 0 10 20")).toEqual({ x: 0, y: 0, width: 10, height: 20 });
  });

  it("measures cubic extrema, not just control points", () => {
    const bounds = pathBounds("M 0 0 C 0 100 100 100 100 0");
    expect(bounds.x).toBe(0);
    expect(bounds.width).toBe(100);
    expect(bounds.height).toBeCloseTo(75);
  });

  it("measures quadratic extrema", () => {
    const bounds = pathBounds("M 0 0 Q 50 100 100 0");
    expect(bounds.height).toBeCloseTo(50);
  });

  it("measures a semicircular arc", () => {
    const bounds = pathBounds("M 0 0 A 50 50 0 0 1 100 0");
    expect(bounds.x).toBeCloseTo(0);
    expect(bounds.width).toBeCloseTo(100);
    expect(bounds.y).toBeCloseTo(-50);
    expect(bounds.height).toBeCloseTo(50);
  });

  it("accepts exponents and compact separators", () => {
    expect(pathBounds("M1e2-.5e1L3e2 4")).toEqual({ x: 100, y: -5, width: 200, height: 9 });
  });

  it("returns a zero box for empty or malformed data", () => {
    expect(pathBounds("")).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    expect(pathBounds("bogus")).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    expect(pathBounds("M 10 10")).toEqual({ x: 10, y: 10, width: 0, height: 0 });
  });
});
