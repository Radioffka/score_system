"""Migration contract tests for the v8.1.0 -> v9 manager data model."""

from __future__ import annotations

import importlib.util
from datetime import timedelta, timezone
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import AsyncMock

ROOT = Path(__file__).parents[1]
PACKAGE_PATH = ROOT / "custom_components" / "bodik"


def load_manager_module():
    """Load manager.py with tiny HA API stubs; production uses real HA classes."""
    homeassistant = types.ModuleType("homeassistant")
    core = types.ModuleType("homeassistant.core")
    helpers = types.ModuleType("homeassistant.helpers")
    event = types.ModuleType("homeassistant.helpers.event")
    storage = types.ModuleType("homeassistant.helpers.storage")

    class Placeholder:
        pass

    class Store:
        @classmethod
        def __class_getitem__(cls, _item):
            return cls

        def __init__(self, *_args, **_kwargs):
            pass

    core.Context = core.Event = core.HomeAssistant = core.State = Placeholder
    core.callback = lambda function: function
    core.valid_entity_id = lambda value: "." in value
    event.async_track_point_in_time = lambda *_args, **_kwargs: None
    event.async_track_state_change_event = lambda *_args, **_kwargs: None
    storage.Store = Store
    sys.modules.update(
        {
            "homeassistant": homeassistant,
            "homeassistant.core": core,
            "homeassistant.helpers": helpers,
            "homeassistant.helpers.event": event,
            "homeassistant.helpers.storage": storage,
        }
    )

    package = types.ModuleType("custom_components.bodik")
    package.__path__ = [str(PACKAGE_PATH)]
    sys.modules["custom_components.bodik"] = package
    for name in ("const", "periodic", "manager"):
        qualified = f"custom_components.bodik.{name}"
        spec = importlib.util.spec_from_file_location(qualified, PACKAGE_PATH / f"{name}.py")
        module = importlib.util.module_from_spec(spec)
        sys.modules[qualified] = module
        assert spec and spec.loader
        spec.loader.exec_module(module)
    return sys.modules["custom_components.bodik.manager"]


manager_module = load_manager_module()


