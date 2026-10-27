import { describe, expect, it } from "vitest";
import { ease } from "../src/anim/easing";
import { Track } from "../src/anim/track";

describe("ease", () => {
  it("is linear at the midpoint for linear", () => {
    expect(ease("linear", 0.5)).toBe(0.5);
  });

  it("starts at 0 and ends at 1", () => {
    expect(ease("inOutCubic", 0)).toBe(0);
    expect(ease("inOutCubic", 1)).toBe(1);
  });

  it("clamps t above 1", () => {
    expect(ease("outBack", 2)).toBe(1);
  });
});

describe("Track", () => {
  it("holds initial, interpolates, holds end, and chains from previous value", () => {
    const tr = new Track<number>(0);
    tr.add({ start: 1, end: 2, from: undefined, to: 100, ease: "linear" });
    tr.add({ start: 3, end: 4, from: undefined, to: 50, ease: "linear" });
    expect(tr.valueAt(0.5)).toBe(0);
    expect(tr.valueAt(1.5)).toBe(50);
    expect(tr.valueAt(2.5)).toBe(100);
    expect(tr.valueAt(3.5)).toBe(75);
    expect(tr.valueAt(10)).toBe(50);
  });

  it("treats a zero-duration segment as an instant set", () => {
    const s = new Track<number>(0);
    s.add({ start: 1, end: 1, from: undefined, to: 9, ease: "linear" });
    expect(s.valueAt(0.999)).toBe(0);
    expect(s.valueAt(1)).toBe(9);
  });

  it("gives the same value regardless of query order", () => {
    const tr = new Track<number>(0);
    tr.add({ start: 3, end: 4, from: undefined, to: 50, ease: "linear" });
    tr.add({ start: 1, end: 2, from: undefined, to: 100, ease: "linear" });
    expect(tr.valueAt(3.5)).toBe(75);
    expect(tr.valueAt(1.5)).toBe(50);
    expect(tr.valueAt(3.5)).toBe(75);
  });

  it("interpolates hex colors", () => {
    const c = new Track<string>("#000000");
    c.add({ start: 0, end: 1, from: undefined, to: "#ffffff", ease: "linear" });
    expect(c.valueAt(0.5)).toBe("#808080ff");
  });

  it("switches non-color strings at segment start", () => {
    const c = new Track<string>("a");
    c.add({ start: 1, end: 2, from: undefined, to: "b", ease: "linear" });
    expect(c.valueAt(0.99)).toBe("a");
    expect(c.valueAt(1)).toBe("b");
  });
});
