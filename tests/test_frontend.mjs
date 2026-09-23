import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

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

test("dashboard separates periodic progress from administrative long-term score", async () => {
  const source = await readFile(
    new URL("../custom_components/bodik/frontend/bodik-panel.js", import.meta.url),
    "utf8",
  );
  const dashboard = source.slice(source.indexOf("  _renderDashboard() {"), source.indexOf("  _renderReasonGroups() {"));
  const quickActions = source.slice(source.indexOf("  _renderQuickActions() {"), source.indexOf("  _renderSettings() {"));
  const settings = source.slice(source.indexOf("  _renderSettings() {"), source.indexOf("  _renderPeriodicSettings() {"));
  assert.ok(dashboard.indexOf("this._renderPeriodicDashboard()") < dashboard.indexOf("Historické / dlouhodobé skóre"));
  assert.match(dashboard, /Nemění denní, týdenní ani měsíční výkon/);
  assert.match(source, /monthly\.first_paying_threshold\.points_remaining/);
  assert.match(quickActions, /Rychlé změny výkonu/);
  assert.doesNotMatch(quickActions, /set_score|set-value|Vynulovat/);
  assert.match(settings, /Administrativní dlouhodobé skóre/);
  assert.match(settings, /Nastavit dlouhodobé skóre/);
  assert.match(settings, /Vynulovat dlouhodobé skóre/);
  assert.match(source, /input\.value\.trim\(\) === ""/);
  assert.doesNotMatch(source, />Vynulovat<|>Nastavit skóre</);
});

test("reason action menu opens one card, supports keyboard, and closes outside", async () => {
  const source = await readFile(
    new URL("../custom_components/bodik/frontend/bodik-panel.js", import.meta.url), "utf8",
  );
  const start = source.indexOf("class BodikPanel extends LitElement {");
  const end = source.indexOf("\nif (!customElements.get", start);
  assert.ok(start >= 0 && end > start);
  const context = vm.createContext({ LitElement: class {} });
  vm.runInContext(`${source.slice(start, end)}\nglobalThis.BodikPanel = BodikPanel;`, context);
  const panel = Object.create(context.BodikPanel.prototype);
  const card = {};
  const focused = [];
  const first = { focus: () => { panel.shadowRoot.activeElement = first; focused.push("edit"); } };
  const second = { focus: () => { panel.shadowRoot.activeElement = second; focused.push("delete"); } };
  const trigger = { focus: () => focused.push("trigger") };
  panel.updateComplete = Promise.resolve();
  panel._openReasonMenuId = null;
  panel.shadowRoot = {
    activeElement: null,
    querySelector(selector) {
      if (selector.endsWith(".reason-menu button")) return first;
      if (selector.endsWith(".reason-menu-trigger")) return trigger;
      if (selector.startsWith(".reason-card")) return card;
      return null;
    },
  };
  await panel._toggleReasonMenu("reason-a");
  assert.equal(panel._openReasonMenuId, "reason-a");
  assert.equal(focused.at(-1), "edit");
  panel._handleReasonMenuKeydown({
    key: "ArrowDown", currentTarget: { querySelectorAll: () => [first, second] },
    preventDefault() {},
  });
  assert.equal(focused.at(-1), "delete");
  await panel._toggleReasonMenu("reason-b");
  assert.equal(panel._openReasonMenuId, "reason-b");
  panel._handleReasonMenuOutside({ composedPath: () => [card] });
  assert.equal(panel._openReasonMenuId, "reason-b");
  panel._handleReasonMenuOutside({ composedPath: () => [{}] });
  assert.equal(panel._openReasonMenuId, null);
  await panel._toggleReasonMenu("reason-a");
  let prevented = false;
  await panel._handleReasonMenuEscape({ key: "Escape", preventDefault: () => { prevented = true; } });
  assert.equal(panel._openReasonMenuId, null);
  assert.equal(prevented, true);
  assert.equal(focused.at(-1), "trigger");
});

test("reason cards use wide compact grid and hidden destructive menu action", async () => {
  const [panel, styles] = await Promise.all([
    readFile(new URL("../custom_components/bodik/frontend/bodik-panel.js", import.meta.url), "utf8"),
    readFile(new URL("../custom_components/bodik/frontend/bodik-panel.css", import.meta.url), "utf8"),
  ]);
  const displayCard = panel.slice(panel.indexOf(': html`<article class="manage-item reason-card'), panel.indexOf("  async _toggleReasonMenu"));
  assert.match(displayCard, /reason-card-top/);
  assert.match(displayCard, /reason-card-bottom/);
  assert.match(displayCard, /reason-menu-trigger/);
  assert.match(displayCard, /role="menuitem"/);
  assert.match(displayCard, /class="destructive"/);
  assert.match(styles, /\.manage-grid\s*\{[^}]*335px/s);
  assert.match(styles, /\.reason-card\s*\{[^}]*align-self:\s*start/s);
  assert.match(styles, /\.reason-card-name\s*\{[^}]*overflow-wrap:\s*break-word/s);
  assert.doesNotMatch(styles, /\.manage-item:not\(\.editing\)/);
});
