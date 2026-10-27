import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import type { CommitInfo, FileDiff, HistoryApi, HistoryStatus } from "$lib/history/api";
import HistoryPanel from "./HistoryPanel.svelte";

const commits: CommitInfo[] = [
  { id: "b".repeat(40), shortId: "bbbbbbb", summary: "Make title bigger", message: "Make title bigger", time: 1_700_000_100 },
  { id: "a".repeat(40), shortId: "aaaaaaa", summary: "Start history", message: "Start history", time: 1_700_000_000 },
];
const diff: FileDiff[] = [
  { path: "scenes/intro.ts", status: "modified", binary: false, truncated: false, patch: "@@ -1 +1 @@\n-old\n+new\n" },
  { path: "assets/images/wall.jpg", status: "added", binary: true, truncated: false, patch: "" },
];

function fakeApi(): HistoryApi & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    history: vi.fn(async () => commits),
    diff: vi.fn(async () => diff),
    checkpoint: vi.fn(async (m: string) => (calls.push(`checkpoint:${m}`), commits[0])),
    restore: vi.fn(async (id: string) => (calls.push(`restore:${id}`), commits[0])),
    enable: vi.fn(async () => (calls.push("enable"), { kind: "enabled" }) as HistoryStatus),
    onCommitted: () => () => {},
  };
}

async function setup(status: HistoryStatus) {
  const api = fakeApi();
  const onStatus = vi.fn();
  const screen = await render(HistoryPanel, { status, api, onStatus });
  return { screen, api, onStatus };
}

describe("HistoryPanel", () => {
  it("offers to enable history for a plain folder", async () => {
    const { screen, api, onStatus } = await setup({ kind: "off" });
    await screen.getByRole("button", { name: "Enable history" }).click();
    expect(api.calls).toEqual(["enable"]);
    expect(onStatus).toHaveBeenCalledWith({ kind: "enabled" });
  });

  it("asks before managing a repo the app didn't create", async () => {
    const { screen, api, onStatus } = await setup({ kind: "unmanaged" });
    await expect.element(screen.getByText(/already a git repository/)).toBeVisible();
    expect(api.history).not.toHaveBeenCalled();
    await screen.getByRole("button", { name: "Manage history here" }).click();
    expect(api.calls).toEqual(["enable"]);
    expect(onStatus).toHaveBeenCalledWith({ kind: "enabled" });
  });

  it("explains why history is disabled inside another repo", async () => {
    const { screen } = await setup({ kind: "nested", repo: "/Users/me/code/liosvideo" });
    await expect.element(screen.getByText(/inside another git repository \(\/Users\/me\/code\/liosvideo\)/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Enable history" }).query()).toBeNull();
  });

  it("lists commits newest first", async () => {
    const { screen } = await setup({ kind: "enabled" });
    await expect.element(screen.getByText("Make title bigger")).toBeVisible();
    const items = screen.getByRole("listitem").elements().map((e) => e.textContent ?? "");
    expect(items[0]).toContain("Make title bigger");
    expect(items[1]).toContain("Start history");
  });

  it("shows a commit's diff when clicked", async () => {
    const { screen, api } = await setup({ kind: "enabled" });
    await screen.getByRole("button", { name: /Make title bigger/ }).click();
    await expect.element(screen.getByText("+new")).toBeVisible();
    await expect.element(screen.getByText("binary file")).toBeVisible();
    expect(api.diff).toHaveBeenCalledWith(commits[0].id);
  });

  it("restores only after confirmation", async () => {
    const { screen, api } = await setup({ kind: "enabled" });
    await screen.getByRole("button", { name: /Start history/ }).click();
    await screen.getByRole("button", { name: "Restore to here" }).click();
    expect(api.calls).toEqual([]);
    await screen.getByRole("button", { name: "Cancel" }).click();
    expect(api.calls).toEqual([]);
    await screen.getByRole("button", { name: "Restore to here" }).click();
    await screen.getByRole("button", { name: "Confirm restore" }).click();
    expect(api.calls).toEqual([`restore:${commits[1].id}`]);
  });

  it("creates a checkpoint with a message", async () => {
    const { screen, api } = await setup({ kind: "enabled" });
    await screen.getByPlaceholder("Checkpoint message").fill("before big change");
    await screen.getByRole("button", { name: "Checkpoint" }).click();
    expect(api.calls).toEqual(["checkpoint:before big change"]);
  });
});
