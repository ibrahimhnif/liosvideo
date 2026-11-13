import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import UpdateBanner from "./UpdateBanner.svelte";
import type { UpdateApi, UpdateInfo } from "$lib/update/api";

function fakeApi(found: UpdateInfo | null, opts: { failInstall?: boolean } = {}): UpdateApi & {
  check: ReturnType<typeof vi.fn>;
  install: ReturnType<typeof vi.fn>;
  restart: ReturnType<typeof vi.fn>;
} {
  return {
    check: vi.fn(async () => found),
    install: vi.fn(async (onProgress: (p: number | null) => void) => {
      onProgress(0.5);
      if (opts.failInstall) throw new Error("signature mismatch");
      onProgress(1);
    }),
    restart: vi.fn(async () => {}),
  };
}

const v2: UpdateInfo = { version: "0.2.0", currentVersion: "0.1.11", notes: "Faster renders" };

describe("UpdateBanner", () => {
  it("shows nothing when the app is up to date", async () => {
    const api = fakeApi(null);
    const screen = await render(UpdateBanner, { api });
    await vi.waitFor(() => expect(api.check).toHaveBeenCalled());
    await expect.element(screen.getByTestId("update-banner")).not.toBeInTheDocument();
  });

  it("offers a newer version, installs it in place and restarts", async () => {
    const api = fakeApi(v2);
    const screen = await render(UpdateBanner, { api });

    await expect.element(screen.getByText("Liosvideo 0.2.0 is available")).toBeVisible();
    await expect.element(screen.getByText("You have 0.1.11")).toBeVisible();

    await screen.getByRole("button", { name: "Update now" }).click();
    expect(api.install).toHaveBeenCalledOnce();

    await expect.element(screen.getByText("Update installed")).toBeVisible();
    await screen.getByRole("button", { name: "Restart" }).click();
    expect(api.restart).toHaveBeenCalledOnce();
  });

  it("hides until next launch when dismissed", async () => {
    const api = fakeApi(v2);
    const screen = await render(UpdateBanner, { api });
    await screen.getByRole("button", { name: "Later" }).click();
    await expect.element(screen.getByTestId("update-banner")).not.toBeInTheDocument();
  });

  it("shows the error and lets you try again when the install fails", async () => {
    const api = fakeApi(v2, { failInstall: true });
    const screen = await render(UpdateBanner, { api });
    await screen.getByRole("button", { name: "Update now" }).click();
    await expect.element(screen.getByText(/signature mismatch/)).toBeVisible();
    await screen.getByRole("button", { name: "Try again" }).click();
    expect(api.install).toHaveBeenCalledTimes(2);
  });

  it("stays quiet when the check itself fails (offline)", async () => {
    const api = fakeApi(null);
    api.check.mockRejectedValueOnce(new Error("network down"));
    const screen = await render(UpdateBanner, { api });
    await vi.waitFor(() => expect(api.check).toHaveBeenCalled());
    await expect.element(screen.getByTestId("update-banner")).not.toBeInTheDocument();
  });
});
