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
from homeassistant.helpers.event import async_track_state_change_event
from homeassistant.helpers.storage import Store

from .const import (
    DOMAIN,
    EVENT_UPDATED,
    LEGACY_RELATIVE_PATH,
    MAX_ABS_SCORE,
    MAX_HISTORY,
    MAX_PROFILES,
    MAX_REASONS,
    MAX_REWARDS,
    STORAGE_KEY,
    STORAGE_VERSION,
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

        await self.store.async_save(self.data)
        self._register_entity_listener()
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
        for raw in stored.get("profiles", [])[:MAX_PROFILES]:
            if not isinstance(raw, dict):
                continue
            profile = self._sanitize_profile(raw, None, seen_ids)
            profiles.append(profile)
            seen_ids.add(profile["id"])

        return {
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
            profile = self._sanitize_profile(raw, None, seen_ids)
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
                        )
                    )
                    profile["history"] = profile["history"][-MAX_HISTORY:]
                    profile["score"] = live_score

            profiles.append(profile)

        return {
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

        reasons: list[dict[str, Any]] = []
        raw_reasons = raw.get("reasons", [])
        if isinstance(raw_reasons, list):
            for item in raw_reasons[:MAX_REASONS]:
                if not isinstance(item, dict):
                    continue
                reason_name = _text(item.get("name"), 120)
                if reason_name:
                    reasons.append({"name": reason_name, "value": _integer(item.get("value"))})

        rewards: list[dict[str, Any]] = []
        raw_rewards = raw.get("rewards", [])
        if isinstance(raw_rewards, list):
            for item in raw_rewards[:MAX_REWARDS]:
                if not isinstance(item, dict):
                    continue
                category = _text(item.get("category"), 120)
                if not category:
                    continue
                raw_value = item.get("value")
                value = None if raw_value in {None, ""} else _integer(raw_value)
                reward_id = _text(item.get("id"), 64)
                if not _ID_RE.fullmatch(reward_id):
                    reward_id = uuid4().hex
                rewards.append(
                    {
                        "id": reward_id,
                        "category": category,
                        "value": value,
                        "unit": _text(item.get("unit"), 60) or None,
                        "period": _text(item.get("period"), 60) or None,
                        "threshold": _integer(item.get("threshold")),
                    }
                )

        if existing is not None:
            score = _integer(existing.get("score"))
            history = deepcopy(existing.get("history", []))[-MAX_HISTORY:]
        else:
            history = self._sanitize_history(raw.get("history", []))
            score = _integer(raw.get("score"), history[-1]["next"] if history else 0)

        return {
            "id": profile_id,
            "name": name,
            "scoreEntity": entity_id,
            "childPhotoUrl": _text(raw.get("childPhotoUrl"), 1000),
            "theme": theme,
            "rules": _text(raw.get("rules"), 5000),
            "reasons": reasons,
            "rewards": rewards,
            "history": history,
            "score": score,
        }

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
                }
            )
        return result

    def _history_entry(
        self, reason: str, delta: int, previous: int, following: int, user: str
    ) -> dict[str, Any]:
        return {
            "time": _now_iso(),
            "desc": _text(reason, 250, "Změna bodů"),
            "delta": delta,
            "prev": previous,
            "next": following,
            "user": _text(user, 120, "Home Assistant"),
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
        can_manage = await self.async_can_manage(user_id)
        client_data = deepcopy(self.data)
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
            profile = self._sanitize_profile(raw_profile, existing, seen_ids)
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

        async with self._lock:
            if expected_revision != self.data["revision"]:
                raise BodikConflictError(
                    "Data byla mezitím změněna v jiném panelu. Obnovte stránku a akci zopakujte."
                )

            existing_by_id = {profile["id"]: profile for profile in self.data["profiles"]}
            profiles = self._sanitize_profile_collection(
                raw.get("profiles", []), existing_by_id
            )
            admin_user_ids = await self._valid_manager_user_ids(
                raw.get("admin_user_ids", [])
            )

            self.data = {
                "revision": self.data["revision"] + 1,
                "profiles": profiles,
                "admin_user_ids": admin_user_ids,
                "updated_at": _now_iso(),
            }
            await self.store.async_save(self.data)

        self._register_entity_listener()
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
            if raw_backup.get("format_version") != 1:
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

            profiles = self._sanitize_profile_collection(raw_data.get("profiles", []))
            admin_user_ids = await self._valid_manager_user_ids(
                raw_data.get("admin_user_ids", [])
            )
            self.data = {
                "revision": self.data["revision"] + 1,
                "profiles": profiles,
                "admin_user_ids": admin_user_ids,
                "updated_at": _now_iso(),
            }
            await self.store.async_save(self.data)

        self._register_entity_listener()
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
                profile, previous, following, reason, user
            )

        if result["changed"]:
            await self._async_sync_mirror(result["profile"])
            self._fire_updated("score", result["profile"]["id"])
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
                profile, previous, following, reason, user
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
    ) -> dict[str, Any]:
        """Persist one score mutation while the caller holds ``self._lock``."""
        if following == previous:
            return {"changed": False, "profile": deepcopy(profile)}

        profile["score"] = following
        profile["history"].append(
            self._history_entry(reason, following - previous, previous, following, user)
        )
        profile["history"] = profile["history"][-MAX_HISTORY:]
        self.data["revision"] += 1
        self.data["updated_at"] = _now_iso()
        await self.store.async_save(self.data)
        return {"changed": True, "profile": deepcopy(profile)}

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
        profiles = [
            {"id": item["id"], "name": item["name"], "score": item["score"]}
            for item in self.data["profiles"]
        ]
        summary = "Aktuální stav: " + ". ".join(
            f"{item['name']}: {item['score']} bodů" for item in profiles
        )
        return {"scores_info": summary, "profiles": profiles}

    def info_response(self) -> dict[str, Any]:
        sections: list[str] = []
        for profile in self.data["profiles"]:
            reasons = "\n".join(
                f"- {item['name']}: {item['value']:+d}" for item in profile["reasons"]
            ) or "- Nejsou nastaveny"
            rewards = "\n".join(
                f"- {item['category']} (cíl {item['threshold']} bodů)"
                for item in profile["rewards"]
            ) or "- Nejsou nastaveny"
            sections.append(
                f"PROFIL: {profile['name']}\n"
                f"BODY: {profile['score']}\n"
                f"PRAVIDLA: {profile['rules'] or 'Nejsou definována'}\n"
                f"DŮVODY:\n{reasons}\n"
                f"ODMĚNY:\n{rewards}"
            )
        return {"bodik_info": "\n\n====================\n\n".join(sections)}
