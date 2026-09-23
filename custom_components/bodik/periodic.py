"""Pure periodic-goal calculations for Bodík v9.

This module deliberately has no Home Assistant imports so boundary, migration and
allowance behaviour can be covered by fast unit tests.
"""

from __future__ import annotations

from calendar import monthrange
from copy import deepcopy
from datetime import date, datetime, time, timedelta, timezone
from math import floor
from typing import Any
from zoneinfo import ZoneInfo

UTC = timezone.utc
WEEKDAYS = range(7)
RESET_SCOPES = ("daily", "weekly", "monthly")
DEFAULT_PAYOUT_BANDS = [
    {"minimum_percent": 0, "payout_percent": 0},
    {"minimum_percent": 50, "payout_percent": 40},
    {"minimum_percent": 70, "payout_percent": 70},
    {"minimum_percent": 85, "payout_percent": 90},
    {"minimum_percent": 100, "payout_percent": 100},
]


class PeriodicValidationError(ValueError):
    """Raised for invalid periodic configuration."""


def parse_utc(value: str) -> datetime:
    """Parse an ISO timestamp and normalize it to aware UTC."""
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def iso_utc(value: datetime) -> str:
    """Serialize an aware datetime in UTC."""
    return value.astimezone(UTC).isoformat()


def _int(value: Any, name: str, minimum: int, maximum: int) -> int:
    if isinstance(value, bool):
        raise PeriodicValidationError(f"{name}: očekáváno celé číslo.")
    try:
        parsed = int(value)
    except (TypeError, ValueError, OverflowError) as err:
        raise PeriodicValidationError(f"{name}: očekáváno celé číslo.") from err
    if not minimum <= parsed <= maximum:
        raise PeriodicValidationError(
            f"{name}: hodnota musí být v rozsahu {minimum} až {maximum}."
        )
    return parsed


def _text(value: Any, name: str, maximum: int, required: bool = False) -> str:
    parsed = "" if value is None else str(value).strip()
    if required and not parsed:
        raise PeriodicValidationError(f"{name}: hodnota je povinná.")
    if len(parsed) > maximum:
        raise PeriodicValidationError(f"{name}: text je příliš dlouhý.")
    return parsed


def default_config() -> dict[str, Any]:
    """Return neutral, editable defaults (family-specific values belong to #3)."""
    return {
        "daily_target": 1,
        "base_digital_minutes": 0,
        "bonus_step_points": 1,
        "bonus_step_minutes": 0,
        "max_digital_minutes": 0,
        "weekly_target": 1,
        "weekly_tick_weekday": 4,
        "weekly_tick_time": "17:00",
        "weekly_reward": {
            "enabled": False,
            "label": "Týdenní odměna",
            "description": "",
        },
        "monthly_target": 1,
        "allowance_at_100": 0,
        "payout_bands": deepcopy(DEFAULT_PAYOUT_BANDS),
        "max_payout_percent": 150,
    }


