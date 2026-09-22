"""Persistent and transactional data manager for Bodik."""

from __future__ import annotations

import asyncio
from collections import deque
from copy import deepcopy
from datetime import datetime, timezone
import json
import logging
import os
import re
from typing import Any
from uuid import uuid4

from homeassistant.core import (
    Context,
    Event,
    HomeAssistant,
    State,
    callback,
    valid_entity_id,
)
from homeassistant.helpers.event import async_track_point_in_time, async_track_state_change_event
from homeassistant.helpers.storage import Store

from .const import (
    DOMAIN,
    DATA_VERSION,
    EVENT_UPDATED,
    LEGACY_RELATIVE_PATH,
    MAX_ABS_SCORE,
    MAX_HISTORY,
    MAX_PERIOD_RESULTS,
    MAX_PROFILES,
    MAX_REASON_CATEGORIES,
    MAX_REASONS,
    MAX_REWARDS,
    STORAGE_KEY,
    STORAGE_VERSION,
)
from .family_config import (
    FAMILY_CONFIG_VERSION,
    FAMILY_INITIAL_CONFIG_VERSION,
    FAMILY_TARGETS,
    family_periodic_config,
    family_reason_categories,
    family_reasons,
    is_family_profile,
)
from .periodic import (
    PeriodicValidationError,
    close_periods,
    current_status,
    default_config,
    first_paying_threshold,
    iso_utc,
    new_state,
    next_boundary,
    parse_utc,
    validate_config,
)

_LOGGER = logging.getLogger(__name__)
_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


class BodikValidationError(ValueError):
    """Raised when Bodik data fails validation."""


class BodikConflictError(RuntimeError):
    """Raised when a client tries to save an obsolete revision."""


def _text(value: Any, max_length: int, default: str = "") -> str:
    """Return a trimmed, length-limited string."""
    if value is None:
        return default
    return str(value).strip()[:max_length]


def _integer(value: Any, default: int = 0) -> int:
    """Convert a value to a bounded integer."""
    try:
        result = int(float(value))
    except (TypeError, ValueError, OverflowError):
        result = default
    return max(-MAX_ABS_SCORE, min(MAX_ABS_SCORE, result))


def _optional_positive_integer(value: Any, label: str) -> int | None:
    """Return a strict optional positive integer from untrusted config."""
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        raise BodikValidationError(f"{label} musí být kladné celé číslo.")
    try:
        result = int(value)
        if float(value) != result:
            raise ValueError
    except (TypeError, ValueError, OverflowError) as err:
        raise BodikValidationError(
            f"{label} musí být kladné celé číslo."
        ) from err
    if not 1 <= result <= MAX_ABS_SCORE:
        raise BodikValidationError(f"{label} musí být kladné celé číslo.")
    return result


def _now_iso() -> str:
    """Return a UTC timestamp in ISO format."""
    return datetime.now(timezone.utc).isoformat()


