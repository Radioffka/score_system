const BUILTIN_CATEGORIES = [
  { id: "school", name: "Škola", order: 10 },
  { id: "home", name: "Domov", order: 20 },
  { id: "behaviour", name: "Chování", order: 30 },
  { id: "offline", name: "Offline aktivity", order: 40 },
  { id: "digital", name: "Digitální disciplína", order: 50 },
];

export function defaultReasonCategories() {
  return BUILTIN_CATEGORIES.map((category) => ({ ...category }));
}

export function orderedCategories(categories) {
  return [...categories].sort(
    (left, right) => Number(left.order) - Number(right.order)
      || String(left.name).localeCompare(String(right.name), "cs"),
  );
}

export function normalizeReasonSearch(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("cs")
    .trim();
}

export function filterReasonGroups(reasons, categories, query) {
  const needle = normalizeReasonSearch(query);
  const matching = reasons.filter((reason) =>
    normalizeReasonSearch(reason.name).includes(needle));
  const known = orderedCategories(categories);
  const groups = known.map((category) => ({
    category,
    reasons: matching.filter((reason) => reason.category === category.id),
  }));
  groups.push({
    category: { id: "", name: "Bez kategorie", order: Number.MAX_SAFE_INTEGER },
    reasons: matching.filter((reason) => !reason.category),
  });
  return groups.filter((group) => group.reasons.length > 0);
}

export function entitlementView(status, config) {
  const daily = status.daily;
  const surplus = Math.max(0, Number(daily.points) - Number(daily.target));
  const step = Math.max(1, Number(config.bonus_step_points));
  return {
    todayMinutes: Number(daily.today_entitlement),
    tomorrowMinutes: Number(daily.tomorrow_entitlement_preview),
    tomorrowUnlocked: Number(daily.points) >= Number(daily.target),
    missingPoints: Number(daily.remaining),
    pointsToNextBonus: step - (surplus % step || 0),
    canGrowTomorrow: Number(daily.tomorrow_entitlement_preview) < Number(config.max_digital_minutes),
    weeklyReward: status.weekly.active_reward,
    monthlyEstimate: status.monthly.estimated_allowance,
    previousMonthlyResult: status.monthly.previous_result,
  };
}