def validate_config(raw: Any) -> dict[str, Any]:
    """Validate and normalize one profile's periodic settings."""
    if raw is None:
        raw = {}
    if not isinstance(raw, dict):
        raise PeriodicValidationError("Periodické cíle: neplatná konfigurace.")
    defaults = default_config()
    result = {
        "daily_target": _int(raw.get("daily_target", defaults["daily_target"]), "Denní cíl", 1, 1_000_000),
        "base_digital_minutes": _int(raw.get("base_digital_minutes", defaults["base_digital_minutes"]), "Základní digitální čas", 0, 10080),
        "bonus_step_points": _int(raw.get("bonus_step_points", defaults["bonus_step_points"]), "Bonusový krok", 1, 1_000_000),
        "bonus_step_minutes": _int(raw.get("bonus_step_minutes", defaults["bonus_step_minutes"]), "Minuty za bonusový krok", 0, 10080),
        "max_digital_minutes": _int(raw.get("max_digital_minutes", defaults["max_digital_minutes"]), "Maximum digitálního času", 0, 10080),
        "weekly_target": _int(raw.get("weekly_target", defaults["weekly_target"]), "Týdenní cíl", 1, 10_000_000),
        "weekly_tick_weekday": _int(raw.get("weekly_tick_weekday", defaults["weekly_tick_weekday"]), "Den týdenního uzávěru", 0, 6),
        "weekly_tick_time": _text(raw.get("weekly_tick_time", defaults["weekly_tick_time"]), "Čas týdenního uzávěru", 5, True),
        "monthly_target": _int(raw.get("monthly_target", defaults["monthly_target"]), "Měsíční cíl", 1, 10_000_000),
        "allowance_at_100": _int(raw.get("allowance_at_100", defaults["allowance_at_100"]), "Kapesné při 100 %", 0, 1_000_000),
        "max_payout_percent": _int(raw.get("max_payout_percent", defaults["max_payout_percent"]), "Maximum výplaty", 100, 1000),
    }
    try:
        hour_text, minute_text = result["weekly_tick_time"].split(":", 1)
        tick = time(int(hour_text), int(minute_text))
    except (ValueError, TypeError) as err:
        raise PeriodicValidationError("Čas týdenního uzávěru musí být ve formátu HH:MM.") from err
    result["weekly_tick_time"] = tick.strftime("%H:%M")
    if result["base_digital_minutes"] > result["max_digital_minutes"]:
        raise PeriodicValidationError("Základní digitální čas nesmí být vyšší než maximum.")

    reward_raw = raw.get("weekly_reward", defaults["weekly_reward"])
    if not isinstance(reward_raw, dict):
        raise PeriodicValidationError("Týdenní odměna: neplatná konfigurace.")
    enabled = reward_raw.get("enabled", False)
    if not isinstance(enabled, bool):
        raise PeriodicValidationError("Týdenní odměna: zapnutí musí být ano/ne.")
    result["weekly_reward"] = {
        "enabled": enabled,
        "label": _text(reward_raw.get("label", "Týdenní odměna"), "Název týdenní odměny", 120, True),
        "description": _text(reward_raw.get("description", ""), "Popis týdenní odměny", 500),
    }

    bands_raw = raw.get("payout_bands", defaults["payout_bands"])
    if not isinstance(bands_raw, list) or not bands_raw:
        raise PeriodicValidationError("Výplatní pásma musí obsahovat alespoň jednu položku.")
    bands: list[dict[str, int]] = []
    seen: set[int] = set()
    for item in bands_raw:
        if not isinstance(item, dict):
            raise PeriodicValidationError("Výplatní pásmo má neplatný formát.")
        minimum = _int(item.get("minimum_percent"), "Hranice pásma", 0, 100)
        payout = _int(item.get("payout_percent"), "Výplata pásma", 0, 100)
        if minimum in seen:
            raise PeriodicValidationError("Hranice výplatních pásem se nesmí opakovat.")
        seen.add(minimum)
        bands.append({"minimum_percent": minimum, "payout_percent": payout})
    bands.sort(key=lambda item: item["minimum_percent"])
    if bands[0]["minimum_percent"] != 0 or bands[-1]["minimum_percent"] != 100:
        raise PeriodicValidationError("Výplatní pásma musí začínat na 0 % a obsahovat hranici 100 %.")
    if bands[0]["payout_percent"] != 0 or bands[-1]["payout_percent"] != 100:
        raise PeriodicValidationError("Pásmo 0 % musí vyplácet 0 % a pásmo 100 % musí vyplácet 100 %.")
    if any(a["payout_percent"] > b["payout_percent"] for a, b in zip(bands, bands[1:])):
        raise PeriodicValidationError("Výplatní pásma musí být neklesající.")
    result["payout_bands"] = bands
    return result


def digital_entitlement(points: int, config: dict[str, Any]) -> int:
    """Calculate the next-day shared digital entitlement."""
    if points < config["daily_target"]:
        return 0
    minutes = config["base_digital_minutes"]
    minutes += floor((points - config["daily_target"]) / config["bonus_step_points"]) * config["bonus_step_minutes"]
    return min(minutes, config["max_digital_minutes"])


