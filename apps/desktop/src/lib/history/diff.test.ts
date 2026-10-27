import { describe, expect, it } from "vitest";
import { diffLines } from "./diff";

describe("diffLines", () => {
  it("classifies headers, hunks, additions, deletions and context", () => {
    const patch = ["diff --git a/a.ts b/a.ts", "index 3367afd..3e75765 100644", "--- a/a.ts", "+++ b/a.ts", "@@ -1 +1 @@", "-old", "+new", " same", ""].join("\n");
    expect(diffLines(patch).map((l) => l.kind)).toEqual(["meta", "meta", "meta", "meta", "hunk", "del", "add", "ctx"]);
    expect(diffLines(patch)[6].text).toBe("+new");
  });

  it("treats new and deleted file headers as meta", () => {
    expect(diffLines("new file mode 100644\n--- /dev/null\n+++ b/x\n+x").map((l) => l.kind)).toEqual(["meta", "meta", "meta", "add"]);
  });

  it("returns nothing for an empty patch", () => {
    expect(diffLines("")).toEqual([]);
  });
});
