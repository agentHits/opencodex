import { describe, expect, test } from "bun:test";
import { filterFreeModelRows, modelPricingKnown, type ModelRow } from "../../gui/src/pages/models-shared";

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
