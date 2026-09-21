import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  entitlementView,
  filterReasonGroups,
  normalizeReasonSearch,
  orderedCategories,
} from "../custom_components/bodik/frontend/bodik-ui-utils.mjs";

test("quick reason search is case and Czech-diacritic insensitive without mutation", () => {
  const reasons = [
    { id: "walk", name: "Venčení psa", category: "home", value: 3 },
    { id: "tidy", name: "Běžný úklid pokoje", category: "home", value: 2 },
  ];
  const categories = [{ id: "home", name: "Domov", order: 20 }];
  const before = JSON.stringify({ reasons, categories });

  assert.equal(normalizeReasonSearch("ÚKLID"), "uklid");
  assert.deepEqual(
    filterReasonGroups(reasons, categories, "uklid")[0].reasons.map((item) => item.id),
    ["tidy"],
  );
  assert.deepEqual(
    filterReasonGroups(reasons, categories, "VEN")[0].reasons.map((item) => item.id),
    ["walk"],
  );
  assert.equal(JSON.stringify({ reasons, categories }), before);
});

test("category ordering uses configured order and keeps stable IDs", () => {
  const categories = [
    { id: "offline", name: "Pohyb", order: 50 },
    { id: "school", name: "Výuka", order: 10 },
  ];
  assert.deepEqual(orderedCategories(categories).map((item) => item.id), ["school", "offline"]);
});

test("entitlement view keeps today and tomorrow semantics separate", () => {
  const view = entitlementView({
    daily: { points: 35, target: 30, remaining: 0, today_entitlement: 135, tomorrow_entitlement_preview: 135 },
    weekly: { active_reward: { enabled: true, unlocked: true, label: "Výlet" } },
    monthly: { estimated_allowance: { amount: 180 }, previous_result: { amount: 200 } },
  }, { bonus_step_points: 5, max_digital_minutes: 180 });
  assert.equal(view.todayMinutes, 135);
  assert.equal(view.tomorrowMinutes, 135);
  assert.equal(view.tomorrowUnlocked, true);
  assert.equal(view.pointsToNextBonus, 5);
  assert.equal(view.monthlyEstimate.amount, 180);
});

test("panel retires the legacy catalogue and labels periodic entitlement semantics", async () => {
  const source = await readFile(
    new URL("../custom_components/bodik/frontend/bodik-panel.js", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /_renderRewardsSummary|_renderRewardSettings|_computeGoals/);
  assert.match(source, /Dnes odemčeno/);
  assert.match(source, /Na zítřek zatím neodemčeno/);
  assert.match(source, /Odhad kapesného/);
  assert.match(source, /✓ Denní cíl splněn/);
});
