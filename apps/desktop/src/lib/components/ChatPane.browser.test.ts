import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import { userEvent } from "vitest/browser";
import { fakeAgentApi } from "$lib/chat/fake";
import type { Selection } from "$lib/timeline/model";
import ChatPane from "./ChatPane.svelte";

const selection: Selection = { composition: "long.ts", sceneId: "intro", sceneFile: "scenes/intro.ts", path: "intro/title", startFrame: 6, endFrame: 24 };

async function setup(sel?: Selection) {
  const { api, emit } = fakeAgentApi();
  const screen = await render(ChatPane, { api, selection: sel, playhead: { frame: 36, fps: 30 }, onClearSelection: () => {} });
  return { screen, api, emit };
}

const ready = { type: "status", state: "ready", agentId: "gemini" } as const;

describe("ChatPane", () => {
  it("can't send before the agent is ready", async () => {
    const { screen } = await setup();
    await expect.element(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("sends the prompt with the selection context on Enter", async () => {
    const { screen, api, emit } = await setup(selection);
    emit(ready);
    const box = screen.getByPlaceholder(/Ask the agent/);
    await box.fill("make it blue");
    await userEvent.keyboard("{Enter}");
    expect(api.prompt).toHaveBeenCalledWith("make it blue", {
      composition: "long.ts", sceneId: "intro", sceneFile: "scenes/intro.ts", path: "intro/title",
      startFrame: 6, endFrame: 24, fps: 30, playheadFrame: 36,
    });
    await expect.element(screen.getByText("make it blue")).toBeVisible();
  });

  it("can reconnect while a slow connection is starting", async () => {
    const { screen, api, emit } = await setup();
    emit({ type: "status", state: "connecting", agentId: "gemini" });
    await screen.getByRole("button", { name: "Reconnect" }).click();
    expect(api.connect).toHaveBeenCalled();
  });

  it("renders streamed chunks as one message", async () => {
    const { screen, emit } = await setup();
    emit(ready);
    for (const t of ["Changing ", "the ", "title."]) emit({ type: "update", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: t } } });
    await expect.element(screen.getByText("Changing the title.")).toBeVisible();
  });

  it("answers a permission card and disables it", async () => {
    const { screen, api, emit } = await setup();
    emit(ready);
    emit({ type: "permission", requestId: "p1", toolCall: { title: "Write scenes/intro.ts" }, options: [{ optionId: "allow-once-id", name: "Allow once", kind: "allow_once" }, { optionId: "no", name: "Reject", kind: "reject_once" }] });
    await screen.getByRole("button", { name: "Allow once" }).click();
    expect(api.respond).toHaveBeenCalledWith("p1", "allow-once-id");
    await expect.element(screen.getByRole("button", { name: "Allow once" })).toBeDisabled();
  });

  it("offers cancel during a turn", async () => {
    const { screen, api, emit } = await setup();
    emit(ready);
    emit({ type: "turn", state: "started" });
    await screen.getByRole("button", { name: "Cancel" }).click();
    expect(api.cancel).toHaveBeenCalled();
  });

  it("shows auth methods when the agent needs a login", async () => {
    const { screen, api, emit } = await setup();
    emit({ type: "status", state: "auth_required", agentId: "gemini", authMethods: [{ id: "oauth-personal", name: "Log in with Google" }] });
    await screen.getByRole("button", { name: "Log in with Google" }).click();
    expect(api.authenticate).toHaveBeenCalledWith("oauth-personal");
  });

  it("shows why the agent exited", async () => {
    const { screen, emit } = await setup();
    emit(ready);
    emit({ type: "status", state: "exited", agentId: "gemini", message: "Error: not logged in" });
    await expect.element(screen.getByText("Error: not logged in")).toBeVisible();
  });

  it("renders model dropdown and allows selecting a different model", async () => {
    const { screen, api, emit } = await setup();
    emit({
      type: "status",
      state: "ready",
      agentId: "codex",
      configOptions: [
        {
          id: "model",
          name: "Model",
          category: "model",
          currentValue: "gpt-6-sol",
          options: [
            { value: "gpt-6-sol", name: "GPT-6 Sol" },
            { value: "gpt-5-codex", name: "GPT-5 Codex" },
          ],
        },
      ],
    });
    const select = screen.getByRole("combobox");
    await expect.element(select).toBeVisible();
    await userEvent.selectOptions(select, "gpt-5-codex");
    expect(api.setConfigOption).toHaveBeenCalledWith("model", "gpt-5-codex");
  });

  it("renders asset request card and resolves via skip", async () => {
    const { screen, api, emit } = await setup();
    emit(ready);
    emit({
      type: "asset_request",
      requestId: "asset-req-42",
      id: "brand-logo",
      kind: "image",
      description: "Company transparent logo",
    });
    await expect.element(screen.getByText("brand-logo")).toBeVisible();
    await expect.element(screen.getByText("Company transparent logo")).toBeVisible();
    const skipBtn = screen.getByRole("button", { name: "Skip" });
    await expect.element(skipBtn).toBeVisible();
    await skipBtn.click();
    expect(api.resolveAssetRequest).toHaveBeenCalledWith("asset-req-42", null);
    await expect.element(screen.getByText("Skipped")).toBeVisible();
    await expect.element(skipBtn).toBeDisabled();
  });

  it("toggles yolo mode and calls setAutoApprove", async () => {
    const { screen, api } = await setup();
    const yoloBtn = screen.getByRole("button", { name: "⚡ Yolo" });
    await expect.element(yoloBtn).toBeVisible();
    await yoloBtn.click();
    expect(api.setAutoApprove).toHaveBeenCalledWith(true);
    await yoloBtn.click();
    expect(api.setAutoApprove).toHaveBeenCalledWith(false);
  });
});