def allowance(points: int, config: dict[str, Any]) -> dict[str, int | float]:
    """Calculate monthly completion and rounded whole-currency allowance."""
    completion = points / config["monthly_target"] * 100
    if completion > 100:
        payout = min(completion, config["max_payout_percent"])
    else:
        payout = 0
        for band in config["payout_bands"]:
            if completion >= band["minimum_percent"]:
                payout = band["payout_percent"]
    amount = floor(config["allowance_at_100"] * payout / 100 + 0.5)
    return {
        "completion_percent": round(completion, 2),
        "payout_percent": round(payout, 2),
        "amount": amount,
    }


def first_paying_threshold(config: dict[str, Any]) -> dict[str, int] | None:
    """Return the first configured monthly band that pays a non-zero amount."""
    for band in config["payout_bands"]:
        payout = band["payout_percent"]
        amount = floor(config["allowance_at_100"] * payout / 100 + 0.5)
        if amount > 0:
            minimum = band["minimum_percent"]
            points = (config["monthly_target"] * minimum + 99) // 100
            return {"minimum_percent": minimum, "points": points}
    return None


def _local_boundary(day: date, clock: time, zone: ZoneInfo) -> datetime:
    """Construct a real local boundary; normalize nonexistent DST wall times."""
    candidate = datetime.combine(day, clock, zone)
    return candidate.astimezone(UTC).astimezone(zone)


def daily_period_start(now: datetime, zone: ZoneInfo) -> datetime:
    local = now.astimezone(zone)
    return _local_boundary(local.date(), time.min, zone).astimezone(UTC)


def next_daily_boundary(start: datetime, zone: ZoneInfo) -> datetime:
    local = start.astimezone(zone)
    return _local_boundary(local.date() + timedelta(days=1), time.min, zone).astimezone(UTC)


def weekly_period_start(now: datetime, config: dict[str, Any], zone: ZoneInfo) -> datetime:
    local = now.astimezone(zone)
    hour, minute = map(int, config["weekly_tick_time"].split(":"))
    days_back = (local.weekday() - config["weekly_tick_weekday"]) % 7
    boundary = _local_boundary(local.date() - timedelta(days=days_back), time(hour, minute), zone)
    if boundary > local:
        boundary = _local_boundary(boundary.date() - timedelta(days=7), time(hour, minute), zone)
    return boundary.astimezone(UTC)


def next_weekly_boundary(start: datetime, config: dict[str, Any], zone: ZoneInfo) -> datetime:
    local = start.astimezone(zone)
    hour, minute = map(int, config["weekly_tick_time"].split(":"))
    days = (config["weekly_tick_weekday"] - local.weekday()) % 7
    candidate = _local_boundary(local.date() + timedelta(days=days), time(hour, minute), zone)
    if candidate <= local:
        candidate = _local_boundary(candidate.date() + timedelta(days=7), time(hour, minute), zone)
    return candidate.astimezone(UTC)


def monthly_period_start(now: datetime, zone: ZoneInfo) -> datetime:
    local = now.astimezone(zone)
    return _local_boundary(date(local.year, local.month, 1), time.min, zone).astimezone(UTC)


def next_monthly_boundary(start: datetime, zone: ZoneInfo) -> datetime:
    local = start.astimezone(zone)
    last = monthrange(local.year, local.month)[1]
    next_day = local.date().replace(day=last) + timedelta(days=1)
    return _local_boundary(next_day, time.min, zone).astimezone(UTC)