class BodikManager:
    """Own Bodik persistence, validation, score mutations and HA mirrors."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self.store: Store[dict[str, Any]] = Store(
            hass, STORAGE_VERSION, STORAGE_KEY, private=True, atomic_writes=True
        )
        self.data: dict[str, Any] = {}
        self._lock = asyncio.Lock()
        self._unsubscribe_entities = None
        self._unsubscribe_periodic = None
        self._internal_context_order: deque[str] = deque(maxlen=100)
        self._internal_context_ids: set[str] = set()

    async def async_initialize(self) -> None:
        """Load Store data or migrate the legacy public JSON file."""
        stored = await self.store.async_load()
        migrated = False

        if isinstance(stored, dict) and isinstance(stored.get("profiles"), list):
            self.data = self._normalize_stored_data(stored)
        else:
            self.data = await self._async_migrate_legacy_data()
            migrated = True

        await self.async_close_elapsed_periods()
        await self.store.async_save(self.data)
        self._register_entity_listener()
        self._schedule_periodic_tick()
        await self._async_sync_all_mirrors()

        if migrated:
            await self._async_retire_legacy_file()

        _LOGGER.info(
            "Bodík backend načten: %s profilů, revize %s",
            len(self.data["profiles"]),
            self.data["revision"],
        )

    def _normalize_stored_data(self, stored: dict[str, Any]) -> dict[str, Any]:
        """Normalize persisted data without trusting its shape blindly."""
        profiles: list[dict[str, Any]] = []
        seen_ids: set[str] = set()
        apply_schema_migration = _integer(stored.get("data_version"), 1) < DATA_VERSION
        for raw in stored.get("profiles", [])[:MAX_PROFILES]:
            if not isinstance(raw, dict):
                continue
            profile = self._sanitize_profile(
                raw,
                None,
                seen_ids,
                apply_family_seed=apply_schema_migration,
                migrate_categories=apply_schema_migration,
            )
            profiles.append(profile)
            seen_ids.add(profile["id"])

        return {
            "data_version": DATA_VERSION,
            "revision": max(1, _integer(stored.get("revision"), 1)),
            "profiles": profiles,
            "admin_user_ids": [
                _text(item, 64)
                for item in stored.get("admin_user_ids", [])
                if _text(item, 64)
            ],
            "updated_at": _text(stored.get("updated_at"), 64, _now_iso()),
        }

    async def _async_migrate_legacy_data(self) -> dict[str, Any]:
        """Migrate settings.json and reconcile it with current HA helper states."""
        legacy_path = self.hass.config.path(LEGACY_RELATIVE_PATH)

        def load_legacy() -> dict[str, Any]:
            if not os.path.exists(legacy_path):
                return {}
            with open(legacy_path, encoding="utf-8") as file_handle:
                loaded = json.load(file_handle)
            return loaded if isinstance(loaded, dict) else {}

        try:
            legacy = await self.hass.async_add_executor_job(load_legacy)
        except (OSError, json.JSONDecodeError) as err:
            _LOGGER.error("Bodík: starý settings.json nelze načíst: %s", err)
            legacy = {}

        users = await self.hass.auth.async_get_users()
        users_by_name: dict[str, list[str]] = {}
        for user in users:
            users_by_name.setdefault((user.name or "").casefold(), []).append(user.id)

        legacy_admin_names = legacy.get("admins", [])
        admin_user_ids: list[str] = []
        if isinstance(legacy_admin_names, list):
            for name in legacy_admin_names:
                for user_id in users_by_name.get(str(name).casefold(), []):
                    if user_id not in admin_user_ids:
                        admin_user_ids.append(user_id)

        profiles: list[dict[str, Any]] = []
        seen_ids: set[str] = set()
        raw_profiles = legacy.get("profiles", [])
        if not isinstance(raw_profiles, list):
            raw_profiles = []

        for raw in raw_profiles[:MAX_PROFILES]:
            if not isinstance(raw, dict):
                continue
            profile = self._sanitize_profile(
                raw,
                None,
                seen_ids,
                apply_family_seed=True,
                migrate_categories=True,
            )
            seen_ids.add(profile["id"])

            history_score = profile["score"]
            entity_id = profile["scoreEntity"]
            entity_state = self.hass.states.get(entity_id) if entity_id else None
            if entity_state and entity_state.state not in {"unknown", "unavailable"}:
                live_score = _integer(entity_state.state, history_score)
                if live_score != history_score:
                    profile["history"].append(
                        self._history_entry(
                            "Migrace: převzetí aktuální hodnoty z Home Assistantu",
                            live_score - history_score,
                            history_score,
                            live_score,
                            "Home Assistant",
                            "migration_sync",
                            False,
                        )
                    )
                    profile["history"] = profile["history"][-MAX_HISTORY:]
                    profile["score"] = live_score

            profiles.append(profile)

        return {
            "data_version": DATA_VERSION,
            "revision": 1,
            "profiles": profiles,
            "admin_user_ids": admin_user_ids,
            "updated_at": _now_iso(),
        }

    async def _async_retire_legacy_file(self) -> None:
        """Remove private data from the legacy publicly served JSON after migration."""
        legacy_path = self.hass.config.path(LEGACY_RELATIVE_PATH)

        def retire() -> None:
            if not os.path.exists(legacy_path):
                return
            temp_path = f"{legacy_path}.tmp"
            with open(temp_path, "w", encoding="utf-8") as file_handle:
                json.dump(
                    {
                        "migrated": True,
                        "message": "Bodík data byla přesunuta do zabezpečeného úložiště Home Assistantu.",
                    },
                    file_handle,
                    ensure_ascii=False,
                    indent=2,
                )
            os.replace(temp_path, legacy_path)

        try:
            await self.hass.async_add_executor_job(retire)
        except OSError as err:
            _LOGGER.error("Bodík: veřejný legacy JSON nelze po migraci odstranit: %s", err)

    def _sanitize_profile(
        self,
        raw: dict[str, Any],
        existing: dict[str, Any] | None,
        seen_ids: set[str],
        apply_family_seed: bool = False,
        migrate_categories: bool = False,
    ) -> dict[str, Any]:
        """Validate profile configuration and preserve server-owned ledger fields."""
        raw_id = _text(raw.get("id"), 64)
        profile_id = raw_id if _ID_RE.fullmatch(raw_id) and raw_id not in seen_ids else uuid4().hex
        name = _text(raw.get("name"), 80, "Nový profil") or "Nový profil"
        entity_id = _text(raw.get("scoreEntity"), 128)
        if entity_id and (not valid_entity_id(entity_id) or not entity_id.startswith("input_number.")):
            raise BodikValidationError(f"Neplatná entita bodů: {entity_id}")

        theme = _text(raw.get("theme"), 16, "auto")
        if theme not in {"auto", "dark", "light"}:
            theme = "auto"

        family_version = max(0, _integer(raw.get("family_config_version"), 0))
        family_profile = is_family_profile(name)
        should_seed_family = (
            apply_family_seed
            and family_profile
            and family_version < FAMILY_INITIAL_CONFIG_VERSION
        )
        should_update_family_targets = family_profile and family_version == FAMILY_INITIAL_CONFIG_VERSION
        reasons: list[dict[str, Any]] = []
        seen_reason_ids: set[str] = set()
        raw_reasons = [] if should_seed_family else raw.get("reasons", [])
        if isinstance(raw_reasons, list):
            for item in raw_reasons[:MAX_REASONS]:
                if not isinstance(item, dict):
                    continue
                reason_name = _text(item.get("name"), 120)
                if reason_name:
                    reason_id = _text(item.get("id"), 64)
                    if not _ID_RE.fullmatch(reason_id) or reason_id in seen_reason_ids:
                        reason_id = uuid4().hex
                    seen_reason_ids.add(reason_id)
                    limit = _optional_positive_integer(
                        item.get("max_occurrences_per_day"),
                        f"Denní limit důvodu „{reason_name}“",
                    )
                    reasons.append(
                        {
                            "id": reason_id,
                            "name": reason_name,
                            "value": _integer(item.get("value")),
                            "max_occurrences_per_day": limit,
                            "category": _text(item.get("category"), 40),
                        }
                    )

        if should_seed_family:
            # Issue #3 is the replacement active model for these two existing
            # family profiles. Legacy reasons remain represented in history,
            # but must not stay actionable alongside the family model.
            reasons = family_reasons()

        offline_daily_cap = 8 if should_seed_family else self._sanitize_offline_cap(
            raw.get("offline_daily_cap")
        )
        reason_categories = self._sanitize_reason_categories(
            raw.get("reason_categories"), reasons, migrate_categories or should_seed_family
        )
        if offline_daily_cap is not None and not any(
            category["id"] == "offline" for category in reason_categories
        ):
            existing_offline = next(
                (
                    deepcopy(category)
                    for category in (existing or {}).get("reason_categories", [])
                    if category.get("id") == "offline"
                ),
                None,
            )
            reason_categories.append(
                existing_offline
                or next(
                    category
                    for category in family_reason_categories()
                    if category["id"] == "offline"
                )
            )
            reason_categories.sort(key=lambda item: (item["order"], item["name"].casefold()))
        category_ids = {item["id"] for item in reason_categories}
        for reason in reasons:
            if reason["category"] not in category_ids:
                reason["category"] = ""

        legacy_rewards: list[dict[str, Any]] = []
        reward_sources: list[Any] = []
        if existing is not None:
            reward_sources.append(existing.get("legacy_rewards", []))
        else:
            reward_sources.extend((raw.get("legacy_rewards", []), raw.get("rewards", [])))
        seen_reward_ids: set[str] = set()
        for raw_rewards in reward_sources:
            if not isinstance(raw_rewards, list):
                continue
            for item in raw_rewards:
                if len(legacy_rewards) >= MAX_REWARDS:
                    break
                if not isinstance(item, dict):
                    continue
                category = _text(item.get("category"), 120)
                if not category:
                    continue
                raw_value = item.get("value")
                value = None if raw_value in {None, ""} else _integer(raw_value)
                reward_id = _text(item.get("id"), 64)
                if not _ID_RE.fullmatch(reward_id) or reward_id in seen_reward_ids:
                    reward_id = uuid4().hex
                seen_reward_ids.add(reward_id)
                legacy_rewards.append(
                    {
                        "id": reward_id,
                        "category": category,
                        "value": value,
                        "unit": _text(item.get("unit"), 60) or None,
                        "period": _text(item.get("period"), 60) or None,
                        "threshold": _integer(item.get("threshold")),
                    }
                )

        periodic_config_raw = family_periodic_config() if should_seed_family else raw.get("periodic_config")
        if should_update_family_targets:
            # v1 marks the existing family seed. Change only its three targets;
            # the independent ledger and all other profile settings stay intact.
            periodic_config_raw = {**(periodic_config_raw or {}), **FAMILY_TARGETS}
        try:
            periodic_config = validate_config(periodic_config_raw)
        except PeriodicValidationError as err:
            raise BodikValidationError(str(err)) from err

        if existing is not None:
            score = _integer(existing.get("score"))
            history = deepcopy(existing.get("history", []))[-MAX_HISTORY:]
            periodic = self._sanitize_periodic_state(
                existing.get("periodic"), periodic_config
            )
        else:
            history = self._sanitize_history(raw.get("history", []))
            score = _integer(raw.get("score"), history[-1]["next"] if history else 0)
            periodic = self._sanitize_periodic_state(
                raw.get("periodic"), periodic_config
            )

        return {
            "id": profile_id,
            "name": name,
            "scoreEntity": entity_id,
            "childPhotoUrl": _text(raw.get("childPhotoUrl"), 1000),
            "theme": theme,
            "rules": _text(raw.get("rules"), 5000),
            "reasons": reasons,
            "reason_categories": reason_categories,
            "legacy_rewards": legacy_rewards,
            "history": history,
            "score": score,
            "periodic_config": periodic_config,
            "periodic": periodic,
            "offline_daily_cap": offline_daily_cap,
            "family_config_version": (
                FAMILY_CONFIG_VERSION
                if should_seed_family or should_update_family_targets
                else family_version
            ),
        }

    def _sanitize_reason_categories(
        self,
        raw_categories: Any,
        reasons: list[dict[str, Any]],
        migrate: bool,
    ) -> list[dict[str, Any]]:
        """Normalize per-profile categories while keeping semantic IDs stable."""
        defaults = {item["id"]: item for item in family_reason_categories()}
        categories: list[dict[str, Any]] = []
        seen: set[str] = set()

        if isinstance(raw_categories, list):
            for item in raw_categories[:MAX_REASON_CATEGORIES]:
                if not isinstance(item, dict):
                    continue
                category_id = _text(item.get("id"), 40)
                name = _text(item.get("name"), 80)
                if not _ID_RE.fullmatch(category_id) or category_id in seen or not name:
                    continue
                seen.add(category_id)
                categories.append(
                    {
                        "id": category_id,
                        "name": name,
                        "order": _integer(item.get("order"), (len(categories) + 1) * 10),
                    }
                )

        if migrate:
            for category in family_reason_categories():
                if category["id"] not in seen:
                    categories.append(category)
                    seen.add(category["id"])

        referenced = {
            _text(reason.get("category"), 40)
            for reason in reasons
            if _text(reason.get("category"), 40)
        }
        for category_id in sorted(referenced):
            if category_id in seen or not _ID_RE.fullmatch(category_id):
                continue
            default = defaults.get(category_id)
            categories.append(
                deepcopy(default)
                if default
                else {
                    "id": category_id,
                    "name": category_id.replace("_", " ").strip().capitalize(),
                    "order": (len(categories) + 1) * 10,
                }
            )
            seen.add(category_id)

        # ``offline`` is a protected semantic category whenever it is in use.
        # Its display name/order remain editable, but removing the definition
        # cannot silently disable the server-side positive-points cap.
        if "offline" in referenced and "offline" not in seen:
            categories.append(deepcopy(defaults["offline"]))

        return sorted(categories, key=lambda item: (item["order"], item["name"].casefold()))

    def _sanitize_offline_cap(self, value: Any) -> int | None:
        """Validate the optional positive Offline-category daily point cap."""
        return _optional_positive_integer(value, "Denní Offline limit")

    def _time_zone(self):
        """Return Home Assistant's configured local timezone."""
        from zoneinfo import ZoneInfo

        return ZoneInfo(self.hass.config.time_zone)

    def _sanitize_periodic_state(
        self, raw: Any, config: dict[str, Any]
    ) -> dict[str, Any]:
        """Normalize v9 state or explicitly activate tracking for v8 data."""
        zone = self._time_zone()
        now = datetime.now(timezone.utc)
        if not isinstance(raw, dict) or not raw.get("tracking_started_at"):
            return new_state(now, config, zone)
        try:
            tracking = parse_utc(str(raw["tracking_started_at"]))
            result = new_state(tracking, config, zone)
            result["tracking_started_at"] = iso_utc(tracking)
            for key in (
                "daily_period_started_at",
                "weekly_period_started_at",
                "monthly_period_started_at",
            ):
                result[key] = iso_utc(parse_utc(str(raw.get(key, result[key]))))
            for key in (
                "daily_initial_partial",
                "weekly_initial_partial",
                "monthly_initial_partial",
            ):
                result[key] = bool(raw.get(key, result[key]))
            transactions = raw.get("transactions", [])
            result["transactions"] = []
            if isinstance(transactions, list):
                for item in transactions:
                    if not isinstance(item, dict):
                        continue
                    try:
                        when = iso_utc(parse_utc(str(item.get("time"))))
                    except (TypeError, ValueError):
                        continue
                    result["transactions"].append(
                        {
                            "id": _text(item.get("id"), 64, uuid4().hex),
                            "time": when,
                            "delta": _integer(item.get("delta")),
                            "kind": _text(item.get("kind"), 40, "adjust_score"),
                            "counts_toward_periods": bool(item.get("counts_toward_periods", False)),
                            "reason_id": _text(item.get("reason_id"), 64) or None,
                            "category": _text(item.get("category"), 40) or None,
                        }
                    )
            for key in ("daily_results", "weekly_results", "monthly_results"):
                values = raw.get(key, [])
                result[key] = deepcopy(values[-MAX_PERIOD_RESULTS:]) if isinstance(values, list) else []
            result["today_digital_entitlement"] = max(
                0, _integer(raw.get("today_digital_entitlement"), 0)
            )
            reward = raw.get("active_weekly_reward")
            result["active_weekly_reward"] = deepcopy(reward) if isinstance(reward, dict) else None
            return result
        except (TypeError, ValueError, KeyError) as err:
            raise BodikValidationError("Uložený stav periodických cílů je neplatný.") from err

    def _sanitize_history(self, raw_history: Any) -> list[dict[str, Any]]:
        """Validate legacy history records."""
        if not isinstance(raw_history, list):
            return []
        result: list[dict[str, Any]] = []
        for item in raw_history[-MAX_HISTORY:]:
            if not isinstance(item, dict):
                continue
            previous = _integer(item.get("prev"))
            following = _integer(item.get("next"), previous)
            result.append(
                {
                    "time": _text(item.get("time"), 64, _now_iso()),
                    "desc": _text(item.get("desc"), 250, "Změna bodů"),
                    "delta": following - previous,
                    "prev": previous,
                    "next": following,
                    "user": _text(item.get("user"), 120, "Neznámý"),
                    "kind": _text(item.get("kind"), 40, "legacy"),
                    "counts_toward_periods": bool(item.get("counts_toward_periods", False)),
                    "reason_id": _text(item.get("reason_id"), 64) or None,
                    "category": _text(item.get("category"), 40) or None,
                }
            )
        return result

    def _history_entry(
        self, reason: str, delta: int, previous: int, following: int, user: str,
        kind: str = "adjust_score", counts_toward_periods: bool = True,
        reason_id: str | None = None, category: str | None = None,
        occurred_at: datetime | None = None,
    ) -> dict[str, Any]:
        return {
            "time": iso_utc(occurred_at or datetime.now(timezone.utc)),
            "desc": _text(reason, 250, "Změna bodů"),
            "delta": delta,
            "prev": previous,
            "next": following,
            "user": _text(user, 120, "Home Assistant"),
            "kind": _text(kind, 40, "adjust_score"),
            "counts_toward_periods": counts_toward_periods,
            "reason_id": reason_id,
            "category": category,
        }

    def _profile(self, identifier: str) -> dict[str, Any]:
        """Resolve a profile by ID, name or mirror entity ID."""
        lookup = identifier.strip().casefold()
        if not lookup:
            raise BodikValidationError("Profil nebyl zadán.")
        for profile in self.data["profiles"]:
            identifiers = {profile["id"].casefold(), profile["name"].casefold()}
            if profile["scoreEntity"]:
                identifiers.add(profile["scoreEntity"].casefold())
            if lookup in identifiers:
                return profile
        raise BodikValidationError(f"Profil nebyl nalezen: {identifier}")

    def _configured_reason(
        self, profile: dict[str, Any], reason_id: str
    ) -> dict[str, Any]:
        """Resolve one configured reason by its stable server-owned ID."""
        for reason in profile.get("reasons", []):
            if reason["id"] == reason_id:
                return reason
        raise BodikValidationError("Vybraný důvod již neexistuje. Obnovte stránku.")

    def _daily_reason_usage(
        self, profile: dict[str, Any], now: datetime
    ) -> tuple[dict[str, int], int]:
        """Count accepted reason uses and positive Offline points today."""
        local_day = now.astimezone(self._time_zone()).date()
        counts: dict[str, int] = {}
        offline_points = 0
        for item in profile["periodic"].get("transactions", []):
            if item.get("kind") != "reason":
                continue
            reason_id = item.get("reason_id")
            if not reason_id:
                continue
            try:
                item_day = parse_utc(str(item["time"])).astimezone(
                    self._time_zone()
                ).date()
            except (KeyError, TypeError, ValueError):
                continue
            if item_day != local_day:
                continue
            counts[reason_id] = counts.get(reason_id, 0) + 1
            if item.get("category") == "offline":
                offline_points += max(0, _integer(item.get("delta")))
        return counts, offline_points

    def reason_status(
        self, profile: dict[str, Any], now: datetime | None = None
    ) -> dict[str, Any]:
        """Return backend-derived per-reason availability for the current local day."""
        now = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
        counts, offline_points = self._daily_reason_usage(profile, now)
        offline_cap = profile.get("offline_daily_cap")
        result: dict[str, Any] = {}
        for reason in profile.get("reasons", []):
            used = counts.get(reason["id"], 0)
            limit = reason.get("max_occurrences_per_day")
            available = limit is None or used < limit
            message = None
            if not available:
                message = f"Denní limit {limit}× byl dosažen."
            if (
                available
                and reason.get("category") == "offline"
                and offline_cap is not None
                and reason["value"] > 0
                and offline_points + reason["value"] > offline_cap
            ):
                available = False
                message = f"Denní Offline limit {offline_cap} bodů by byl překročen."
            result[reason["id"]] = {
                "used_today": used,
                "limit": limit,
                "available": available,
                "message": message,
            }
        return {
            "reasons": result,
            "offline_points_today": offline_points,
            "offline_daily_cap": offline_cap,
        }

    def generated_rules_summary(self, profile: dict[str, Any]) -> str:
        """Build a concise human summary solely from active profile config."""
        config = profile["periodic_config"]
        weekdays = (
            "pondělí",
            "úterý",
            "středu",
            "čtvrtek",
            "pátek",
            "sobotu",
            "neděli",
        )
        paragraphs = [
            f"Denní cíl je {config['daily_target']} bodů.",
            (
                "Po splnění cíle získáš na další den "
                f"{config['base_digital_minutes']} minut digitálního času."
            ),
        ]
        if config["bonus_step_minutes"] > 0:
            paragraphs.append(
                f"Za každých dalších {config['bonus_step_points']} bodů dostaneš "
                f"+{config['bonus_step_minutes']} minut, maximálně "
                f"{config['max_digital_minutes']} minut."
            )
        paragraphs.append(
            f"Týdenní cíl je {config['weekly_target']} bodů. Týden se vyhodnocuje "
            f"v {weekdays[config['weekly_tick_weekday']]} v "
            f"{config['weekly_tick_time']}."
        )
        maximum_allowance = round(
            config["allowance_at_100"] * config["max_payout_percent"] / 100
        )
        paragraphs.append(
            f"Měsíční cíl je {config['monthly_target']} bodů. Při 100 % je kapesné "
            f"{config['allowance_at_100']} Kč a může růst až na "
            f"{maximum_allowance} Kč."
        )
        first_payout = first_paying_threshold(config)
        if first_payout is not None:
            paragraphs.append(
                f"Kapesné začíná od {first_payout['minimum_percent']} % měsíčního cíle "
                f"({first_payout['points']} bodů)."
            )
        if profile.get("offline_daily_cap") is not None:
            paragraphs.append(
                "Za Offline aktivity lze získat maximálně "
                f"{profile['offline_daily_cap']} kladných bodů za den."
            )
        return "\n\n".join(paragraphs)

    async def async_can_manage(self, user_id: str | None) -> bool:
        """Return whether a HA user may mutate Bodik."""
        if not user_id:
            return False
        user = await self.hass.auth.async_get_user(user_id)
        return bool(
            user
            and user.is_active
            and (user.is_admin or user.id in self.data.get("admin_user_ids", []))
        )

    async def async_payload(self, user_id: str | None) -> dict[str, Any]:
        """Return authenticated client data."""
        await self.async_close_elapsed_periods()
        can_manage = await self.async_can_manage(user_id)
        client_data = deepcopy(self.data)
        now = datetime.now(timezone.utc)
        zone = self._time_zone()
        for profile in client_data.get("profiles", []):
            profile["periodic_status"] = current_status(
                profile["periodic"], profile["periodic_config"], now, zone
            )
            profile["reason_status"] = self.reason_status(profile, now)
            profile["generated_rules"] = self.generated_rules_summary(profile)
        if not can_manage:
            client_data["admin_user_ids"] = []
        payload: dict[str, Any] = {
            "data": client_data,
            "revision": self.data["revision"],
            "can_manage": can_manage,
            "current_user_id": user_id,
        }
        if can_manage:
            users = await self.hass.auth.async_get_users()
            payload["available_users"] = [
                {
                    "id": user.id,
                    "name": user.name or user.id,
                    "is_admin": user.is_admin,
                    "is_active": user.is_active,
                }
                for user in users
                if user.is_active
            ]
        return payload

    def _sanitize_profile_collection(
        self,
        raw_profiles: Any,
        existing_by_id: dict[str, dict[str, Any]] | None = None,
        apply_family_seed: bool = False,
        migrate_categories: bool = False,
    ) -> list[dict[str, Any]]:
        """Validate a complete profile collection and its unique fields."""
        if not isinstance(raw_profiles, list) or not raw_profiles:
            raise BodikValidationError("Bodík musí obsahovat alespoň jeden profil.")
        if len(raw_profiles) > MAX_PROFILES:
            raise BodikValidationError("Byl překročen maximální počet profilů.")

        existing_by_id = existing_by_id or {}
        seen_ids: set[str] = set()
        seen_names: set[str] = set()
        seen_entities: set[str] = set()
        profiles: list[dict[str, Any]] = []

        for raw_profile in raw_profiles:
            if not isinstance(raw_profile, dict):
                raise BodikValidationError("Neplatná konfigurace profilu.")
            existing = existing_by_id.get(_text(raw_profile.get("id"), 64))
            profile = self._sanitize_profile(
                raw_profile,
                existing,
                seen_ids,
                apply_family_seed=apply_family_seed,
                migrate_categories=migrate_categories,
            )
            normalized_name = profile["name"].casefold()
            if normalized_name in seen_names:
                raise BodikValidationError(
                    f"Název profilu je použit vícekrát: {profile['name']}"
                )
            if profile["scoreEntity"] in seen_entities:
                raise BodikValidationError(
                    f"Entita bodů je přiřazena více profilům: {profile['scoreEntity']}"
                )
            seen_ids.add(profile["id"])
            seen_names.add(normalized_name)
            if profile["scoreEntity"]:
                seen_entities.add(profile["scoreEntity"])
            profiles.append(profile)

        return profiles

    async def _valid_manager_user_ids(self, raw_users: Any) -> list[str]:
        """Return unique active HA user IDs from untrusted input."""
        valid_users = {
            user.id for user in await self.hass.auth.async_get_users() if user.is_active
        }
        result: list[str] = []
        if isinstance(raw_users, list):
            for item in raw_users:
                user_id = _text(item, 64)
                if user_id in valid_users and user_id not in result:
                    result.append(user_id)
        return result

    async def async_save_config(
        self, raw: dict[str, Any], expected_revision: int, user_id: str
    ) -> dict[str, Any]:
        """Save validated profile config with optimistic concurrency control."""
        if not await self.async_can_manage(user_id):
            raise PermissionError("Uživatel nemá oprávnění spravovat Bodík.")
        await self.async_close_elapsed_periods()

        async with self._lock:
            if expected_revision != self.data["revision"]:
                raise BodikConflictError(
                    "Data byla mezitím změněna v jiném panelu. Obnovte stránku a akci zopakujte."
                )

            existing_by_id = {profile["id"]: profile for profile in self.data["profiles"]}
            profiles = self._sanitize_profile_collection(
                raw.get("profiles", []), existing_by_id
            )
            now = datetime.now(timezone.utc)
            for profile in profiles:
                existing = existing_by_id.get(profile["id"])
                if not existing:
                    continue
                old_config = existing.get("periodic_config", default_config())
                new_config = profile["periodic_config"]
                if (
                    old_config.get("weekly_tick_weekday") != new_config["weekly_tick_weekday"]
                    or old_config.get("weekly_tick_time") != new_config["weekly_tick_time"]
                ):
                    profile["periodic"]["weekly_period_started_at"] = iso_utc(now)
                    profile["periodic"]["weekly_initial_partial"] = True
            admin_user_ids = await self._valid_manager_user_ids(
                raw.get("admin_user_ids", [])
            )

            self.data = {
                "data_version": DATA_VERSION,
                "revision": self.data["revision"] + 1,
                "profiles": profiles,
                "admin_user_ids": admin_user_ids,
                "updated_at": _now_iso(),
            }
            await self.store.async_save(self.data)

        self._register_entity_listener()
        await self.async_close_elapsed_periods()
        self._schedule_periodic_tick()
        await self._async_sync_all_mirrors()
        self._fire_updated("config")
        return deepcopy(self.data)

    async def async_import_backup(
        self, raw_backup: dict[str, Any], expected_revision: int, user_id: str
    ) -> dict[str, Any]:
        """Replace settings and ledgers from a validated Bodík JSON backup."""
        if not await self.async_can_manage(user_id):
            raise PermissionError("Uživatel nemá oprávnění spravovat Bodík.")

        if raw_backup.get("format") == "bodik-backup":
            if raw_backup.get("format_version") not in {1, 2}:
                raise BodikValidationError("Nepodporovaná verze zálohy Bodíku.")
            raw_data = raw_backup.get("data")
        elif "profiles" in raw_backup:
            raw_data = raw_backup
        else:
            raw_data = None

        if not isinstance(raw_data, dict):
            raise BodikValidationError("Soubor neobsahuje platnou zálohu Bodíku.")

        async with self._lock:
            if expected_revision != self.data["revision"]:
                raise BodikConflictError(
                    "Data byla mezitím změněna v jiném panelu. Obnovte stránku a import zopakujte."
                )

            needs_migration = _integer(raw_data.get("data_version"), 1) < DATA_VERSION
            profiles = self._sanitize_profile_collection(
                raw_data.get("profiles", []),
                apply_family_seed=needs_migration,
                migrate_categories=needs_migration,
            )
            admin_user_ids = await self._valid_manager_user_ids(
                raw_data.get("admin_user_ids", [])
            )
            self.data = {
                "data_version": DATA_VERSION,
                "revision": self.data["revision"] + 1,
                "profiles": profiles,
                "admin_user_ids": admin_user_ids,
                "updated_at": _now_iso(),
            }
            await self.store.async_save(self.data)

        self._register_entity_listener()
        await self.async_close_elapsed_periods()
        self._schedule_periodic_tick()
        await self._async_sync_all_mirrors()
        self._fire_updated("import")
        return deepcopy(self.data)

    async def async_adjust_score(
        self, identifier: str, delta: int, reason: str, user: str
    ) -> dict[str, Any]:
        """Atomically change score and append a ledger entry."""
        async with self._lock:
            profile = self._profile(identifier)
            previous = _integer(profile["score"])
            following = self._clamp_for_entity(profile, previous + _integer(delta))
            result = await self._async_commit_score_locked(
                profile, previous, following, reason, user,
                kind="adjust_score", counts_toward_periods=True,
            )

        if result["changed"]:
            await self._async_sync_mirror(result["profile"])
            self._fire_updated("score", result["profile"]["id"])
        return result["profile"]

    async def async_apply_reason(
        self,
        identifier: str,
        reason_id: str,
        user: str,
        now: datetime | None = None,
    ) -> dict[str, Any]:
        """Apply a configured reason by ID with server-owned value and limits."""
        occurred_at = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
        async with self._lock:
            profile = self._profile(identifier)
            reason = self._configured_reason(profile, reason_id)
            usage = self.reason_status(profile, occurred_at)
            reason_usage = usage["reasons"][reason_id]
            if not reason_usage["available"]:
                raise BodikValidationError(
                    f"Důvod „{reason['name']}“ nelze použít: {reason_usage['message']}"
                )

            previous = _integer(profile["score"])
            following = self._clamp_for_entity(
                profile, previous + _integer(reason["value"])
            )
            result = await self._async_commit_score_locked(
                profile,
                previous,
                following,
                reason["name"],
                user,
                kind="reason",
                counts_toward_periods=True,
                reason_id=reason["id"],
                category=reason.get("category") or None,
                occurred_at=occurred_at,
                record_unchanged=True,
            )

        if result["changed"]:
            await self._async_sync_mirror(result["profile"])
        if result["recorded"]:
            self._fire_updated("reason", result["profile"]["id"])
        return result["profile"]

    async def async_set_score(
        self, identifier: str, value: int, reason: str, user: str
    ) -> dict[str, Any]:
        """Atomically set score, persist history, then update the HA mirror."""
        async with self._lock:
            profile = self._profile(identifier)
            previous = _integer(profile["score"])
            following = self._clamp_for_entity(profile, _integer(value))
            result = await self._async_commit_score_locked(
                profile, previous, following, reason, user,
                kind="set_score", counts_toward_periods=False,
            )

        if result["changed"]:
            await self._async_sync_mirror(result["profile"])
            self._fire_updated("score", result["profile"]["id"])
        return result["profile"]

    async def _async_commit_score_locked(
        self,
        profile: dict[str, Any],
        previous: int,
        following: int,
        reason: str,
        user: str,
        kind: str,
        counts_toward_periods: bool,
        reason_id: str | None = None,
        category: str | None = None,
        occurred_at: datetime | None = None,
        record_unchanged: bool = False,
    ) -> dict[str, Any]:
        """Persist one score mutation while the caller holds ``self._lock``."""
        changed = following != previous
        if not changed and not record_unchanged:
            return {"changed": False, "recorded": False, "profile": deepcopy(profile)}

        profile["score"] = following
        entry = self._history_entry(
            reason, following - previous, previous, following, user,
            kind, counts_toward_periods, reason_id, category, occurred_at,
        )
        profile["history"].append(entry)
        profile["history"] = profile["history"][-MAX_HISTORY:]
        profile["periodic"]["transactions"].append(
            {
                "id": uuid4().hex,
                "time": entry["time"],
                "delta": entry["delta"],
                "kind": kind,
                "counts_toward_periods": counts_toward_periods,
                "reason_id": reason_id,
                "category": category,
            }
        )
        self.data["revision"] += 1
        self.data["updated_at"] = _now_iso()
        await self.store.async_save(self.data)
        return {"changed": changed, "recorded": True, "profile": deepcopy(profile)}

    async def async_clear_history(self, profile_id: str, user_id: str) -> dict[str, Any]:
        """Clear history without changing the current score."""
        if not await self.async_can_manage(user_id):
            raise PermissionError("Uživatel nemá oprávnění spravovat Bodík.")
        async with self._lock:
            profile = self._profile(profile_id)
            profile["history"] = []
            self.data["revision"] += 1
            self.data["updated_at"] = _now_iso()
            await self.store.async_save(self.data)
            result = deepcopy(profile)
        self._fire_updated("history", profile["id"])
        return result

    def _clamp_for_entity(self, profile: dict[str, Any], value: int) -> int:
        entity_id = profile.get("scoreEntity")
        state = self.hass.states.get(entity_id) if entity_id else None
        if not state:
            return value
        minimum = _integer(state.attributes.get("min"), -MAX_ABS_SCORE)
        maximum = _integer(state.attributes.get("max"), MAX_ABS_SCORE)
        return max(minimum, min(maximum, value))

    def _remember_internal_context(self, context_id: str) -> None:
        if len(self._internal_context_order) == self._internal_context_order.maxlen:
            expired = self._internal_context_order.popleft()
            self._internal_context_ids.discard(expired)
        self._internal_context_order.append(context_id)
        self._internal_context_ids.add(context_id)

    async def _async_sync_mirror(self, profile: dict[str, Any]) -> None:
        entity_id = profile.get("scoreEntity")
        if not entity_id or not self.hass.states.get(entity_id):
            return
        current_state = self.hass.states.get(entity_id)
        if current_state is None:
            return
        current = _integer(current_state.state, profile["score"])
        if current == profile["score"]:
            return

        context = Context()
        self._remember_internal_context(context.id)
        try:
            await self.hass.services.async_call(
                "input_number",
                "set_value",
                {"entity_id": entity_id, "value": profile["score"]},
                blocking=True,
                context=context,
            )
        except Exception:  # noqa: BLE001 - HA service errors vary by integration
            _LOGGER.exception("Bodík: nelze synchronizovat zrcadlo %s", entity_id)

    async def _async_sync_all_mirrors(self) -> None:
        for profile in self.data.get("profiles", []):
            await self._async_sync_mirror(profile)

    def _register_entity_listener(self) -> None:
        if self._unsubscribe_entities:
            self._unsubscribe_entities()
            self._unsubscribe_entities = None
        entity_ids = [
            profile["scoreEntity"]
            for profile in self.data.get("profiles", [])
            if profile.get("scoreEntity")
        ]
        if entity_ids:
            self._unsubscribe_entities = async_track_state_change_event(
                self.hass, entity_ids, self._state_changed
            )

    @callback
    def _state_changed(self, event: Event) -> None:
        new_state: State | None = event.data.get("new_state")
        old_state: State | None = event.data.get("old_state")
        if not new_state or new_state.state in {"unknown", "unavailable"}:
            return
        if new_state.context.id in self._internal_context_ids:
            return
        if old_state and old_state.state == new_state.state:
            return
        self.hass.async_create_task(
            self._async_capture_external_change(new_state),
            "Bodík: zachycení externí změny skóre",
        )

    async def _async_capture_external_change(self, state: State) -> None:
        try:
            profile = self._profile(state.entity_id)
            value = _integer(state.state, profile["score"])
            if value == profile["score"]:
                return
            await self.async_set_score(
                profile["id"], value, "Externí změna entity v Home Assistantu", "Home Assistant"
            )
        except BodikValidationError:
            return
        except Exception:  # noqa: BLE001
            _LOGGER.exception("Bodík: externí změnu %s nelze uložit", state.entity_id)

    async def async_close_elapsed_periods(self, now: datetime | None = None) -> bool:
        """Catch up every elapsed boundary once, including after HA downtime."""
        now = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
        changed_profiles: list[str] = []
        async with self._lock:
            for profile in self.data.get("profiles", []):
                if close_periods(
                    profile["periodic"], profile["periodic_config"], now, self._time_zone()
                ):
                    for key in ("daily_results", "weekly_results", "monthly_results"):
                        profile["periodic"][key] = profile["periodic"][key][
                            -MAX_PERIOD_RESULTS:
                        ]
                    changed_profiles.append(profile["id"])
            if changed_profiles:
                self.data["revision"] += 1
                self.data["updated_at"] = _now_iso()
                await self.store.async_save(self.data)
        if changed_profiles:
            self._fire_updated("periodic_close")
        return bool(changed_profiles)

    def _schedule_periodic_tick(self) -> None:
        """Register one HA-local, DST-safe timer for the nearest boundary."""
        if self._unsubscribe_periodic:
            self._unsubscribe_periodic()
            self._unsubscribe_periodic = None
        candidates = [
            next_boundary(profile["periodic"], profile["periodic_config"], self._time_zone())
            for profile in self.data.get("profiles", [])
        ]
        if not candidates:
            return

        async def handle_tick(_now: datetime) -> None:
            try:
                await self.async_close_elapsed_periods(_now)
            finally:
                self._schedule_periodic_tick()

        self._unsubscribe_periodic = async_track_point_in_time(
            self.hass, handle_tick, min(candidates)
        )

    def _fire_updated(self, change: str, profile_id: str | None = None) -> None:
        self.hass.bus.async_fire(
            EVENT_UPDATED,
            {
                "revision": self.data["revision"],
                "change": change,
                "profile_id": profile_id,
            },
        )

    async def async_user_name(self, user_id: str | None) -> str:
        if not user_id:
            return "Home Assistant"
        user = await self.hass.auth.async_get_user(user_id)
        return user.name if user and user.name else "Home Assistant"

    def scores_response(self) -> dict[str, Any]:
        now = datetime.now(timezone.utc)
        zone = self._time_zone()
        profiles = [
            {
                "id": item["id"],
                "name": item["name"],
                "score": item["score"],
                "periodic": current_status(
                    item["periodic"], item["periodic_config"], now, zone
                ),
            }
            for item in self.data["profiles"]
        ]
        summary = "Aktuální stav: " + ". ".join(
            f"{item['name']}: {item['score']} bodů" for item in profiles
        )
        return {"scores_info": summary, "profiles": profiles}

    def info_response(self) -> dict[str, Any]:
        sections: list[str] = []
        now = datetime.now(timezone.utc)
        zone = self._time_zone()
        for profile in self.data["profiles"]:
            periodic = current_status(
                profile["periodic"], profile["periodic_config"], now, zone
            )
            reasons = "\n".join(
                f"- {item['name']}: {item['value']:+d}" for item in profile["reasons"]
            ) or "- Nejsou nastaveny"
            sections.append(
                f"PROFIL: {profile['name']}\n"
                f"BODY: {profile['score']}\n"
                f"DNES: {periodic['daily']['points']} / {periodic['daily']['target']}\n"
                f"TENTO TÝDEN: {periodic['weekly']['points']} / {periodic['weekly']['target']}\n"
                f"TENTO MĚSÍC: {periodic['monthly']['points']} / {periodic['monthly']['target']}\n"
                f"DNEŠNÍ DIGITÁLNÍ ČAS: {periodic['daily']['today_entitlement']} minut\n"
                f"AKTUÁLNÍ PRAVIDLA:\n{self.generated_rules_summary(profile)}\n"
                f"DALŠÍ RODINNÁ PRAVIDLA: {profile['rules'] or 'Nejsou definována'}\n"
                f"DŮVODY:\n{reasons}"
            )
        return {"bodik_info": "\n\n====================\n\n".join(sections)}
