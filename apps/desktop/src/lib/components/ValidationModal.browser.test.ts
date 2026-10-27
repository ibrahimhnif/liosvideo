import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import ValidationModal from "./ValidationModal.svelte";

describe("ValidationModal", () => {
  it("does not render when open is false", async () => {
    const screen = await render(ValidationModal, {
      open: false,
      onClose: vi.fn(),
    });

    await expect.element(screen.getByText("Scene Code Validator")).not.toBeInTheDocument();
  });

  it("renders validation modal header and close button", async () => {
    const onClose = vi.fn();
    const screen = await render(ValidationModal, {
      open: true,
      onClose,
    });

    await expect.element(screen.getByText("Scene Code Validator")).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Done" })).toBeVisible();

    const doneBtn = screen.getByRole("button", { name: "Done" });
    await doneBtn.click();
    expect(onClose).toHaveBeenCalled();
  });
});