class ManagerMigrationTest(unittest.TestCase):
    def test_v81_profile_fields_are_preserved_and_periodic_ledger_starts_empty(self) -> None:
        hass = types.SimpleNamespace(config=types.SimpleNamespace(time_zone="UTC"))
        manager = manager_module.BodikManager(hass)
        manager._time_zone = lambda: timezone.utc
        stored = {
            "revision": 17,
            "updated_at": "2026-09-20T10:00:00+00:00",
            "admin_user_ids": ["parent"],
            "profiles": [
                {
                    "id": "child",
                    "name": "Dítě",
                    "scoreEntity": "input_number.child_score",
                    "score": 42,
                    "rules": "Původní pravidla",
                    "reasons": [{"name": "Pomoc", "value": 3}],
                    "rewards": [{"id": "reward", "category": "Výlet", "value": 1, "unit": "ks", "period": None, "threshold": 40}],
                    "history": [{"time": "2026-09-01T10:00:00+00:00", "desc": "Starý zápis", "prev": 39, "next": 42, "user": "Rodič"}],
                }
            ],
        }
        migrated = manager._normalize_stored_data(stored)
        profile = migrated["profiles"][0]
        self.assertEqual(3, migrated["data_version"])
        self.assertEqual(17, migrated["revision"])
        self.assertEqual(42, profile["score"])
        self.assertEqual("Starý zápis", profile["history"][0]["desc"])
        self.assertEqual("Výlet", profile["rewards"][0]["category"])
        self.assertEqual([], profile["periodic"]["transactions"])
        self.assertTrue(profile["periodic"]["daily_initial_partial"])
        self.assertFalse(profile["history"][0]["counts_toward_periods"])

    def test_legacy_reason_receives_an_id_that_remains_stable(self) -> None:
        hass = types.SimpleNamespace(config=types.SimpleNamespace(time_zone="UTC"))
        manager = manager_module.BodikManager(hass)
        manager._time_zone = lambda: timezone.utc
        stored = {
            "data_version": 3,
            "profiles": [{"id": "child", "name": "Dítě", "score": 0, "reasons": [{"name": "Pomoc", "value": 2}]}],
        }
        first = manager._normalize_stored_data(stored)
        reason_id = first["profiles"][0]["reasons"][0]["id"]
        second = manager._normalize_stored_data(first)
        self.assertTrue(reason_id)
        self.assertEqual(reason_id, second["profiles"][0]["reasons"][0]["id"])
        self.assertEqual("Pomoc", second["profiles"][0]["reasons"][0]["name"])
        self.assertEqual(2, second["profiles"][0]["reasons"][0]["value"])

    def test_family_profiles_receive_issue_3_values_only_once(self) -> None:
        hass = types.SimpleNamespace(config=types.SimpleNamespace(time_zone="UTC"))
        manager = manager_module.BodikManager(hass)
        manager._time_zone = lambda: timezone.utc
        stored = {
            "data_version": 2,
            "profiles": [{
                "id": "tomas", "name": "Tomášek", "score": 27,
                "history": [{"time": "2026-09-01T10:00:00+00:00", "desc": "Původní", "prev": 25, "next": 27}],
                "reasons": [{"name": "Vlastní původní důvod", "value": 7}],
                "rewards": [{"id": "old", "category": "Původní odměna", "threshold": 20}],
            }],
        }
        migrated = manager._normalize_stored_data(stored)
        profile = migrated["profiles"][0]
        self.assertEqual(27, profile["score"])
        self.assertEqual("Původní", profile["history"][0]["desc"])
        self.assertEqual("Původní odměna", profile["rewards"][0]["category"])
        self.assertEqual(30, profile["periodic_config"]["daily_target"])
        self.assertEqual(120, profile["periodic_config"]["base_digital_minutes"])
        self.assertEqual(5, profile["periodic_config"]["bonus_step_points"])
        self.assertEqual(15, profile["periodic_config"]["bonus_step_minutes"])
        self.assertEqual(180, profile["periodic_config"]["max_digital_minutes"])
        self.assertEqual(180, profile["periodic_config"]["weekly_target"])
        self.assertEqual(4, profile["periodic_config"]["weekly_tick_weekday"])
        self.assertEqual("17:00", profile["periodic_config"]["weekly_tick_time"])
        self.assertEqual(780, profile["periodic_config"]["monthly_target"])
        self.assertEqual(200, profile["periodic_config"]["allowance_at_100"])
        self.assertEqual(150, profile["periodic_config"]["max_payout_percent"])
        self.assertEqual(
            [(0, 0), (50, 40), (70, 70), (85, 90), (100, 100)],
            [(item["minimum_percent"], item["payout_percent"]) for item in profile["periodic_config"]["payout_bands"]],
        )
        self.assertEqual(8, profile["offline_daily_cap"])
        reasons = {item["name"]: item for item in profile["reasons"]}
        self.assertIn("Vlastní původní důvod", reasons)
        self.assertEqual(1, reasons["Ustlání postele"]["max_occurrences_per_day"])
        self.assertIsNone(reasons["Venčení psa"]["max_occurrences_per_day"])
        self.assertIsNone(reasons["Srovnání gauče a stolu dohromady"]["max_occurrences_per_day"])
        expected = {
            "Jednička": (5, None), "Dvojka": (3, None), "Trojka": (0, None),
            "Čtyřka": (-3, None), "Pětka": (-5, None),
            "Pochvala učitele / kroužku": (5, None),
            "Aktivita / mimořádná práce v hodině": (3, None),
            "Velká písemka / projekt nad očekávání": (3, None),
            "Domácí úkol bez připomínání": (2, None), "Nesplněný domácí úkol": (-5, None),
            "Připravená aktovka bez připomínání": (2, None), "Zapomenuté pomůcky": (-2, None),
            "Zapomenuté věci ve škole": (-2, None), "Poznámka / vážnější problém ve škole": (-10, None),
            "Ustlání postele": (1, 1), "Venčení psa": (3, None),
            "Srovnání gauče a stolu dohromady": (1, None), "Běžný úklid pokoje": (2, 1),
            "Kompletní úklid pokoje": (5, 1), "Pomoc s nádobím / myčkou": (2, 2),
            "Vynesení koše": (2, 2), "Luxování celého bytu": (3, 1),
            "Srovnání botníku": (1, 1), "Uklizení / srovnání oblečení": (1, 1),
            "Házení čistého oblečení do špíny": (-3, 2),
            "Vyčištěné zuby bez připomínání": (1, 2), "Nevyčištěné zuby": (-3, 2),
            "Ranní / večerní rutina bez dohadování": (2, 1), "Příprava věcí na další den": (2, 1),
            "Výrazně hezké / nesobecké chování": (3, 2), "Drzost / odmlouvání": (-3, 3),
            "Sprosté nadávky": (-2, 3), "Ošklivé chování k bráchovi": (-4, 2),
            "Lež / podvádění": (-6, 2), "Úmyslné ničení věcí": (-10, 1),
            "30 min aktivně venku": (2, 1), "60+ min aktivně venku": (4, 1),
            "Sport / trénink": (4, 1), "Čtení 20-30 min": (2, 1),
            "Tvoření / LEGO / deskovka 30+ min": (2, 1),
            "Vypnutí zařízení po limitu bez dohadování": (2, 1),
            "Celý den dodržen digitální limit": (2, 1), "Překročení limitu bez dovolení": (-4, 2),
            "Tajné používání / obcházení pravidel": (-8, 1),
        }
        self.assertEqual(expected, {name: (item["value"], item["max_occurrences_per_day"]) for name, item in reasons.items() if name in expected})
        normalized_again = manager._normalize_stored_data(migrated)
        self.assertEqual(profile["reasons"], normalized_again["profiles"][0]["reasons"])

    def test_family_values_are_not_universal_defaults_for_new_schema(self) -> None:
        hass = types.SimpleNamespace(config=types.SimpleNamespace(time_zone="UTC"))
        manager = manager_module.BodikManager(hass)
        manager._time_zone = lambda: timezone.utc
        normalized = manager._normalize_stored_data(
            {"data_version": 3, "profiles": [{"id": "new", "name": "Tomášek", "score": 0}]}
        )
        profile = normalized["profiles"][0]
        self.assertEqual(1, profile["periodic_config"]["daily_target"])
        self.assertEqual([], profile["reasons"])
        self.assertIsNone(profile["offline_daily_cap"])


