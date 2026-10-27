import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import ExportModal from "./ExportModal.svelte";

describe("ExportModal", () => {
  it("renders preset choices and updates dimensions", async () => {
    const onClose = vi.fn();
    const onStart = vi.fn().mockResolvedValue("/path/to/out/test.mp4");

    const screen = await render(ExportModal, {
      open: true,
      compositionName: "long.ts",
      width: 1920,
      height: 1080,
      fps: 30,
      totalFrames: 90,
      onClose,
      onStartExport: onStart,
    });

    await expect.element(screen.getByText("Export Composition")).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Start Export" })).toBeVisible();

    // Select 4K preset
    const presetSelect = screen.getByLabelText("Preset");
    await presetSelect.selectOptions("4k");
    await expect.element(screen.getByTestId("resolution-value")).toHaveTextContent("3840 × 2160");

    // Select Shorts 9:16 preset
    await presetSelect.selectOptions("shorts");
    await expect.element(screen.getByTestId("resolution-value")).toHaveTextContent("1080 × 1920");
  });

  it("handles export progress and done state", async () => {
    let resolveExport!: (path: string) => void;
    const exportPromise = new Promise<string>((res) => {
      resolveExport = res;
    });

    const onStart = vi.fn().mockImplementation(() => exportPromise);
    const onFinder = vi.fn();

    const screen = await render(ExportModal, {
      open: true,
      compositionName: "long.ts",
      width: 1920,
      height: 1080,
      fps: 30,
      totalFrames: 90,
      onClose: vi.fn(),
      onStartExport: onStart,
      onShowInFinder: onFinder,
    });

    await screen.getByRole("button", { name: "Start Export" }).click();
    expect(onStart).toHaveBeenCalled();

    // Resolves export completion
    resolveExport("/path/to/out/video.mp4");

    // In done state:
    await expect.element(screen.getByText("Export Completed!")).toBeVisible();
    await expect.element(screen.getByText("/path/to/out/video.mp4")).toBeVisible();
    const finderBtn = screen.getByRole("button", { name: "Show in Finder" });
    await finderBtn.click();
    expect(onFinder).toHaveBeenCalledWith("/path/to/out/video.mp4");
  });
});