def new_state(now: datetime, config: dict[str, Any], zone: ZoneInfo) -> dict[str, Any]:
    """Activate periodic tracking without reinterpreting v8 history."""
    now = now.astimezone(UTC)
    return {
        "tracking_started_at": iso_utc(now),
        "transactions": [],
        "daily_period_started_at": iso_utc(daily_period_start(now, zone)),
        "weekly_period_started_at": iso_utc(weekly_period_start(now, config, zone)),
        "monthly_period_started_at": iso_utc(monthly_period_start(now, zone)),
        "daily_initial_partial": True,
        "weekly_initial_partial": True,
        "monthly_initial_partial": True,
        "daily_results": [],
        "weekly_results": [],
        "monthly_results": [],
        "manual_reset_at": {scope: None for scope in RESET_SCOPES},
        "manual_reset_after": {scope: 0 for scope in RESET_SCOPES},
        "today_digital_entitlement": 0,
        "active_weekly_reward": None,
    }


def transaction_sum(state: dict[str, Any], start: datetime, end: datetime, after: int = 0) -> int:
    """Sum eligible transactions in the half-open UTC interval [start, end)."""
    total = 0
    for index, item in enumerate(state.get("transactions", [])):
        if index < after:
            continue
        if not item.get("counts_toward_periods", False):
            continue
        try:
            when = parse_utc(item["time"])
        except (KeyError, TypeError, ValueError):
            continue
        if start <= when < end:
            total += int(item.get("delta", 0))
    return total


def effective_period_start(
    state: dict[str, Any], scope: str, natural_start: datetime, end: datetime,
    *, include_end: bool = False,
) -> tuple[datetime, int]:
    """Apply a reset marker only within its own natural period."""
    start = max(natural_start, parse_utc(state["tracking_started_at"]))
    after = 0
    marker = state.get("manual_reset_at", {}).get(scope)
    if marker is not None:
        reset_at = parse_utc(marker)
        if natural_start <= reset_at < end or (include_end and reset_at == end):
            start = max(start, reset_at)
            after = state.get("manual_reset_after", {}).get(scope, 0)
    return start, after


def _append_once(results: list[dict[str, Any]], snapshot: dict[str, Any]) -> bool:
    if any(item.get("period_end") == snapshot["period_end"] for item in results):
        return False
    results.append(snapshot)
    return True


def close_periods(state: dict[str, Any], config: dict[str, Any], now: datetime, zone: ZoneInfo) -> bool:
    """Idempotently close every elapsed daily, weekly and monthly period."""
    changed = False
    now = now.astimezone(UTC)
    start = parse_utc(state["daily_period_started_at"])
    while (end := next_daily_boundary(start, zone)) <= now:
        partial = bool(state.get("daily_initial_partial", False))
        effective, after = effective_period_start(state, "daily", start, end)
        points = transaction_sum(state, effective, end, after)
        entitlement = digital_entitlement(points, config)
        snapshot = {
            "period_start": iso_utc(start), "period_end": iso_utc(end),
            "local_date": start.astimezone(zone).date().isoformat(),
            "points": points, "target": config["daily_target"],
            "success": points >= config["daily_target"], "initial_partial": partial,
            "applied": not partial, "next_day_digital_entitlement": entitlement,
        }
        if _append_once(state["daily_results"], snapshot):
            changed = True
            if not partial:
                state["today_digital_entitlement"] = entitlement
        state["daily_initial_partial"] = False
        start = end
        state["daily_period_started_at"] = iso_utc(start)

    start = parse_utc(state["weekly_period_started_at"])
    while (end := next_weekly_boundary(start, config, zone)) <= now:
        partial = bool(state.get("weekly_initial_partial", False))
        effective, after = effective_period_start(state, "weekly", start, end)
        points = transaction_sum(state, effective, end, after)
        reward_cfg = config["weekly_reward"]
        unlocked = bool(reward_cfg["enabled"] and points >= config["weekly_target"])
        snapshot = {
            "period_start": iso_utc(start), "period_end": iso_utc(end),
            "points": points, "target": config["weekly_target"],
            "success": points >= config["weekly_target"], "initial_partial": partial,
            "applied": not partial,
            "reward": {"enabled": reward_cfg["enabled"], "label": reward_cfg["label"],
                       "description": reward_cfg["description"], "unlocked": unlocked,
                       "source_period_start": iso_utc(start),
                       "source_period_end": iso_utc(end),
                       "source_points": points, "source_target": config["weekly_target"]},
        }
        if _append_once(state["weekly_results"], snapshot):
            changed = True
            if not partial:
                state["active_weekly_reward"] = deepcopy(snapshot["reward"])
        state["weekly_initial_partial"] = False
        start = end
        state["weekly_period_started_at"] = iso_utc(start)

    start = parse_utc(state["monthly_period_started_at"])
    while (end := next_monthly_boundary(start, zone)) <= now:
        partial = bool(state.get("monthly_initial_partial", False))
        effective, after = effective_period_start(state, "monthly", start, end)
        points = transaction_sum(state, effective, end, after)
        payout = allowance(points, config)
        snapshot = {
            "period_start": iso_utc(start), "period_end": iso_utc(end),
            "month": start.astimezone(zone).strftime("%Y-%m"),
            "points": points, "target": config["monthly_target"],
            "initial_partial": partial, "applied": not partial, **payout,
        }
        if _append_once(state["monthly_results"], snapshot):
            changed = True
        state["monthly_initial_partial"] = False
        start = end
        state["monthly_period_started_at"] = iso_utc(start)
    return changed


