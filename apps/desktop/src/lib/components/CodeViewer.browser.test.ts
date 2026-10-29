import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import CodeViewer from "./CodeViewer.svelte";

const mockInvoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: any[]) => mockInvoke(...args),
}));

describe("CodeViewer", () => {
  it("renders code files list and switches between files", async () => {
    const fileList = ["long.ts", "short.ts", "scenes/intro.ts", "scenes/outro.ts"];
    const fileContents: Record<string, string> = {
      "long.ts": `import { composition } from "liosvideo";\nexport default composition({ width: 1920, height: 1080 });`,
      "scenes/intro.ts": `import { scene, text } from "liosvideo";\nexport default scene("intro", { duration: 4 }, () => {});`,
    };

    mockInvoke.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === "list_code_files") {
        return fileList;
      }
      if (cmd === "read_project_file") {
        return fileContents[args?.rel] ?? "// file content";
      }
      return null;
    });

    const screen = await render(CodeViewer, {
      projectRoot: "/path/to/project",
      activeComposition: "long.ts",
    });

    await expect.element(screen.getByText("Project Code")).toBeVisible();
    await expect.element(screen.getByText("long.ts").first()).toBeVisible();
    await expect.element(screen.getByText("short.ts")).toBeVisible();
    await expect.element(screen.getByText("intro.ts")).toBeVisible();
    await expect.element(screen.getByText("outro.ts")).toBeVisible();

    // Check code displayed for default selected file (long.ts)
    await expect.element(screen.getByText(/export default composition/)).toBeVisible();

    // Click on scenes/intro.ts
    const introBtn = screen.getByRole("button", { name: /intro\.ts/ });
    await introBtn.click();

    // Check that code updated
    await expect.element(screen.getByText(/export default scene/)).toBeVisible();
  });
});
