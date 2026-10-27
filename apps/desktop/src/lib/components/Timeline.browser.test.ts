import type { ManifestNode, TimelineManifest } from "liosvideo";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import Timeline from "./Timeline.svelte";

const node = (path: string, children: ManifestNode[] = [], spans: ManifestNode["spans"] = []): ManifestNode => ({
  path, name: path.split("/").at(-1)!, kind: children.length ? "group" : "rect", spans, children,
});

const manifest: TimelineManifest = {
  width: 100, height: 100, fps: 30, totalFrames: 90,
  scenes: [
    { id: "a", startFrame: 0, endFrame: 60, tree: node("a", [node("a/win", [], [{ startFrame: 10, endFrame: 20 }])]) },
    { id: "b", startFrame: 60, endFrame: 90, tree: node("b") },
  ],
};

async function setup(m = manifest) {
  const onSelect = vi.fn();
  const onSeek = vi.fn();
  const screen = await render(Timeline, { manifest: m, composition: "long.ts", frame: 0, onSelect, onSeek });
  return { screen, onSelect, onSeek };
}

describe("Timeline", () => {
  it("lists the scenes", async () => {
    const { screen } = await setup();
    await expect.element(screen.getByRole("button", { name: "a", exact: true })).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "b", exact: true })).toBeVisible();
  });

  it("selects a scene and seeks to its start", async () => {
    const { screen, onSelect, onSeek } = await setup();
    await screen.getByRole("button", { name: "b", exact: true }).click();
    expect(onSelect).toHaveBeenCalledWith({ composition: "long.ts", sceneId: "b", startFrame: 60, endFrame: 90 });
    expect(onSeek).toHaveBeenCalledWith(60);
  });

  it("expands a scene and selects a child from its bar", async () => {
    const { screen, onSelect, onSeek } = await setup();
    await screen.getByRole("button", { name: "Expand a" }).click();
    await screen.getByRole("button", { name: "win animation 10–20" }).click();
    expect(onSelect).toHaveBeenCalledWith({ composition: "long.ts", sceneId: "a", path: "a/win", startFrame: 10, endFrame: 20 });
    expect(onSeek).toHaveBeenCalledWith(10);
  });

  it("shows an empty state", async () => {
    const { screen } = await setup({ width: 1, height: 1, fps: 30, totalFrames: 0, scenes: [] });
    await expect.element(screen.getByText("No scenes")).toBeVisible();
  });
});