class ReasonApplicationTest(unittest.IsolatedAsyncioTestCase):
    def make_manager(self, profiles, zone=timezone.utc):
        hass = types.SimpleNamespace(
            config=types.SimpleNamespace(time_zone="UTC"),
            states={},
            bus=types.SimpleNamespace(async_fire=lambda *_args, **_kwargs: None),
        )
        manager = manager_module.BodikManager(hass)
        manager._time_zone = lambda: zone
        manager.store = types.SimpleNamespace(async_save=AsyncMock())
        manager.data = manager._normalize_stored_data(
            {"data_version": 3, "revision": 1, "profiles": profiles}
        )
        return manager

    def profile(self, profile_id, reasons, *, offline_cap=None):
        return {
            "id": profile_id,
            "name": profile_id,
            "score": 0,
            "reasons": reasons,
            "offline_daily_cap": offline_cap,
        }

    async def test_apply_reason_uses_server_value_and_enforces_daily_limit(self) -> None:
        manager = self.make_manager([
            self.profile("alpha", [{"id": "help", "name": "Pomoc", "value": 4, "max_occurrences_per_day": 1}])
        ])
        now = manager_module.datetime.fromisoformat("2026-09-21T10:00:00+00:00")
        await manager.async_apply_reason("alpha", "help", "Parent", now)
        self.assertEqual(4, manager.data["profiles"][0]["score"])
        self.assertEqual("help", manager.data["profiles"][0]["history"][-1]["reason_id"])
        with self.assertRaisesRegex(manager_module.BodikValidationError, "Denní limit"):
            await manager.async_apply_reason("alpha", "help", "Parent", now)
        self.assertEqual(1, len(manager.data["profiles"][0]["history"]))

    async def test_unlimited_reason_and_negative_reason(self) -> None:
        manager = self.make_manager([
            self.profile("alpha", [
                {"id": "plus", "name": "Plus", "value": 2},
                {"id": "minus", "name": "Mínus", "value": -5},
                {"id": "zero", "name": "Nula", "value": 0},
            ])
        ])
        now = manager_module.datetime.fromisoformat("2026-09-21T10:00:00+00:00")
        await manager.async_apply_reason("alpha", "plus", "Parent", now)
        await manager.async_apply_reason("alpha", "plus", "Parent", now)
        await manager.async_apply_reason("alpha", "minus", "Parent", now)
        await manager.async_apply_reason("alpha", "zero", "Parent", now)
        self.assertEqual(-1, manager.data["profiles"][0]["score"])
        self.assertEqual([-5], [item["delta"] for item in manager.data["profiles"][0]["history"] if item["reason_id"] == "minus"])
        self.assertEqual([0], [item["delta"] for item in manager.data["profiles"][0]["history"] if item["reason_id"] == "zero"])

    async def test_limits_are_independent_per_profile_and_local_day(self) -> None:
        reason = {"id": "once", "name": "Jednou", "value": 1, "max_occurrences_per_day": 1}
        manager = self.make_manager([
            self.profile("alpha", [reason]),
            self.profile("beta", [reason]),
        ], zone=timezone(timedelta(hours=2)))
        day_one = manager_module.datetime.fromisoformat("2026-09-21T21:30:00+00:00")
        day_two = manager_module.datetime.fromisoformat("2026-09-21T22:30:00+00:00")
        await manager.async_apply_reason("alpha", "once", "Parent", day_one)
        await manager.async_apply_reason("beta", "once", "Parent", day_one)
        await manager.async_apply_reason("alpha", "once", "Parent", day_two)
        self.assertEqual(2, manager._profile("alpha")["score"])
        self.assertEqual(1, manager._profile("beta")["score"])

    async def test_offline_daily_cap_is_enforced_without_partial_award(self) -> None:
        manager = self.make_manager([
            self.profile("alpha", [
                {"id": "sport", "name": "Sport", "value": 4, "category": "offline"},
                {"id": "outside", "name": "Venku", "value": 2, "category": "offline"},
            ], offline_cap=8)
        ])
        now = manager_module.datetime.fromisoformat("2026-09-21T10:00:00+00:00")
        await manager.async_apply_reason("alpha", "sport", "Parent", now)
        await manager.async_apply_reason("alpha", "sport", "Parent", now)
        with self.assertRaisesRegex(manager_module.BodikValidationError, "Offline limit"):
            await manager.async_apply_reason("alpha", "outside", "Parent", now)
        self.assertEqual(8, manager._profile("alpha")["score"])


if __name__ == "__main__":
    unittest.main()
