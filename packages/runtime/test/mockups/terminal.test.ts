import { describe, expect, it } from "vitest";
import { terminal, TerminalNode } from "../../src/mockups/terminal";

describe("terminal", () => {
  it("creates a terminal with shell prompt and typing animation", () => {
    const term = terminal({ cwd: "~/projects", width: 800, height: 500 });
    expect(term).toBeInstanceOf(TerminalNode);
    expect(term.prompt).toContain("~/projects");

    term.type("npm install", { at: 1.0, duration: 1.0 });
    term.writeln("added 14 packages in 1s", 2.0);

    const mid = term.textAt(1.5);
    expect(mid).toContain("npm");
    const end = term.textAt(2.5);
    expect(end).toContain("added 14 packages in 1s");
  });
});
