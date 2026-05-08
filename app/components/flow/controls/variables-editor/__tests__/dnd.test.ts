import { describe, expect, it } from "vitest";
import type { VariableSpec } from "@nodes/_variables";
import {
  buildContainerMap,
  findFieldContainer,
  flattenContainerMap,
  moveField,
  reorderFolders,
  syncFolderOrder,
  targetFromOver,
  type ContainerMap,
} from "@/components/flow/controls/variables-editor/dnd";
import { ROOT_CONTAINER } from "@/components/flow/controls/variables-editor/shared";

function makeSpec(id: string, section?: string): VariableSpec {
  return {
    id,
    label: id,
    control: { kind: "text" },
    placement: "header",
    ...(section ? { section } : {}),
  };
}

function specsById(specs: VariableSpec[]): Map<string, VariableSpec> {
  return new Map(specs.map((s) => [s.id, s]));
}

describe("buildContainerMap", () => {
  it("places sectionless specs in ROOT and groups sectioned specs", () => {
    const specs = [
      makeSpec("a"),
      makeSpec("b", "Group"),
      makeSpec("c"),
      makeSpec("d", "Group"),
    ];
    const map = buildContainerMap(specs, []);
    expect(map.order).toEqual([ROOT_CONTAINER, "Group"]);
    expect(map.items[ROOT_CONTAINER]).toEqual(["a", "c"]);
    expect(map.items.Group).toEqual(["b", "d"]);
  });

  it("preserves caller-provided knownFolderOrder even with empty folders", () => {
    const specs = [makeSpec("a", "Beta")];
    const map = buildContainerMap(specs, ["Alpha", "Beta"]);
    expect(map.order).toEqual([ROOT_CONTAINER, "Alpha", "Beta"]);
    expect(map.items.Alpha).toEqual([]);
    expect(map.items.Beta).toEqual(["a"]);
  });

  it("appends new sections discovered from specs after known order", () => {
    const specs = [makeSpec("a", "New"), makeSpec("b", "Beta")];
    const map = buildContainerMap(specs, ["Beta"]);
    expect(map.order).toEqual([ROOT_CONTAINER, "Beta", "New"]);
  });
});

describe("flattenContainerMap", () => {
  it("emits root specs without section, sectioned specs with section", () => {
    const specs = [makeSpec("a"), makeSpec("b", "G")];
    const map: ContainerMap = {
      order: [ROOT_CONTAINER, "G"],
      items: { [ROOT_CONTAINER]: ["a"], G: ["b"] },
    };
    const out = flattenContainerMap(map, specsById(specs));
    expect(out).toEqual([
      { id: "a", label: "a", control: { kind: "text" }, placement: "header" },
      { id: "b", label: "b", control: { kind: "text" }, placement: "header", section: "G" },
    ]);
  });

  it("strips section when moving a sectioned spec to root", () => {
    const specs = [makeSpec("a", "Old")];
    const map: ContainerMap = {
      order: [ROOT_CONTAINER, "Old"],
      items: { [ROOT_CONTAINER]: ["a"], Old: [] },
    };
    const out = flattenContainerMap(map, specsById(specs));
    expect(out).toHaveLength(1);
    expect(out[0]).not.toHaveProperty("section");
  });

  it("rewrites section when moving between folders", () => {
    const specs = [makeSpec("a", "Old")];
    const map: ContainerMap = {
      order: [ROOT_CONTAINER, "Old", "New"],
      items: { [ROOT_CONTAINER]: [], Old: [], New: ["a"] },
    };
    const out = flattenContainerMap(map, specsById(specs));
    expect(out[0].section).toBe("New");
  });

  it("skips ids missing from specsById", () => {
    const map: ContainerMap = {
      order: [ROOT_CONTAINER],
      items: { [ROOT_CONTAINER]: ["ghost", "real"] },
    };
    const out = flattenContainerMap(map, specsById([makeSpec("real")]));
    expect(out.map((s) => s.id)).toEqual(["real"]);
  });
});

describe("findFieldContainer", () => {
  it("returns the container holding the spec id", () => {
    const map = buildContainerMap([makeSpec("a"), makeSpec("b", "G")], []);
    expect(findFieldContainer(map, "a")).toBe(ROOT_CONTAINER);
    expect(findFieldContainer(map, "b")).toBe("G");
    expect(findFieldContainer(map, "missing")).toBeNull();
  });
});

