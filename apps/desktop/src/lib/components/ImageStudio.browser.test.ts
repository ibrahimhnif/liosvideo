import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import ImageStudio from "./ImageStudio.svelte";

const mockInvoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: any[]) => mockInvoke(...args),
  convertFileSrc: (path: string) => `asset://${path}`,
}));

const v = (n: number, prompt: string, from?: number) => ({
  n,
  file: `assets/images/generated/palace/v${n}.png`,
  prompt,
  from,
  model: "gemini-nano-banana-2.1",
  aspect: "9:16",
  createdAt: n,
});

let images: any[];

beforeEach(() => {
  images = [{ id: "palace", src: "assets/images/palace.png", active: 2, versions: [v(1, "a palace at dusk"), v(2, "darker sky", 1)] }];
  mockInvoke.mockReset();
  mockInvoke.mockImplementation(async (cmd: string, args?: any) => {
    if (cmd === "image_list") return { images, defaultAspect: "9:16", aspects: ["16:9", "9:16", "1:1"], hasKey: true };
    if (cmd === "asset_url_path") return `/p/${args.rel}`;
    if (cmd === "image_edit") {
      const entry = images[0];
      const next = { ...entry, active: 3, versions: [...entry.versions, v(3, args.instruction, 2)] };
      images = [next];
      return next;
    }
    if (cmd === "image_use_version") {
      images = [{ ...images[0], active: args.version }];
      return images[0];
    }
    if (cmd === "image_generate") {
      const entry = { id: args.id, src: `assets/images/${args.id}.png`, active: 1, versions: [v(1, args.prompt)] };
      images = [entry, ...images];
      return entry;
    }
    return null;
  });
});

describe("ImageStudio", () => {
  it("generates a new image from a prompt with an id derived from it", async () => {
    const screen = await render(ImageStudio, { projectRoot: "/p" });
    await expect.element(screen.getByText("palace")).toBeVisible();
    await screen.getByTestId("prompt").fill("Old Newspaper Desk at night");
    await screen.getByTestId("generate").click();
    await vi.waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("image_generate", {
        prompt: "Old Newspaper Desk at night",
        id: "old-newspaper-desk-at",
        aspect: "9:16",
      }),
    );
    await expect.element(screen.getByText('image({ src: "assets/images/old-newspaper-desk-at.png", fit: "cover" })')).toBeVisible();
  });

  it("revises the selected image with what the user wants changed", async () => {
    const screen = await render(ImageStudio, { projectRoot: "/p" });
    await screen.getByText("palace").click();
    await expect.element(screen.getByText(/darker sky/)).toBeVisible();
    await screen.getByTestId("instruction").fill("fewer people, less saturated");
    await screen.getByTestId("revise").click();
    await vi.waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("image_edit", { id: "palace", instruction: "fewer people, less saturated" }),
    );
    await expect.element(screen.getByText("v3 ✓")).toBeVisible();
  });

  it("revises with a quick chip", async () => {
    const screen = await render(ImageStudio, { projectRoot: "/p" });
    await screen.getByText("palace").click();
    await screen.getByRole("button", { name: "Brighter" }).click();
    await vi.waitFor(() => expect(mockInvoke).toHaveBeenCalledWith("image_edit", { id: "palace", instruction: "Brighter" }));
  });

  it("switches the video back to an earlier version", async () => {
    const screen = await render(ImageStudio, { projectRoot: "/p" });
    await screen.getByText("palace").click();
    await screen.getByText("v1", { exact: true }).click();
    await screen.getByTestId("use-version").click();
    await vi.waitFor(() => expect(mockInvoke).toHaveBeenCalledWith("image_use_version", { id: "palace", version: 1 }));
  });

  it("shows API errors and the missing-key banner", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "image_list") return { images: [], defaultAspect: "16:9", aspects: ["16:9"], hasKey: false };
      if (cmd === "image_generate") throw "Gemini returned no image (finish reason: IMAGE_SAFETY)";
      return null;
    });
    const screen = await render(ImageStudio, { projectRoot: "/p" });
    await expect.element(screen.getByTestId("no-key")).toBeVisible();
    await screen.getByTestId("prompt").fill("a cat");
    await screen.getByTestId("generate").click();
    await expect.element(screen.getByTestId("error")).toHaveTextContent("Gemini returned no image (finish reason: IMAGE_SAFETY)");
  });
});