def current_status(state: dict[str, Any], config: dict[str, Any], now: datetime, zone: ZoneInfo) -> dict[str, Any]:
    """Return live progress plus durable previous-result/entitlement state."""
    daily_start = parse_utc(state["daily_period_started_at"])
    weekly_start = parse_utc(state["weekly_period_started_at"])
    monthly_start = parse_utc(state["monthly_period_started_at"])
    daily_effective, daily_after = effective_period_start(state, "daily", daily_start, now, include_end=True)
    weekly_effective, weekly_after = effective_period_start(state, "weekly", weekly_start, now, include_end=True)
    monthly_effective, monthly_after = effective_period_start(state, "monthly", monthly_start, now, include_end=True)
    daily_points = transaction_sum(state, daily_effective, now, daily_after)
    weekly_points = transaction_sum(state, weekly_effective, now, weekly_after)
    monthly_points = transaction_sum(state, monthly_effective, now, monthly_after)
    estimated = allowance(monthly_points, config)
    first_payout = first_paying_threshold(config)
    if first_payout is not None:
        first_payout = {
            **first_payout,
            "points_remaining": max(0, first_payout["points"] - monthly_points),
        }
    return {
        "daily": {"points": daily_points, "target": config["daily_target"],
                  "remaining": max(0, config["daily_target"] - daily_points),
                  "tomorrow_entitlement_preview": digital_entitlement(daily_points, config),
                  "today_entitlement": state.get("today_digital_entitlement", 0),
                  "period_start": iso_utc(daily_start),
                  "previous_result": state.get("daily_results", [])[-1] if state.get("daily_results") else None},
        "weekly": {"points": weekly_points, "target": config["weekly_target"],
                   "period_start": iso_utc(weekly_start),
                   "active_reward": state.get("active_weekly_reward"),
                   "previous_result": state.get("weekly_results", [])[-1] if state.get("weekly_results") else None},
        "monthly": {"points": monthly_points, "target": config["monthly_target"],
                    "period_start": iso_utc(monthly_start), "estimated_allowance": estimated,
                    "first_paying_threshold": first_payout,
                    "previous_result": state.get("monthly_results", [])[-1] if state.get("monthly_results") else None},
    }


def next_boundary(state: dict[str, Any], config: dict[str, Any], zone: ZoneInfo) -> datetime:
    """Return the nearest upcoming boundary for scheduler registration."""
    return min(
        next_daily_boundary(parse_utc(state["daily_period_started_at"]), zone),
        next_weekly_boundary(parse_utc(state["weekly_period_started_at"]), config, zone),
        next_monthly_boundary(parse_utc(state["monthly_period_started_at"]), zone),
    )
