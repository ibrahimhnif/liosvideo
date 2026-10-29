import { describe, expect, it, vi, beforeEach } from "vitest";
import { render } from "vitest-browser-svelte";
import ProjectPicker from "./ProjectPicker.svelte";

const mockInvoke = vi.fn();
const mockOpen = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: any[]) => mockInvoke(...args),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...args: any[]) => mockOpen(...args),
}));

describe("ProjectPicker", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockOpen.mockReset();
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "recent_projects") return [];
      return null;
    });
  });

  it("renders template options with Blank / Custom selected by default", async () => {
    const screen = await render(ProjectPicker, {
      onOpen: () => {},
    });

    await expect.element(screen.getByText("Blank / Custom")).toBeVisible();
    await expect.element(screen.getByText("Minimal Dev Screencast")).toBeVisible();
    await expect.element(screen.getByText("3D Product Showcase")).toBeVisible();
    await expect.element(screen.getByText("Kinetic Short")).toBeVisible();
    await expect.element(screen.getByText("SaaS Feature Launch")).toBeVisible();

    const blankCard = screen.getByTestId("template-blank");
    await expect.element(blankCard).toHaveClass("selected");
  });

  it("allows selecting a template and passing it to create_project", async () => {
    let opened = false;
    mockOpen.mockResolvedValue("/home/user/projects");
    mockInvoke.mockImplementation(async (cmd: string, args: any) => {
      if (cmd === "create_project") {
        return { root: `${args.parent}/${args.name}`, compositions: ["long.ts"], history: "Enabled" };
      }
      return [];
    });

    const screen = await render(ProjectPicker, {
      onOpen: () => {
        opened = true;
      },
    });

    // Click 3D Product Showcase template
    const productCard = screen.getByTestId("template-product-3d");
    await productCard.click();
    await expect.element(productCard).toHaveClass("selected");

    // Type project name
    const input = screen.getByPlaceholder("New project name");
    await input.fill("my-3d-video");

    // Click create
    const submitBtn = screen.getByRole("button", { name: /New project/i });
    await submitBtn.click();

    expect(mockOpen).toHaveBeenCalled();
    expect(mockInvoke).toHaveBeenCalledWith("create_project", {
      parent: "/home/user/projects",
      name: "my-3d-video",
      template: "product-3d",
    });
    expect(opened).toBe(true);
  });
});
