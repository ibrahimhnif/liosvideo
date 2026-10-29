import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import ScriptViewer from "./ScriptViewer.svelte";

const mockInvoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: any[]) => mockInvoke(...args),
}));

describe("ScriptViewer", () => {
  it("renders script content and parsed voiceover lines", async () => {
    const sampleScript = `# Product Intro

## long

<!-- vo:intro-1 -->
Welcome to Liosvideo, the deterministic video engine.

<!-- vo:intro-2 -->
Create videos with code and AI.
`;

    mockInvoke.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === "read_project_file" && args?.rel === "script.md") {
        return sampleScript;
      }
      if (cmd === "get_vo_timings") {
        return {
          "intro-1": { duration: 3.2 },
          "intro-2": { duration: 2.1 },
        };
      }
      return null;
    });

    const screen = await render(ScriptViewer, {
      projectRoot: "/path/to/project",
    });

    await expect.element(screen.getByText("script.md")).toBeVisible();
    await expect.element(screen.getByText("Voiceover Lines")).toBeVisible();
    await expect.element(screen.getByText("intro-1")).toBeVisible();
    await expect.element(screen.getByText(/Welcome to Liosvideo/).first()).toBeVisible();
    await expect.element(screen.getByText("3.20s")).toBeVisible();
    await expect.element(screen.getByText("2 VO lines")).toBeVisible();

    // Switch to Raw mode
    const rawBtn = screen.getByRole("button", { name: "Raw" });
    await rawBtn.click();
    await expect.element(screen.getByText(/<!-- vo:intro-1 -->/)).toBeVisible();

    // Switch back to Formatted
    const formattedBtn = screen.getByRole("button", { name: "Formatted" });
    await formattedBtn.click();
    await expect.element(screen.getByText("Voiceover Lines")).toBeVisible();
  });

  it("shows empty state when script.md does not exist", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "read_project_file") {
        throw new Error("File not found");
      }
      return {};
    });

    const screen = await render(ScriptViewer, {});

    await expect.element(screen.getByText("No script.md found")).toBeVisible();
    await expect.element(screen.getByText(/Ask the AI agent in the chat/)).toBeVisible();
  });
});
