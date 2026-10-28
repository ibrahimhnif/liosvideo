import { describe, expect, it, vi } from "vitest";
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

  it("loads saved conversation on mount", async () => {
    const { api } = fakeAgentApi();
    api.loadConversation = vi.fn(async () =>
      JSON.stringify({
        items: [
          { kind: "user", id: "u1", text: "Tolong ubah warna background" },
          { kind: "agent", id: "m2", text: "Background berhasil diubah." },
        ],
      })
    );
    const screen = await render(ChatPane, { api, playhead: { frame: 0, fps: 30 }, onClearSelection: () => {} });
    await expect.element(screen.getByText("Tolong ubah warna background")).toBeVisible();
    await expect.element(screen.getByText("Background berhasil diubah.")).toBeVisible();
  });

  it("displays cost tracing badge and toggles detail breakdown", async () => {
    const { api } = fakeAgentApi();
    api.getProjectStats = vi.fn(async () => ({
      tts: { totalCharacters: 1500, totalCostUsd: 0.024, items: [] },
      tokens: { inputTokens: 5000, outputTokens: 1000, totalTokens: 6000, totalCostUsd: 0.03 },
      totalCostUsd: 0.054,
    }));
    const screen = await render(ChatPane, { api, playhead: { frame: 0, fps: 30 }, onClearSelection: () => {} });
    const costBtn = screen.getByRole("button", { name: /💰 \$0\.054/ });
    await expect.element(costBtn).toBeVisible();
    await costBtn.click();
    await expect.element(screen.getByText(/Cost & Usage Tracing/)).toBeVisible();
    await expect.element(screen.getByText(/TTS Audio Synthesis/)).toBeVisible();
    await expect.element(screen.getByText(/LLM Token Consumption/)).toBeVisible();
  });

  it("renders attached image in user chat bubble", async () => {
    const { api } = fakeAgentApi();
    api.loadConversation = vi.fn(async () =>
      JSON.stringify({
        items: [
          {
            kind: "user",
            id: "u1",
            text: "Use this logo in the intro scene",
            images: [
              {
                filename: "brand-logo.png",
                relPath: "assets/images/brand-logo.png",
                dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
                mimeType: "image/png",
              },
            ],
          },
        ],
      })
    );
    const screen = await render(ChatPane, { api, playhead: { frame: 0, fps: 30 }, onClearSelection: () => {} });
    await expect.element(screen.getByText("Use this logo in the intro scene")).toBeVisible();
    await expect.element(screen.getByText("assets/images/brand-logo.png")).toBeVisible();
    await expect.element(screen.getByAltText("brand-logo.png")).toBeVisible();
  });

  it("has attach image button and clear history button", async () => {
    const { screen } = await setup();
    await expect.element(screen.getByRole("button", { name: /Attach/ })).toBeVisible();
    await expect.element(screen.getByRole("button", { name: /Clear conversation history/ })).toBeVisible();
  });

  it("loads conversation using explicit projectRoot prop", async () => {
    const { api } = fakeAgentApi();
    api.loadConversation = vi.fn(async (root?: string) => {
      if (root === "/path/to/my-project") {
        return JSON.stringify({
          items: [{ kind: "user", id: "u1", text: "Halo from saved project history!" }],
        });
      }
      return null;
    });

    const screen = await render(ChatPane, {
      api,
      projectRoot: "/path/to/my-project",
      playhead: { frame: 0, fps: 30 },
      onClearSelection: () => {},
    });

    await expect.element(screen.getByText("Halo from saved project history!")).toBeVisible();
    expect(api.loadConversation).toHaveBeenCalledWith("/path/to/my-project");
  });

  it("renders conversation history with duplicate tool locations without crashing", async () => {
    const { api } = fakeAgentApi();
    api.loadConversation = vi.fn(async () =>
      JSON.stringify({
        items: [
          { kind: "user", id: "u1", text: "Please edit code.ts" },
          {
            kind: "tool",
            id: "k78",
            toolCallId: "call_78",
            gen: 1,
            title: "Edit scenes/code.ts",
            toolKind: "execute",
            status: "completed",
            locations: [
              "/path/to/scenes/code.ts",
              "/path/to/scenes/code.ts",
              "/path/to/scenes/code.ts",
            ],
            content: ["Applied edit"],
          },
          { kind: "agent", id: "m79", text: "Done editing code.ts!" },
        ],
      })
    );

    const screen = await render(ChatPane, {
      api,
      projectRoot: "/path/to/my-project",
      playhead: { frame: 0, fps: 30 },
      onClearSelection: () => {},
    });

    await expect.element(screen.getByText("Please edit code.ts")).toBeVisible();
    await expect.element(screen.getByText(/Edit scenes\/code\.ts/)).toBeVisible();
    await expect.element(screen.getByText("Done editing code.ts!")).toBeVisible();
  });

  it("shows image preview card with remove button before sending", async () => {
    const { api } = fakeAgentApi();
    api.saveImageAsset = vi.fn(async (name: string) => ({
      relPath: `assets/images/${name}`,
      filename: name,
    }));

    const screen = await render(ChatPane, {
      api,
      playhead: { frame: 0, fps: 30 },
      onClearSelection: () => {},
    });

    const fileInput = screen.container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).toBeTruthy();

    const file = new File(["dummy"], "screenshot-test.png", { type: "image/png" });
    Object.defineProperty(fileInput, "files", {
      value: [file],
      writable: false,
    });
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));

    await expect.element(screen.getByText("Attached Image (1)")).toBeVisible();
    await expect.element(screen.getByText("screenshot-test.png")).toBeVisible();
    const removeBtn = screen.getByRole("button", { name: "Remove image" });
    await expect.element(removeBtn).toBeVisible();

    await removeBtn.click();
    expect(screen.container.querySelector(".pending-card")).toBeNull();
  });
});
