/**
 * Streaming markdown regression harness.
 *
 *   bun run scripts/snapshot-stream.ts record    # write baseline
 *   bun run scripts/snapshot-stream.ts check     # diff against baseline
 *   bun run scripts/snapshot-stream.ts dump <i>  # print frame i (debugging)
 *
 * For every prefix length 0..N of demo.md it runs:
 *   raw chunk -> preprocessPartialMarkdown -> md4w mdToHtml
 * and records the resulting HTML. Compare against the baseline to catch
 * regressions across the whole streaming surface.
 */

import { createHash } from "node:crypto";
import { init, mdToHtml, setCodeHighlighter } from "md4w";
import { preprocessPartialMarkdown } from "@/lib/markdown/partial";

const DEMO_PATH = new URL("./snapshots/demo.md", import.meta.url).pathname;
const SNAP_PATH = new URL("./snapshots/demo.snapshot.json", import.meta.url).pathname;

const wasmBytes = await Bun.file(
  new URL("../node_modules/md4w/js/md4w-fast.wasm", import.meta.url).pathname,
).arrayBuffer();
await init(wasmBytes);

setCodeHighlighter((language, code) => {
  const safe = language.replace(/[^\w-]/g, "") || "text";
  return `<div class="markdown-code-block"><pre><code class="language-${safe}">${code}</code></pre></div>`;
});

const PARSE_FLAGS = [
  "TABLES",
  "STRIKETHROUGH",
  "TASKLISTS",
  "LATEX_MATH_SPANS",
  "PERMISSIVE_URL_AUTO_LINKS",
  "PERMISSIVE_ATX_HEADERS",
  "COLLAPSE_WHITESPACE",
  "NO_HTML_BLOCKS",
  "NO_HTML_SPANS",
] as const;

function render(source: string): string {
  if (!source) return "";
  try {
    return mdToHtml(source, { parseFlags: [...PARSE_FLAGS] });
  } catch (e) {
    return `<<THREW: ${(e as Error).message}>>`;
  }
}

interface Frame {
  i: number;
  pre: string;
  html: string;
}

interface Snapshot {
  demoHash: string;
  frameCount: number;
  framesHash: string;
  collapsedFrames: Frame[];
}

function buildFrames(demo: string): Frame[] {
  const frames: Frame[] = [];
  let lastHtml: string | null = null;
  for (let i = 0; i <= demo.length; i++) {
    const chunk = demo.slice(0, i);
    const pre = preprocessPartialMarkdown(chunk);
    const html = render(pre);
    if (html !== lastHtml) {
      frames.push({ i, pre, html });
      lastHtml = html;
    }
  }
  return frames;
}

function hashFrames(frames: Frame[]): string {
  const h = createHash("sha256");
  for (const f of frames) {
    h.update(`${f.i}\x00${f.pre}\x00${f.html}\n`);
  }
  return h.digest("hex");
}

const mode = process.argv[2] ?? "check";
const demo = await Bun.file(DEMO_PATH).text();
const demoHash = createHash("sha256").update(demo).digest("hex");
const frames = buildFrames(demo);
const framesHash = hashFrames(frames);

if (mode === "record") {
  const snap: Snapshot = {
    demoHash,
    frameCount: frames.length,
    framesHash,
    collapsedFrames: frames,
  };
  await Bun.write(SNAP_PATH, JSON.stringify(snap, null, 2));
  console.log(`recorded ${frames.length} unique frames (of ${demo.length + 1} prefixes)`);
  console.log(`framesHash: ${framesHash}`);
  process.exit(0);
}

if (mode === "dump") {
  const target = Number(process.argv[3] ?? -1);
  const frame = frames.find((f) => f.i === target) ?? frames[frames.length - 1];
  console.log(JSON.stringify(frame, null, 2));
  process.exit(0);
}

const snapText = await Bun.file(SNAP_PATH).text().catch(() => "");
if (!snapText) {
  console.error("no snapshot found; run 'bun run scripts/snapshot-stream.ts record' first");
  process.exit(2);
}
const baseline = JSON.parse(snapText) as Snapshot;

if (baseline.demoHash !== demoHash) {
  console.error("demo.md changed; re-record the baseline if this is intentional");
  console.error(`  baseline demoHash: ${baseline.demoHash}`);
  console.error(`  current  demoHash: ${demoHash}`);
  process.exit(2);
}

if (baseline.framesHash === framesHash) {
  console.log(`ok: ${frames.length} unique frames match baseline`);
  process.exit(0);
}

console.error("REGRESSION: framesHash mismatch");
const baselineByI = new Map(baseline.collapsedFrames.map((f) => [f.i, f]));
const currentByI = new Map(frames.map((f) => [f.i, f]));
const allI = new Set<number>([...baselineByI.keys(), ...currentByI.keys()]);
const diffs: Array<{ i: number; baseline?: Frame; current?: Frame }> = [];
for (const i of [...allI].sort((a, b) => a - b)) {
  const b = baselineByI.get(i);
  const c = currentByI.get(i);
  if (!b || !c || b.html !== c.html || b.pre !== c.pre) {
    diffs.push({ i, baseline: b, current: c });
  }
}
console.error(`differing frames: ${diffs.length}`);
const preview = diffs.slice(0, 5);
for (const d of preview) {
  console.error(`--- frame i=${d.i} ---`);
  console.error(`  baseline.pre  : ${JSON.stringify(d.baseline?.pre)}`);
  console.error(`  current .pre  : ${JSON.stringify(d.current?.pre)}`);
  console.error(`  baseline.html : ${JSON.stringify(d.baseline?.html)}`);
  console.error(`  current .html : ${JSON.stringify(d.current?.html)}`);
}
if (diffs.length > preview.length) {
  console.error(`(...and ${diffs.length - preview.length} more)`);
}
process.exit(1);
