import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { STYLE_FIXTURE } from "$lib/styles/fixtures";
import StyleMenu from "./StyleMenu.svelte";

vi.mock("$lib/styles/api", async (orig) => ({
  ...(await orig<typeof import("$lib/styles/api")>()),
  listStyles: vi.fn(async () => STYLE_FIXTURE),
}));

describe("StyleMenu", () => {
  it("lists the ten styles in order and picks one", async () => {
    const onPick = vi.fn();
    // the menu opens upward (it sits under the chat composer), so leave room above the button
    document.body.style.paddingTop = "420px";
    const screen = await render(StyleMenu, { onPick });
    await screen.getByRole("button", { name: "Style" }).click();
    await expect.element(screen.getByRole("menu")).toBeVisible();
    const items = screen.getByRole("menuitem");
    await expect.poll(() => items.elements().map((e) => e.textContent?.trim())).toEqual(STYLE_FIXTURE.map((s) => s.title));
    await screen.getByRole("menuitem", { name: "Pixel Art" }).click();
    expect(onPick).toHaveBeenCalledWith({ id: "pixel-art", title: "Pixel Art" });
    await expect.element(screen.getByRole("menu")).not.toBeInTheDocument();
  });
});
