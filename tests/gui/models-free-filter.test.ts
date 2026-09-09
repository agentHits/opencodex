import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { filterFreeModelRows, modelPricingKnown, type ModelRow } from "../../gui/src/pages/models-shared";
import { repoPath } from "../helpers/repo-root";

/**
 * Regression coverage for #3666 — the Dashboard half.
 *
 * Both catalog surfaces (the Models page provider group and the provider workspace inventory)
 * share one predicate so they cannot drift into disagreeing about what "free" means. The
 * filter runs BEFORE each surface's own search, enabled-first sort, and page slice: applying
 * it afterwards would leave free models stranded behind Show more on a 200-row OpenRouter
 * list, which is exactly the case the issue reports.
 */
function row(id: string, pricingStatus?: "free" | "paid"): ModelRow {
  return {
    provider: "openrouter",
    id,
    namespaced: `openrouter/${id}`,
    disabled: false,
    ...(pricingStatus ? { pricingStatus } : {}),
  };
}

describe("Dashboard free-only model filter (#3666)", () => {
  const rows = [row("gemma:free", "free"), row("claude-sonnet-5", "paid"), row("mystery")];

  test("free-only keeps exactly the rows the provider priced at zero", () => {
    expect(filterFreeModelRows(rows, true).map(r => r.id)).toEqual(["gemma:free"]);
  });

  test("an unclassified row is never treated as free", () => {
    // Absent pricingStatus means the provider published no usable rate pair, or the row came
    // from a cache written before the field existed. Neither is evidence of $0.
    expect(filterFreeModelRows([row("mystery")], true)).toEqual([]);
  });

  test("off, the filter passes every row through unchanged and in order", () => {
    expect(filterFreeModelRows(rows, false).map(r => r.id)).toEqual(rows.map(r => r.id));
  });

  test("the control is offered only where discovery actually returned prices", () => {
    // A provider whose rows are all unclassified would otherwise get a switch whose only
    // possible effect is to empty its own list, which reads as a broken filter.
    expect(modelPricingKnown([row("llama3.2"), row("qwen3")])).toBe(false);
    expect(modelPricingKnown(rows)).toBe(true);
    expect(modelPricingKnown([row("claude-sonnet-5", "paid")])).toBe(true);
    expect(modelPricingKnown([])).toBe(false);
  });

  test("filtering does not mutate the caller's list", () => {
    const source = [...rows];
    filterFreeModelRows(source, true);
    expect(source.map(r => r.id)).toEqual(rows.map(r => r.id));
  });
});

/**
 * The predicate cases above pin WHAT is kept. They cannot see WHERE the filter runs, and the
 * placement is the half that actually closes #3666: a build that filtered after
 * `sorted.slice(0, shown)` would keep every predicate case green while leaving free models
 * stranded behind Show more on a 200-row OpenRouter list — the exact symptom reported.
 *
 * Both consumers are read as source because the ordering is a property of the pipeline, not of
 * any value either component returns.
 */
describe("free-only runs before the page slice (#3666)", () => {
  const modelsPage = readFileSync(repoPath("gui", "src", "pages", "Models.tsx"), "utf8");
  const inventory = readFileSync(
    repoPath("gui", "src", "components", "provider-workspace", "ProviderModels.tsx"),
    "utf8",
  );

  /** Index of one landmark, asserted present so a rename fails loudly instead of vacuously. */
  function at(source: string, needle: string): number {
    const index = source.indexOf(needle);
    expect(index, `landmark not found: ${needle}`).toBeGreaterThan(-1);
    return index;
  }

  test("the Models page filters, then searches, then sorts, then slices", () => {
    const filter = at(modelsPage, "const scoped = filterFreeModelRows(rows, freeOnlyOn)");
    const search = at(modelsPage, "scoped.filter(m => m.id.toLowerCase().includes(q))");
    const sort = at(modelsPage, "filtered.toSorted(");
    const slice = at(modelsPage, "sorted.slice(0, shown)");
    expect(filter).toBeLessThan(search);
    expect(search).toBeLessThan(sort);
    expect(sort).toBeLessThan(slice);
  });

  test("the provider inventory filters before its chip render cap", () => {
    const filter = at(inventory, "filterFreeModelRows(visible, freeOnly)");
    const slice = at(inventory, "filtered.slice(0, CHIP_RENDER_CAP)");
    expect(filter).toBeLessThan(slice);
  });

  test("the group header counts the scoped set, not the whole provider", () => {
    // With Free only on, a header reading `rows.length` claims more models than the list under
    // it shows. The bulk actions read the same set, so "All on" cannot reach rows the header is
    // not counting.
    //
    // Scoped to the renderGroup body on purpose. The provider rail further down the file renders
    // the same models.active label from its own locally computed activeCount, and it SHOULD keep
    // reading the whole provider: it is a navigation index answering "how big is this provider",
    // not a description of the list the user is currently looking at.
    const start = at(modelsPage, "const renderGroup = (group:");
    const end = at(modelsPage, "models-workspace-rail-row");
    expect(start).toBeLessThan(end);
    const group = modelsPage.slice(start, end);
    expect(group).toContain('t("models.active", { active: activeCount, total: scoped.length })');
    expect(group).toContain("const activeCount = scoped.filter(isVisible).length");
    expect(group).toContain("scoped.map(m => ({ id: m.id, native: m.native === true }))");
    expect(group).not.toContain('total: rows.length })');
  });
});
