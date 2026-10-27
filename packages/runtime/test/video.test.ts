import { describe, expect, it } from "vitest";
import { video, VideoNode } from "../src/graph/kinds";
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
});
