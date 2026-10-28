import { render } from "vitest-browser-svelte";
import { describe, expect, it } from "vitest";
import Markdown from "./Markdown.svelte";

describe("Markdown", () => {
  it("renders markdown elements correctly", async () => {
    const screen = await render(Markdown, {
      content: "# Header\n\nThis is **bold** text and `code`\n\n```ts\nconst a = 1;\n```",
    });

    const h1 = screen.getByRole("heading", { level: 1 });
    await expect.element(h1).toHaveTextContent("Header");

    const strong = screen.container.querySelector("strong");
    expect(strong?.textContent).toBe("bold");

    const pre = screen.container.querySelector("pre");
    expect(pre?.textContent).toContain("const a = 1;");
  });
});
