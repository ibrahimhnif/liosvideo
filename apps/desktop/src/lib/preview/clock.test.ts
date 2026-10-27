import { describe, expect, it } from "vitest";
import { formatTimecode, PlaybackClock } from "./clock";

describe("formatTimecode", () => {
  it("formats MM:SS:FF", () => {
    expect(formatTimecode(0, 30)).toBe("00:00:00");
    expect(formatTimecode(95, 30)).toBe("00:03:05");
    expect(formatTimecode(3600 * 30, 30)).toBe("60:00:00");
  });
});

describe("PlaybackClock", () => {
  it("advances from the seek position while playing", () => {
    const c = new PlaybackClock(30, 300);
    c.seek(10);
    c.play(1000);
    expect(c.frameAt(2000)).toBe(40);
  });

  it("holds the frame while paused", () => {
    const c = new PlaybackClock(30, 300);
    c.seek(10);
    c.play(1000);
    c.pause(2000);
    expect(c.frameAt(5000)).toBe(40);
    expect(c.playing).toBe(false);
  });

  it("stops at the last frame", () => {
    const c = new PlaybackClock(30, 60);
    c.play(0);
    expect(c.frameAt(10_000)).toBe(59);
    expect(c.playing).toBe(false);
  });

  it("clamps seeks", () => {
    const c = new PlaybackClock(30, 60);
    c.seek(-3);
    expect(c.frameAt(0)).toBe(0);
    c.seek(500);
    expect(c.frameAt(0)).toBe(59);
  });

  it("seeking while playing continues from the new frame", () => {
    const c = new PlaybackClock(30, 300);
    c.play(0);
    c.seek(100);
    expect(c.frameAt(1000)).toBe(100);
    expect(c.frameAt(2000)).toBe(130);
  });
});
