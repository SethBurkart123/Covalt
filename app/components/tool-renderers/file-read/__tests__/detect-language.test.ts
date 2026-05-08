import { describe, expect, it } from "vitest";
import { detectLanguage } from "../detect-language";

describe("detectLanguage", () => {
  it("maps common extensions to languages", () => {
    expect(detectLanguage("foo.ts")).toBe("typescript");
    expect(detectLanguage("foo.tsx")).toBe("tsx");
    expect(detectLanguage("foo.js")).toBe("javascript");
    expect(detectLanguage("foo.jsx")).toBe("jsx");
    expect(detectLanguage("foo.py")).toBe("python");
    expect(detectLanguage("foo.rs")).toBe("rust");
    expect(detectLanguage("foo.go")).toBe("go");
    expect(detectLanguage("foo.json")).toBe("json");
    expect(detectLanguage("foo.yaml")).toBe("yaml");
    expect(detectLanguage("foo.yml")).toBe("yaml");
    expect(detectLanguage("foo.md")).toBe("markdown");
    expect(detectLanguage("foo.html")).toBe("html");
    expect(detectLanguage("foo.css")).toBe("css");
    expect(detectLanguage("foo.sh")).toBe("bash");
  });

  it("falls back to plaintext for unknown extension", () => {
    expect(detectLanguage("foo.xyzunknown")).toBe("plaintext");
    expect(detectLanguage("noextension")).toBe("plaintext");
    expect(detectLanguage("")).toBe("plaintext");
  });

  it("override wins over extension", () => {
    expect(detectLanguage("foo.ts", "rust")).toBe("rust");
    expect(detectLanguage("foo.unknown", "python")).toBe("python");
  });

  it("handles full paths and case-insensitive extensions", () => {
    expect(detectLanguage("/Users/x/foo/bar.TS")).toBe("typescript");
    expect(detectLanguage("./relative/path/to/file.PY")).toBe("python");
  });

  it("recognizes special filenames", () => {
    expect(detectLanguage("Dockerfile")).toBe("docker");
    expect(detectLanguage("Makefile")).toBe("makefile");
    expect(detectLanguage("/repo/Dockerfile")).toBe("docker");
  });
});
