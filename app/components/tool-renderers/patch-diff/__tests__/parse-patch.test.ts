import { describe, expect, it } from "vitest";
import { parseOpenAIPatch } from "../parse-patch";

describe("parseOpenAIPatch", () => {
  it("parses a single Update File hunk", () => {
    const patch = [
      "*** Begin Patch",
      "*** Update File: foo.ts",
      "@@",
      "-hello",
      "+world",
      "*** End Patch",
    ].join("\n");
    const files = parseOpenAIPatch(patch);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      path: "foo.ts",
      action: "update",
      additions: 1,
      deletions: 1,
    });
    expect(files[0].oldContent).toBe("hello\n");
    expect(files[0].newContent).toBe("world\n");
  });

  it("parses a multi-file patch", () => {
    const patch = [
      "*** Begin Patch",
      "*** Update File: a.ts",
      "@@",
      " keep",
      "-old",
      "+new",
      "*** Update File: b.ts",
      "@@",
      "+only-added",
      "*** End Patch",
    ].join("\n");
    const files = parseOpenAIPatch(patch);
    expect(files.map((f) => f.path)).toEqual(["a.ts", "b.ts"]);
    expect(files[0].oldContent).toBe("keep\nold\n");
    expect(files[0].newContent).toBe("keep\nnew\n");
    expect(files[1].action).toBe("update");
    expect(files[1].newContent).toBe("only-added\n");
    expect(files[1].oldContent).toBe("");
  });

  it("parses an Add File (creation)", () => {
    const patch = [
      "*** Begin Patch",
      "*** Add File: greet.ts",
      "+export const hi = 'hi'",
      "*** End Patch",
    ].join("\n");
    const files = parseOpenAIPatch(patch);
    expect(files).toHaveLength(1);
    expect(files[0].action).toBe("create");
    expect(files[0].newContent).toBe("export const hi = 'hi'\n");
    expect(files[0].oldContent).toBe("");
  });

  it("parses a Delete File", () => {
    const patch = [
      "*** Begin Patch",
      "*** Delete File: gone.ts",
      "-bye",
      "*** End Patch",
    ].join("\n");
    const files = parseOpenAIPatch(patch);
    expect(files).toHaveLength(1);
    expect(files[0].action).toBe("delete");
    expect(files[0].oldContent).toBe("bye\n");
    expect(files[0].newContent).toBe("");
  });

  it("returns empty array for empty input", () => {
    expect(parseOpenAIPatch("")).toEqual([]);
  });

  it("returns empty array for malformed input without recognised headers", () => {
    expect(parseOpenAIPatch("not a patch at all")).toEqual([]);
  });

  it("handles CRLF line endings", () => {
    const patch = "*** Begin Patch\r\n*** Update File: foo.ts\r\n@@\r\n-old\r\n+new\r\n*** End Patch\r\n";
    const files = parseOpenAIPatch(patch);
    expect(files).toHaveLength(1);
    expect(files[0].newContent).toBe("new\n");
  });
});
