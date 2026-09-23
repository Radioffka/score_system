"""Migration contract tests for the v8.1.0 -> v9 manager data model."""

from __future__ import annotations

import importlib.util
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json
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
family_module = sys.modules["custom_components.bodik.family_config"]


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
        self.assertEqual(4, migrated["data_version"])
        self.assertEqual(17, migrated["revision"])
        self.assertEqual(42, profile["score"])
        self.assertEqual("Starý zápis", profile["history"][0]["desc"])
        self.assertNotIn("rewards", profile)
        self.assertEqual("Výlet", profile["legacy_rewards"][0]["category"])
        self.assertEqual([], profile["periodic"]["transactions"])
        self.assertTrue(profile["periodic"]["daily_initial_partial"])
        self.assertFalse(profile["history"][0]["counts_toward_periods"])

    def test_legacy_reason_receives_an_id_that_remains_stable(self) -> None:
        hass = types.SimpleNamespace(config=types.SimpleNamespace(time_zone="UTC"))
        manager = manager_module.BodikManager(hass)
        manager._time_zone = lambda: timezone.utc
        stored = {
            "data_version": 4,
            "profiles": [{"id": "child", "name": "Dítě", "score": 0, "reasons": [{"name": "Pomoc", "value": 2}]}],
        }
        first = manager._normalize_stored_data(stored)
        reason_id = first["profiles"][0]["reasons"][0]["id"]
        second = manager._normalize_stored_data(first)
        self.assertTrue(reason_id)
        self.assertEqual(reason_id, second["profiles"][0]["reasons"][0]["id"])
        self.assertEqual("Pomoc", second["profiles"][0]["reasons"][0]["name"])
        self.assertEqual(2, second["profiles"][0]["reasons"][0]["value"])

    def test_family_migration_replaces_legacy_reasons_once_with_canonical_model(self) -> None:
        hass = types.SimpleNamespace(config=types.SimpleNamespace(time_zone="UTC"))
        manager = manager_module.BodikManager(hass)
        manager._time_zone = lambda: timezone.utc
        stored = {
            "data_version": 2,
            "admin_user_ids": ["parent"],
            "profiles": [
                {
                    "id": "tomas", "name": "Tomášek", "score": 27,
                    "scoreEntity": "input_number.tomas", "rules": "Rodinná pravidla",
                    "childPhotoUrl": "/local/tomas.jpg",
                    "history": [{"time": "2026-09-01T10:00:00+00:00", "desc": "Původní +50", "prev": -23, "next": 27}],
                    "reasons": [
                        {"id": "legacy_praise", "name": "Pochvala učitele / kroužku", "value": 50},
                        {"name": "Jednička z tělocviku", "value": 40},
                        {"name": "Aktivita", "value": 30},
                        {"name": "Vlastní původní důvod", "value": 7},
                    ],
                    "rewards": [{"id": "old", "category": "Původní odměna", "threshold": 20}],
                },
                {
                    "id": "kubik", "name": "Kubík", "score": 11,
                    "reasons": [{"name": "Starý bonus", "value": 100}],
                },
            ],
        }
        migrated = manager._normalize_stored_data(stored)
        profile = migrated["profiles"][0]
        second_profile = migrated["profiles"][1]
        self.assertEqual(["parent"], migrated["admin_user_ids"])
        self.assertEqual(27, profile["score"])
        self.assertEqual("Původní +50", profile["history"][0]["desc"])
        self.assertEqual((-23, 27), (profile["history"][0]["prev"], profile["history"][0]["next"]))
        self.assertNotIn("rewards", profile)
        self.assertEqual("Původní odměna", profile["legacy_rewards"][0]["category"])
        self.assertEqual("Rodinná pravidla", profile["rules"])
        self.assertEqual("/local/tomas.jpg", profile["childPhotoUrl"])
        self.assertEqual("input_number.tomas", profile["scoreEntity"])
        self.assertEqual(20, profile["periodic_config"]["daily_target"])
        self.assertEqual(120, profile["periodic_config"]["base_digital_minutes"])
        self.assertEqual(5, profile["periodic_config"]["bonus_step_points"])
        self.assertEqual(15, profile["periodic_config"]["bonus_step_minutes"])
        self.assertEqual(180, profile["periodic_config"]["max_digital_minutes"])
        self.assertEqual(120, profile["periodic_config"]["weekly_target"])
        self.assertEqual(4, profile["periodic_config"]["weekly_tick_weekday"])
        self.assertEqual("17:00", profile["periodic_config"]["weekly_tick_time"])
        self.assertEqual(520, profile["periodic_config"]["monthly_target"])
        self.assertEqual(2, profile["family_config_version"])
        self.assertEqual(200, profile["periodic_config"]["allowance_at_100"])
        self.assertEqual(150, profile["periodic_config"]["max_payout_percent"])
        self.assertEqual(
            [(0, 0), (50, 40), (70, 70), (85, 90), (100, 100)],
            [(item["minimum_percent"], item["payout_percent"]) for item in profile["periodic_config"]["payout_bands"]],
        )
        self.assertEqual(8, profile["offline_daily_cap"])
        reasons = {item["name"]: item for item in profile["reasons"]}
        canonical = family_module.family_reasons()
        canonical_categories = family_module.family_reason_categories()
        self.assertEqual(44, len(profile["reasons"]))
        self.assertEqual(canonical, profile["reasons"])
        self.assertEqual(canonical, second_profile["reasons"])
        self.assertEqual(canonical_categories, profile["reason_categories"])
        self.assertEqual(canonical_categories, second_profile["reason_categories"])
        self.assertNotIn("Vlastní původní důvod", reasons)
        self.assertNotIn("Jednička z tělocviku", reasons)
        self.assertNotIn("Aktivita", reasons)
        self.assertNotIn("Starý bonus", {item["name"]: item for item in second_profile["reasons"]})
        self.assertNotEqual("legacy_praise", reasons["Pochvala učitele / kroužku"]["id"])
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
        self.assertEqual(second_profile["reasons"], normalized_again["profiles"][1]["reasons"])
        self.assertEqual(profile["history"], normalized_again["profiles"][0]["history"])

    def test_family_values_are_not_universal_defaults_for_new_schema(self) -> None:
        hass = types.SimpleNamespace(config=types.SimpleNamespace(time_zone="UTC"))
        manager = manager_module.BodikManager(hass)
        manager._time_zone = lambda: timezone.utc
        normalized = manager._normalize_stored_data(
            {"data_version": 4, "profiles": [{"id": "new", "name": "Tomášek", "score": 0}]}
        )
        profile = normalized["profiles"][0]
        self.assertEqual(1, profile["periodic_config"]["daily_target"])
        self.assertEqual([], profile["reasons"])
        self.assertIsNone(profile["offline_daily_cap"])

    def test_family_v1_targets_migrate_once_without_rewriting_periodic_accounting(self) -> None:
        hass = types.SimpleNamespace(config=types.SimpleNamespace(time_zone="UTC"))
        manager = manager_module.BodikManager(hass)
        manager._time_zone = lambda: timezone.utc
        periodic = sys.modules["custom_components.bodik.periodic"]
        when = datetime.fromisoformat("2026-09-10T10:00:00+00:00")
        old_config = family_module.family_periodic_config()
        old_config.update({"daily_target": 30, "weekly_target": 180, "monthly_target": 780})
        old_config["weekly_reward"] = {"enabled": True, "label": "Vlastní výlet", "description": "Sobota"}
        old_config["bonus_step_minutes"] = 12
        state = periodic.new_state(when, old_config, timezone.utc)
        state["transactions"] = [
            {"id": "earned", "time": "2026-09-10T11:00:00+00:00", "delta": 17,
             "kind": "reason", "counts_toward_periods": True,
             "reason_id": "home_walk_dog", "category": "home"},
            {"id": "admin", "time": "2026-09-10T11:30:00+00:00", "delta": 500,
             "kind": "set_score", "counts_toward_periods": False,
             "reason_id": None, "category": None},
        ]
        state["daily_results"] = [{"points": 30, "target": 30, "entitlement": 120}]
        state["weekly_results"] = [{"points": 180, "target": 180, "success": True}]
        state["monthly_results"] = [{"points": 780, "target": 780, "allowance": 200}]
        state["today_digital_entitlement"] = 135
        state["active_weekly_reward"] = {"label": "Vlastní výlet", "unlocked": True}
        history = [{"time": "2026-09-10T11:00:00+00:00", "desc": "Starý záznam",
                    "delta": 17, "prev": 483, "next": 500, "user": "Rodič",
                    "kind": "reason", "counts_toward_periods": True,
                    "reason_id": "home_walk_dog", "category": "home"}]
        old_profile = {
            "id": "tomas", "name": "Tomášek", "score": 500,
            "family_config_version": 1, "periodic_config": old_config, "periodic": state,
            "history": history, "reasons": family_module.family_reasons(),
            "reason_categories": family_module.family_reason_categories(),
            "offline_daily_cap": 6, "rules": "Vlastní pravidla",
            "childPhotoUrl": "/local/tomas.jpg", "scoreEntity": "input_number.tomas",
        }
        stored = {"data_version": 4, "revision": 8, "admin_user_ids": ["parent"],
                  "profiles": [old_profile, {**deepcopy(old_profile), "id": "kuba", "name": "Kuba"}]}
        migrated = manager._normalize_stored_data(stored)
        for profile in migrated["profiles"]:
            self.assertEqual(2, profile["family_config_version"])
            self.assertEqual((20, 120, 520), tuple(
                profile["periodic_config"][key]
                for key in ("daily_target", "weekly_target", "monthly_target")
            ))
            for key, value in old_config.items():
                if key not in family_module.FAMILY_TARGETS:
                    self.assertEqual(value, profile["periodic_config"][key])
            self.assertEqual(state, profile["periodic"])
            self.assertEqual(history, profile["history"])
            self.assertEqual(500, profile["score"])
            self.assertEqual("Vlastní pravidla", profile["rules"])
            self.assertEqual("/local/tomas.jpg", profile["childPhotoUrl"])
            self.assertEqual(family_module.family_reasons(), profile["reasons"])
            status = periodic.current_status(
                profile["periodic"], profile["periodic_config"],
                datetime.fromisoformat("2026-09-10T12:00:00+00:00"), timezone.utc,
            )
            self.assertEqual((17, 17, 17), tuple(status[period]["points"]
                             for period in ("daily", "weekly", "monthly")))
            self.assertEqual((20, 120, 520), tuple(status[period]["target"]
                             for period in ("daily", "weekly", "monthly")))
        again = manager._normalize_stored_data(json.loads(json.dumps(migrated)))
        self.assertEqual(migrated["profiles"], again["profiles"])
        self.assertEqual(["parent"], again["admin_user_ids"])

    def test_target_migration_does_not_touch_non_family_or_new_profiles(self) -> None:
        hass = types.SimpleNamespace(config=types.SimpleNamespace(time_zone="UTC"))
        manager = manager_module.BodikManager(hass)
        manager._time_zone = lambda: timezone.utc
        stored = {"data_version": 4, "profiles": [
            {"id": "other", "name": "Další dítě", "family_config_version": 1,
             "periodic_config": {"daily_target": 9, "weekly_target": 40, "monthly_target": 100}},
            {"id": "new", "name": "Kubík", "family_config_version": 0,
             "periodic_config": {"daily_target": 7, "weekly_target": 35, "monthly_target": 90}},
            {"id": "updated", "name": "Tomášek", "family_config_version": 2,
             "periodic_config": {"daily_target": 25, "weekly_target": 135, "monthly_target": 540}},
        ]}
        normalized = manager._normalize_stored_data(stored)
        for profile, expected in zip(normalized["profiles"], [(9, 40, 100), (7, 35, 90), (25, 135, 540)]):
            self.assertEqual(expected, tuple(profile["periodic_config"][key]
                                              for key in ("daily_target", "weekly_target", "monthly_target")))

    def test_v9_category_migration_preserves_periodic_state_and_is_idempotent(self) -> None:
        hass = types.SimpleNamespace(config=types.SimpleNamespace(time_zone="UTC"))
        manager = manager_module.BodikManager(hass)
        manager._time_zone = lambda: timezone.utc
        baseline = manager._normalize_stored_data({
            "data_version": 4,
            "profiles": [{
                "id": "child", "name": "Dítě", "score": 9,
                "reasons": [{"id": "stable", "name": "Sport", "value": 4, "category": "offline"}],
            }],
        })
        profile = baseline["profiles"][0]
        profile.pop("reason_categories")
        profile["periodic"]["transactions"].append({
            "id": "tx", "time": "2026-09-21T10:00:00+00:00", "delta": 4,
            "kind": "reason", "counts_toward_periods": True,
            "reason_id": "stable", "category": "offline",
        })
        profile["periodic"]["today_digital_entitlement"] = 135
        baseline["data_version"] = 3

        migrated = manager._normalize_stored_data(baseline)
        migrated_profile = migrated["profiles"][0]
        self.assertEqual(profile["periodic"], migrated_profile["periodic"])
        self.assertEqual("stable", migrated_profile["reasons"][0]["id"])
        self.assertEqual(
            {"school", "home", "behaviour", "offline", "digital"},
            {item["id"] for item in migrated_profile["reason_categories"]},
        )
        self.assertEqual(
            migrated_profile["reason_categories"],
            manager._normalize_stored_data(migrated)["profiles"][0]["reason_categories"],
        )

    def test_category_rename_and_delete_keep_reason_ids_and_records(self) -> None:
        hass = types.SimpleNamespace(config=types.SimpleNamespace(time_zone="UTC"))
        manager = manager_module.BodikManager(hass)
        manager._time_zone = lambda: timezone.utc
        stored = manager._normalize_stored_data({
            "data_version": 4,
            "profiles": [{
                "id": "child", "name": "Dítě", "score": 0,
                "reason_categories": [
                    {"id": "offline", "name": "Bez obrazovky", "order": 5},
                    {"id": "chores", "name": "Povinnosti", "order": 10},
                ],
                "reasons": [
                    {"id": "sport", "name": "Sport", "value": 4, "category": "offline"},
                    {"id": "dish", "name": "Nádobí", "value": 2, "category": "chores"},
                ],
            }],
        })
        edited = stored["profiles"][0]
        edited["reason_categories"][0]["name"] = "Pohyb bez obrazovky"
        edited["reason_categories"] = [item for item in edited["reason_categories"] if item["id"] != "chores"]
        for reason in edited["reasons"]:
            if reason["category"] == "chores":
                reason["category"] = ""
        normalized = manager._normalize_stored_data(stored)["profiles"][0]
        self.assertEqual(["sport", "dish"], [item["id"] for item in normalized["reasons"]])
        self.assertEqual("Pohyb bez obrazovky", normalized["reason_categories"][0]["name"])
        self.assertEqual("", normalized["reasons"][1]["category"])

    def test_backup_round_trip_preserves_categories_and_hidden_legacy_rewards(self) -> None:
        hass = types.SimpleNamespace(config=types.SimpleNamespace(time_zone="UTC"))
        manager = manager_module.BodikManager(hass)
        manager._time_zone = lambda: timezone.utc
        first = manager._normalize_stored_data({
            "data_version": 3,
            "profiles": [{
                "id": "child", "name": "Dítě", "score": 12,
                "reasons": [{"id": "read", "name": "Čtení", "value": 2, "category": "offline"}],
                "rewards": [{"id": "old-tv", "category": "Televize", "threshold": 20}],
            }],
        })
        second = manager._normalize_stored_data(first)
        self.assertEqual(first["profiles"][0]["reason_categories"], second["profiles"][0]["reason_categories"])
        self.assertEqual(first["profiles"][0]["legacy_rewards"], second["profiles"][0]["legacy_rewards"])
        self.assertNotIn("rewards", second["profiles"][0])

    def test_generated_rules_use_live_configuration(self) -> None:
        hass = types.SimpleNamespace(config=types.SimpleNamespace(time_zone="UTC"))
        manager = manager_module.BodikManager(hass)
        manager._time_zone = lambda: timezone.utc
        profile = manager._normalize_stored_data({
            "data_version": 4,
            "profiles": [{
                "id": "child", "name": "Dítě", "offline_daily_cap": 6,
                "periodic_config": {
                    "daily_target": 17, "base_digital_minutes": 45,
                    "bonus_step_points": 4, "bonus_step_minutes": 7,
                    "max_digital_minutes": 73, "weekly_target": 91,
                    "weekly_tick_weekday": 2, "weekly_tick_time": "16:30",
                    "monthly_target": 333, "allowance_at_100": 90,
                    "max_payout_percent": 120,
                },
            }],
        })["profiles"][0]
        summary = manager.generated_rules_summary(profile)
        for expected in ("17 bodů", "45 minut", "4 bodů", "+7 minut", "73 minut", "91 bodů", "středu", "16:30", "333 bodů", "90 Kč", "108 Kč", "6 kladných", "50 %", "167 bodů"):
            self.assertIn(expected, summary)
        self.assertNotIn("30 bodů", summary)

    def test_generated_rules_use_first_paying_band_for_independent_profile(self) -> None:
        hass = types.SimpleNamespace(config=types.SimpleNamespace(time_zone="UTC"))
        manager = manager_module.BodikManager(hass)
        manager._time_zone = lambda: timezone.utc
        profile = manager._normalize_stored_data({
            "data_version": 4,
            "profiles": [{"id": "other", "name": "Dítě",
                          "periodic_config": {"monthly_target": 333,
                                              "allowance_at_100": 90,
                                              "payout_bands": [
                                                  {"minimum_percent": 0, "payout_percent": 0},
                                                  {"minimum_percent": 40, "payout_percent": 0},
                                                  {"minimum_percent": 65, "payout_percent": 10},
                                                  {"minimum_percent": 100, "payout_percent": 100},
                                              ]}}],
        })["profiles"][0]
        summary = manager.generated_rules_summary(profile)
        self.assertIn("od 65 %", summary)
        self.assertIn("217 bodů", summary)
        self.assertNotIn("od 50 %", summary)


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
            {"data_version": 4, "revision": 1, "profiles": profiles}
        )
        return manager

    def profile(self, profile_id, reasons, *, offline_cap=None, categories=None):
        return {
            "id": profile_id,
            "name": profile_id,
            "score": 0,
            "reasons": reasons,
            "offline_daily_cap": offline_cap,
            "reason_categories": categories or [],
        }

    async def test_reset_selective_and_all_preserve_ledger_snapshots_and_entitlements(self) -> None:
        manager = self.make_manager([self.profile("alpha", []), self.profile("beta", [])])
        manager.async_can_manage = AsyncMock(return_value=True)
        manager.async_user_name = AsyncMock(return_value="Parent")
        manager._async_sync_mirror = AsyncMock()
        manager._schedule_periodic_tick = lambda: None
        await manager.async_adjust_score("alpha", 9, "Bonus", "Parent")
        manager._async_sync_mirror.reset_mock()
        profile = manager.data["profiles"][0]
        profile["periodic"]["daily_results"].append({"period_end": "old", "points": 55})
        profile["periodic"]["today_digital_entitlement"] = 120
        profile["periodic"]["active_weekly_reward"] = {"unlocked": True}
        before = deepcopy(profile["periodic"]["transactions"])
        revision = manager.data["revision"]
        await manager.async_reset_period("alpha", "daily", revision, "parent")
        profile = manager.data["profiles"][0]
        self.assertEqual(9, profile["score"])
        self.assertIsNotNone(profile["periodic"]["manual_reset_at"]["daily"])
        self.assertIsNone(profile["periodic"]["manual_reset_at"]["weekly"])
        self.assertEqual(before, profile["periodic"]["transactions"][:1])
        self.assertEqual(120, profile["periodic"]["today_digital_entitlement"])
        self.assertEqual({"unlocked": True}, profile["periodic"]["active_weekly_reward"])
        self.assertEqual({"period_end": "old", "points": 55}, profile["periodic"]["daily_results"][0])
        self.assertTrue(profile["history"][-1]["kind"] == "manual_period_reset")
        self.assertFalse(profile["periodic"]["transactions"][-1]["counts_toward_periods"])
        revision = manager.data["revision"]
        await manager.async_reset_period("alpha", "all", revision, "parent")
        profile = manager.data["profiles"][0]
        self.assertEqual(0, profile["score"])
        self.assertTrue(all(profile["periodic"]["manual_reset_at"].values()))
        self.assertEqual(0, manager.data["profiles"][1]["score"])
        self.assertEqual(1, manager._async_sync_mirror.await_count)
        self.assertEqual(-9, profile["history"][-1]["delta"])

    async def test_reset_requires_permission_and_rejects_stale_revision(self) -> None:
        manager = self.make_manager([self.profile("alpha", [])])
        manager.async_can_manage = AsyncMock(return_value=False)
        with self.assertRaises(PermissionError):
            await manager.async_reset_period("alpha", "daily", manager.data["revision"], "other")
        manager.async_can_manage = AsyncMock(return_value=True)
        with self.assertRaises(manager_module.BodikConflictError):
            await manager.async_reset_period("alpha", "daily", manager.data["revision"] - 1, "parent")
        self.assertEqual(0, manager.store.async_save.await_count)

    async def test_reset_save_failure_leaves_in_memory_data_untouched(self) -> None:
        manager = self.make_manager([self.profile("alpha", [])])
        manager.async_can_manage = AsyncMock(return_value=True)
        manager.async_user_name = AsyncMock(return_value="Parent")
        manager.store.async_save.side_effect = OSError("disk full")
        before = deepcopy(manager.data)
        with self.assertRaises(OSError):
            await manager.async_reset_period("alpha", "all", manager.data["revision"], "parent")
        self.assertEqual(before, manager.data)

    def test_reset_marker_survives_normalization_and_missing_marker_migrates(self) -> None:
        manager = self.make_manager([self.profile("alpha", [])])
        stored = deepcopy(manager.data)
        state = stored["profiles"][0]["periodic"]
        state.pop("manual_reset_at")
        migrated = manager._normalize_stored_data(stored)
        self.assertEqual({"daily": None, "weekly": None, "monthly": None}, migrated["profiles"][0]["periodic"]["manual_reset_at"])
        migrated["profiles"][0]["periodic"]["manual_reset_at"]["weekly"] = "2026-09-21T12:00:00+00:00"
        again = manager._normalize_stored_data(migrated)
        self.assertEqual("2026-09-21T12:00:00+00:00", again["profiles"][0]["periodic"]["manual_reset_at"]["weekly"])

    async def test_each_selective_reset_only_zeroes_its_own_live_scope(self) -> None:
        periodic = sys.modules["custom_components.bodik.periodic"]
        for scope in ("daily", "weekly", "monthly"):
            with self.subTest(scope=scope):
                manager = self.make_manager([self.profile("alpha", [])])
                manager.async_can_manage = AsyncMock(return_value=True)
                manager.async_user_name = AsyncMock(return_value="Parent")
                manager._async_sync_mirror = AsyncMock()
                await manager.async_adjust_score("alpha", 8, "Bonus", "Parent")
                await manager.async_reset_period("alpha", scope, manager.data["revision"], "parent")
                profile = manager.data["profiles"][0]
                status = periodic.current_status(
                    profile["periodic"], profile["periodic_config"],
                    datetime.now(timezone.utc) + timedelta(seconds=1), timezone.utc,
                )
                self.assertEqual(8, profile["score"])
                self.assertEqual(
                    {key: 0 if key == scope else 8 for key in periodic.RESET_SCOPES},
                    {key: status[key]["points"] for key in periodic.RESET_SCOPES},
                )

    async def test_reset_markers_survive_config_save_and_backup_import(self) -> None:
        manager = self.make_manager([self.profile("alpha", [])])
        manager.async_can_manage = AsyncMock(return_value=True)
        manager.async_user_name = AsyncMock(return_value="Parent")
        manager._valid_manager_user_ids = AsyncMock(return_value=[])
        manager._register_entity_listener = lambda: None
        manager._schedule_periodic_tick = lambda: None
        manager._async_sync_all_mirrors = AsyncMock()
        await manager.async_reset_period("alpha", "monthly", manager.data["revision"], "parent")
        marker = manager.data["profiles"][0]["periodic"]["manual_reset_at"]["monthly"]
        backup = deepcopy(manager.data)
        await manager.async_save_config(deepcopy(manager.data), manager.data["revision"], "parent")
        self.assertEqual(marker, manager.data["profiles"][0]["periodic"]["manual_reset_at"]["monthly"])
        await manager.async_import_backup({"format": "bodik-backup", "format_version": 2, "data": backup}, manager.data["revision"], "parent")
        self.assertEqual(marker, manager.data["profiles"][0]["periodic"]["manual_reset_at"]["monthly"])

    async def test_set_and_reset_long_term_score_do_not_change_periodic_progress(self) -> None:
        manager = self.make_manager([self.profile("alpha", [])])
        periodic = sys.modules["custom_components.bodik.periodic"]
        await manager.async_adjust_score("alpha", 5, "Běžná změna", "Parent")
        profile = manager.data["profiles"][0]
        profile["periodic"]["monthly_results"].append(
            {"points": 90, "target": 100, "amount": 180}
        )
        snapshots = deepcopy(profile["periodic"]["monthly_results"])
        moment = datetime.now(timezone.utc) + timedelta(minutes=1)

        def progress():
            current = manager.data["profiles"][0]
            status = periodic.current_status(
                current["periodic"], current["periodic_config"], moment, timezone.utc
            )
            return tuple(status[period]["points"] for period in ("daily", "weekly", "monthly"))

        self.assertEqual((5, 5, 5), progress())
        await manager.async_set_score("alpha", 500, "Administrativní nastavení", "Parent")
        self.assertEqual(500, manager.data["profiles"][0]["score"])
        self.assertEqual((5, 5, 5), progress())
        await manager.async_set_score("alpha", 0, "Vynulování dlouhodobého skóre", "Parent")
        self.assertEqual(0, manager.data["profiles"][0]["score"])
        self.assertEqual((5, 5, 5), progress())
        profile = manager.data["profiles"][0]
        self.assertEqual(snapshots, profile["periodic"]["monthly_results"])
        self.assertEqual([True, False, False], [
            tx["counts_toward_periods"] for tx in profile["periodic"]["transactions"]
        ])

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

    async def test_offline_cap_uses_stable_id_after_visible_category_rename(self) -> None:
        manager = self.make_manager([
            self.profile(
                "alpha",
                [
                    {"id": "sport", "name": "Sport", "value": 5, "category": "offline"},
                    {"id": "walk", "name": "Procházka", "value": 4, "category": "offline"},
                ],
                offline_cap=8,
                categories=[{"id": "offline", "name": "Pohyb bez obrazovky", "order": 1}],
            )
        ])
        now = manager_module.datetime.fromisoformat("2026-09-21T10:00:00+00:00")
        await manager.async_apply_reason("alpha", "sport", "Parent", now)
        with self.assertRaisesRegex(manager_module.BodikValidationError, "Offline limit"):
            await manager.async_apply_reason("alpha", "walk", "Parent", now)
        self.assertEqual("Pohyb bez obrazovky", manager._profile("alpha")["reason_categories"][0]["name"])


if __name__ == "__main__":
    unittest.main()