describe("targetFromOver", () => {
  const specs = [makeSpec("a"), makeSpec("b", "G"), makeSpec("c", "G")];
  const map = buildContainerMap(specs, []);

  it("targets ROOT end when over=ROOT_CONTAINER", () => {
    expect(targetFromOver(map, ROOT_CONTAINER)).toEqual({
      containerId: ROOT_CONTAINER,
      index: 1,
    });
  });

  it("targets folder end when over='folder:NAME'", () => {
    expect(targetFromOver(map, "folder:G")).toEqual({ containerId: "G", index: 2 });
  });

  it("returns null for unknown folder", () => {
    expect(targetFromOver(map, "folder:Nope")).toBeNull();
  });

  it("targets the field's container at its index when over='field:ID'", () => {
    expect(targetFromOver(map, "field:c")).toEqual({ containerId: "G", index: 1 });
  });

  it("returns null for unknown field id and unknown identifier", () => {
    expect(targetFromOver(map, "field:zzz")).toBeNull();
    expect(targetFromOver(map, "garbage")).toBeNull();
  });
});

describe("moveField", () => {
  it("moves a field within the same container", () => {
    const map = buildContainerMap(
      [makeSpec("a"), makeSpec("b"), makeSpec("c")],
      [],
    );
    const next = moveField(map, "c", ROOT_CONTAINER, 0);
    expect(next.items[ROOT_CONTAINER]).toEqual(["c", "a", "b"]);
  });

  it("adjusts index when moving forward in the same container", () => {
    const map = buildContainerMap(
      [makeSpec("a"), makeSpec("b"), makeSpec("c")],
      [],
    );
    const next = moveField(map, "a", ROOT_CONTAINER, 2);
    expect(next.items[ROOT_CONTAINER]).toEqual(["b", "a", "c"]);
  });

  it("moves a field across containers", () => {
    const map = buildContainerMap(
      [makeSpec("a"), makeSpec("b", "G")],
      [],
    );
    const next = moveField(map, "a", "G", 0);
    expect(next.items[ROOT_CONTAINER]).toEqual([]);
    expect(next.items.G).toEqual(["a", "b"]);
  });

  it("clamps target index above container length", () => {
    const map = buildContainerMap([makeSpec("a"), makeSpec("b")], []);
    const next = moveField(map, "a", ROOT_CONTAINER, 99);
    expect(next.items[ROOT_CONTAINER]).toEqual(["b", "a"]);
  });

  it("returns same map when source/target containers are missing", () => {
    const map = buildContainerMap([makeSpec("a")], []);
    expect(moveField(map, "ghost", ROOT_CONTAINER, 0)).toBe(map);
    expect(moveField(map, "a", "Missing", 0)).toBe(map);
  });

  it("does not mutate input map (returns new structure)", () => {
    const map = buildContainerMap([makeSpec("a"), makeSpec("b")], []);
    const before = JSON.stringify(map);
    moveField(map, "a", ROOT_CONTAINER, 1);
    expect(JSON.stringify(map)).toBe(before);
  });
});

describe("reorderFolders", () => {
  it("returns a new array swapping the given folders", () => {
    expect(reorderFolders(["a", "b", "c"], "a", "c")).toEqual(["b", "c", "a"]);
  });

  it("returns null if from or to is unknown or equal", () => {
    expect(reorderFolders(["a", "b"], "a", "a")).toBeNull();
    expect(reorderFolders(["a", "b"], "x", "a")).toBeNull();
    expect(reorderFolders(["a", "b"], "a", "x")).toBeNull();
  });

  it("does not mutate input array (no render-time mutation)", () => {
    const input = ["a", "b", "c"];
    const snapshot = [...input];
    reorderFolders(input, "a", "c");
    expect(input).toEqual(snapshot);
  });
});

describe("syncFolderOrder", () => {
  it("returns same reference when current matches discovered order", () => {
    const current = ["A", "B"];
    const specs = [makeSpec("a", "A"), makeSpec("b", "B")];
    expect(syncFolderOrder(current, specs)).toBe(current);
  });

  it("drops folders no longer present in specs", () => {
    const current = ["A", "B"];
    const specs = [makeSpec("a", "A")];
    expect(syncFolderOrder(current, specs)).toEqual(["A"]);
  });

  it("appends new folders discovered in specs", () => {
    const current = ["A"];
    const specs = [makeSpec("a", "A"), makeSpec("b", "B")];
    expect(syncFolderOrder(current, specs)).toEqual(["A", "B"]);
  });

  it("ignores blank/whitespace section names", () => {
    const specs = [makeSpec("a"), { ...makeSpec("b"), section: "   " }];
    expect(syncFolderOrder([], specs as VariableSpec[])).toEqual([]);
  });
});
