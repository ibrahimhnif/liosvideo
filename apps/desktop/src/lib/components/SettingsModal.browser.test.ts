import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import SettingsModal from "./SettingsModal.svelte";

describe("SettingsModal", () => {
  it("does not render when open is false", async () => {
    const screen = await render(SettingsModal, {
      open: false,
      onClose: vi.fn(),
    });

    await expect.element(screen.getByText("API Keys & TTS Settings")).not.toBeInTheDocument();
  });

  it("renders API key fields and saves input", async () => {
    const onClose = vi.fn();
    const screen = await render(SettingsModal, {
      open: true,
      onClose,
    });

    await expect.element(screen.getByText("API Keys & TTS Settings")).toBeVisible();
    await expect.element(screen.getByLabelText("ElevenLabs API Key")).toBeVisible();
    await expect.element(screen.getByLabelText("Google Cloud TTS API Key")).toBeVisible();

    const elevenInput = screen.getByTestId("input-elevenlabs");
    await elevenInput.fill("sk_test_12345");
    await expect.element(elevenInput).toHaveValue("sk_test_12345");

    const doneBtn = screen.getByRole("button", { name: "Done" });
    await doneBtn.click();
    expect(onClose).toHaveBeenCalled();
  });
});
