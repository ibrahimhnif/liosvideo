import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import type { AgentStatus } from "$lib/chat/api";
import { fakeAgentApi } from "$lib/chat/fake";
import AgentSetup from "./AgentSetup.svelte";

const agents: AgentStatus[] = [
  { id: "gemini", name: "Gemini CLI", state: "ready", version: "0.51.0", custom: false },
  { id: "claude", name: "Claude Code", state: "enable", custom: false },
  { id: "goose", name: "goose", state: "not_installed", installUrl: "https://block.github.io/goose/", custom: false },
];

async function setup() {
  const { api } = fakeAgentApi(agents);
  const screen = await render(AgentSetup, { api });
  return { screen, api };
}

describe("AgentSetup", () => {
  it("shows a control for each state", async () => {
    const { screen } = await setup();
    await expect.element(screen.getByRole("radio", { name: /Gemini CLI/ })).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Enable Claude Code" })).toBeVisible();
    await expect.element(screen.getByRole("link", { name: "Install goose" })).toBeVisible();
  });

  it("streams the adapter install and rescans", async () => {
    const { screen, api } = await setup();
    await screen.getByRole("button", { name: "Enable Claude Code" }).click();
    expect(api.install).toHaveBeenCalledWith("claude", expect.any(Function));
    await expect.element(screen.getByText(/added 12 packages/)).toBeVisible();
    expect(api.rescan).toHaveBeenCalled();
  });

  it("chooses the default agent", async () => {
    const { screen, api } = await setup();
    await screen.getByRole("radio", { name: /Gemini CLI/ }).click();
    expect(api.setDefault).toHaveBeenCalledWith("gemini");
  });

  it("adds a custom agent with parsed args and env", async () => {
    const { screen, api } = await setup();
    await screen.getByLabelText("Name").fill("My agent");
    await screen.getByLabelText("Command").fill("/usr/local/bin/my-agent");
    await screen.getByLabelText("Arguments").fill("--acp  --verbose");
    await screen.getByLabelText("Environment").fill("API_BASE=http://localhost:1234\nMODE=fast");
    await screen.getByRole("button", { name: "Add agent" }).click();
    expect(api.addCustom).toHaveBeenCalledWith({
      id: "my-agent", name: "My agent", command: "/usr/local/bin/my-agent", args: ["--acp", "--verbose"],
      env: { API_BASE: "http://localhost:1234", MODE: "fast" },
    });
  });
});
