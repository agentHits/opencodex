import { expect, test } from "bun:test";
import { isModelPickerUsage, isPickerOrderSaved, isPickerOrderSettings, modelPickerOrder, modelPickerOrderMode } from "../src/model-picker-order";

const models = ["zeta/beta", "alpha/zeta", "alpha/alpha"];

test("presets save deterministic model/provider ordering and Default clears", () => {
  expect(modelPickerOrder("alphabetical", models)).toEqual(["alpha/alpha", "zeta/beta", "alpha/zeta"]);
  expect(modelPickerOrder("provider", [...models, models[0]!])).toEqual(["alpha/alpha", "alpha/zeta", "zeta/beta"]);
  expect(modelPickerOrder("default", models)).toBeNull();
  expect(models).toEqual(["zeta/beta", "alpha/zeta", "alpha/alpha"]);
});
test("Most used sums requested identities and only falls back for missing requested identities", () => {
  expect(modelPickerOrder("most-used", models, [
    { provider: "alpha", model: "zeta", resolvedModel: "alpha", requests: 4 },
    { provider: "alpha", model: "alpha/zeta", requests: 4 },
    { provider: "zeta", model: "missing", resolvedModel: "beta", requests: 3 },
  ])).toEqual(["alpha/zeta", "zeta/beta", "alpha/alpha"]);
  expect(modelPickerOrder("most-used", models, [])).toEqual(["alpha/alpha", "alpha/zeta", "zeta/beta"]);
});
test("raw slash-bearing ids resolve through observed canonical identities, never guessed namespaces", () => {
  const available = ["vendor/team-model", "vendor/other", "team/model"];
  expect(modelPickerOrder("most-used", available, [{ provider: "vendor", model: "team/model", requests: 9 }],
    [{ provider: "vendor", id: "team/model", namespaced: "vendor/team-model" }]))
    .toEqual(["vendor/team-model", "team/model", "vendor/other"]);
  expect(modelPickerOrder("most-used", available, [{ provider: "vendor", model: "team/model", requests: 9 }]))
    .toEqual(["team/model", "vendor/other", "vendor/team-model"]);
});
test("ambiguous raw identity does not choose a catalog row", () => {
  expect(modelPickerOrder("most-used", ["p/a", "p/b"], [{ provider: "p", model: "upstream", resolvedModel: "b", requests: 9 }], [
    { provider: "p", id: "upstream", namespaced: "p/a" }, { provider: "p", id: "upstream", namespaced: "p/b" },
  ])).toEqual(["p/a", "p/b"]);
});
test("saved mode is snapshot provenance across roster drift; full native orders remain Custom", () => {
  expect(modelPickerOrderMode(models, [])).toBe("default");
  expect(modelPickerOrderMode(models, ["alpha/alpha", "alpha/zeta", "zeta/beta"])).toBe("provider");
  expect(modelPickerOrderMode([...models, "new/model"], ["gone/model", "alpha/zeta"], "most-used")).toBe("most-used");
  expect(modelPickerOrderMode(models, ["gpt-5.5", "alpha/zeta"], "most-used")).toBe("custom");
  expect(modelPickerOrderMode(models, ["alpha/zeta"])).toBe("custom");
});
test("transport guards reject missing/malformed state instead of synthesizing a successful reset", () => {
  expect(isPickerOrderSettings({ pickerAvailable: [], pickerOrder: [], pickerOrderMode: null })).toBe(true);
  for (const value of [undefined, null, {}, { pickerOrder: [] }, { pickerOrder: [], pickerOrderMode: "default" }]) {
    expect(isPickerOrderSaved(value)).toBe(false);
  }
  expect(isModelPickerUsage([])).toBe(true);
  expect(isModelPickerUsage([{ provider: "p", model: "a", requests: -1 }])).toBe(false);
  expect(isModelPickerUsage([{ provider: "p", model: "a", requests: Infinity }])).toBe(false);
});


test("encoded collisions cannot attribute usage to an unproven winner", () => {
  expect(modelPickerOrder("most-used", ["p/a", "p/team-model"],
    [{ provider: "p", model: "team/model", requests: 100 }], [
      { provider: "p", id: "team/model", namespaced: "p/team-model" },
      { provider: "p", id: "team-model", namespaced: "p/team-model" },
    ])).toEqual(["p/a", "p/team-model"]);
});
