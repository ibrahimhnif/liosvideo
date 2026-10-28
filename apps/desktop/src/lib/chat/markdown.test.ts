import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown";

describe("renderMarkdown", () => {
  it("returns empty string for falsy input", () => {
    expect(renderMarkdown("")).toBe("");
  });

  it("renders inline bold and code formatting", () => {
    const html = renderMarkdown("Hello **world** with `code`");
    expect(html).toContain("<strong>world</strong>");
    expect(html).toContain("<code>code</code>");
  });

  it("renders fenced code blocks", () => {
    const input = "```ts\nconst x = 42;\n```";
    const html = renderMarkdown(input);
    expect(html).toContain("<pre>");
    expect(html).toContain("const x = 42;");
  });

  it("renders unordered and ordered lists", () => {
    const input = "- Item 1\n- Item 2";
    const html = renderMarkdown(input);
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>Item 1</li>");
    expect(html).toContain("<li>Item 2</li>");
  });

  it("escapes raw html for security", () => {
    const input = "<script>alert(1)</script>";
    const html = renderMarkdown(input);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});
