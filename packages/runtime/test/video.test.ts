import { describe, expect, it } from "vitest";
import { mattePath, video, VideoNode } from "../src/graph/kinds";
import { collectAssets, evaluateFrame } from "../src/evaluate";
import { composition, scene } from "../src/composition";

describe("VideoNode", () => {
  it("creates VideoNode with source, timing and speed props", () => {
    const v = video({ src: "assets/demo.mp4", width: 1280, height: 720, startOffset: 2.0, speed: 1.5 });
    expect(v).toBeInstanceOf(VideoNode);
    expect(v.propsAt(0).src).toBe("assets/demo.mp4");
    expect(v.propsAt(0).startOffset).toBe(2.0);
    expect(v.propsAt(0).speed).toBe(1.5);
  });

  it("evaluates VideoItem with calculated timestamp", () => {
    const sc = scene("intro", { duration: 5.0 }, ({ root }) => {
      root.add(video({ src: "assets/demo.mp4", width: 1280, height: 720, startOffset: 1.0, speed: 2.0 }));
    });

    const comp = composition({ width: 1920, height: 1080, fps: 30, scenes: [sc] });
    expect(collectAssets(comp)).toContain("assets/demo.mp4");

    // Frame 30 = 1.0s in composition. Video time should be startOffset (1.0) + 1.0 * speed (2.0) = 3.0s
    const list = evaluateFrame(comp, 30);
    const item = list.items.find((i) => i.kind === "video");
    expect(item).toBeDefined();
    expect(item).toMatchObject({
      kind: "video",
      src: "assets/demo.mp4",
      time: 3.0,
      width: 1280,
      height: 720,
    });
  });

  it("matte: true plays the cut-out made by `liosvideo asset matte` (colour over a half-height mask)", () => {
    const sc = scene("intro", { duration: 2 }, ({ root }) => {
      root.add(video({ src: "assets/video/talk.mp4", width: 1920, height: 1080, matte: true }));
      root.add(video({ name: "own", src: "assets/video/b.mp4", matte: "assets/video/b-cut.mp4" }));
    });
    const comp = composition({ width: 1920, height: 1080, fps: 30, scenes: [sc] });
    const [talk, own] = evaluateFrame(comp, 0).items;
    expect(talk).toMatchObject({ kind: "video", src: "assets/video/talk.matte.mp4", matte: { source: "assets/video/talk.mp4" } });
    expect(own).toMatchObject({ src: "assets/video/b-cut.mp4", matte: { source: "assets/video/b.mp4" } });
    // only the packed files are decoded
    expect(evaluateFrame(comp, 0).assets).toEqual(["assets/video/b-cut.mp4", "assets/video/talk.matte.mp4"]);
    expect(collectAssets(comp)).toEqual(["assets/video/b-cut.mp4", "assets/video/talk.matte.mp4"]);
  });

  it("mattePath names the packed file next to the source", () => {
    expect(mattePath("assets/video/talk.mp4")).toBe("assets/video/talk.matte.mp4");
    expect(mattePath("clip.final.mov")).toBe("clip.final.matte.mp4");
    expect(mattePath("assets/video/talk.matte.mp4")).toBe("assets/video/talk.matte.mp4");
  });
});
