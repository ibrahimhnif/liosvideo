import { describe, expect, it } from "vitest";
import { editor, EditorNode } from "../../src/mockups/editor";

describe("editor", () => {
  it("creates a code editor with tabs, line numbers and highlight", () => {
    const ed = editor({ filename: "server.ts", code: "const app = express();", width: 900, height: 600 });
    expect(ed).toBeInstanceOf(EditorNode);
    expect(ed.tabTitle.propsAt(0).text).toBe("server.ts");

    ed.highlightLine(1, { at: 1.0 });
    expect(ed.isLineHighlighted(1, 1.0)).toBe(true);
    expect(ed.isLineHighlighted(2, 1.0)).toBe(false);
  });
});
