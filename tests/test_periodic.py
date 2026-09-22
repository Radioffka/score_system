"""Targeted tests for the Bodík v9 periodic engine."""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
import importlib.util
import json
from pathlib import Path
import unittest
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

MODULE_PATH = Path(__file__).parents[1] / "custom_components" / "bodik" / "periodic.py"
SPEC = importlib.util.spec_from_file_location("bodik_periodic", MODULE_PATH)
periodic = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(periodic)

UTC = timezone.utc
try:
    PRAGUE = ZoneInfo("Europe/Prague")
    HAS_PRAGUE_TZ = True
except ZoneInfoNotFoundError:  # Minimal Windows Python may omit the IANA database.
    PRAGUE = timezone.utc
    HAS_PRAGUE_TZ = False


def moment(value: str) -> datetime:
    return datetime.fromisoformat(value).astimezone(UTC)


class PeriodicEngineTest(unittest.TestCase):
    def setUp(self) -> None:
        self.config = periodic.default_config()
        self.config.update(
            {
                "daily_target": 30,
                "base_digital_minutes": 120,
                "bonus_step_points": 5,
                "bonus_step_minutes": 15,
                "max_digital_minutes": 180,
                "weekly_target": 180,
                "monthly_target": 100,
                "allowance_at_100": 200,
                "max_payout_percent": 150,
            }
        )
        self.config = periodic.validate_config(self.config)

    def transaction(self, state, when: str, delta: int, *, eligible: bool = True, kind: str = "adjust_score") -> None:
        state["transactions"].append(
            {
                "id": f"tx-{len(state['transactions'])}",
                "time": periodic.iso_utc(moment(when)),
                "delta": delta,
                "kind": kind,
                "counts_toward_periods": eligible,
            }
        )

    def test_v8_migration_starts_empty_and_preserves_external_ledger(self) -> None:
        old_history = [{"time": "2026-01-01T12:00:00+00:00", "delta": 999}]
        state = periodic.new_state(moment("2026-09-10T10:00:00+00:00"), self.config, PRAGUE)
        self.assertEqual([], state["transactions"])
        self.assertTrue(state["daily_initial_partial"])
        self.assertEqual(999, old_history[0]["delta"])

    def test_negative_and_administrative_transactions(self) -> None:
        state = periodic.new_state(moment("2026-09-10T00:00:00+00:00"), self.config, PRAGUE)
        self.transaction(state, "2026-09-10T08:00:00+00:00", 8)
        self.transaction(state, "2026-09-10T09:00:00+00:00", -11)
        self.transaction(state, "2026-09-10T10:00:00+00:00", 500, eligible=False, kind="set_score")
        status = periodic.current_status(state, self.config, moment("2026-09-10T12:00:00+00:00"), PRAGUE)
        self.assertEqual(-3, status["daily"]["points"])
        self.assertEqual(33, status["daily"]["remaining"])

    def test_restart_catch_up_and_duplicate_close_are_idempotent(self) -> None:
        state = periodic.new_state(moment("2026-09-01T10:00:00+00:00"), self.config, PRAGUE)
        self.transaction(state, "2026-09-02T10:00:00+00:00", 35)
        self.transaction(state, "2026-09-03T10:00:00+00:00", 40)
        now = moment("2026-09-04T08:00:00+00:00")
        self.assertTrue(periodic.close_periods(state, self.config, now, PRAGUE))
        count = len(state["daily_results"])
        self.assertGreaterEqual(count, 3)
        self.assertTrue(state["daily_results"][0]["initial_partial"])
        self.assertFalse(state["daily_results"][0]["applied"])
        self.assertEqual(150, state["today_digital_entitlement"])
        snapshot = deepcopy(state)
        self.assertFalse(periodic.close_periods(state, self.config, now, PRAGUE))
        self.assertEqual(snapshot, state)
        restarted = json.loads(json.dumps(state))
        restarted_status = periodic.current_status(restarted, self.config, now, PRAGUE)
        self.assertEqual(150, restarted_status["daily"]["today_entitlement"])

    @unittest.skipUnless(HAS_PRAGUE_TZ, "IANA tzdata is not installed locally")
    def test_dst_daily_boundaries_use_local_time(self) -> None:
        spring = periodic.daily_period_start(moment("2026-03-29T10:00:00+00:00"), PRAGUE)
        spring_next = periodic.next_daily_boundary(spring, PRAGUE)
        self.assertEqual(23 * 3600, (spring_next - spring).total_seconds())
        autumn = periodic.daily_period_start(moment("2026-10-25T10:00:00+00:00"), PRAGUE)
        autumn_next = periodic.next_daily_boundary(autumn, PRAGUE)
        self.assertEqual(25 * 3600, (autumn_next - autumn).total_seconds())

    @unittest.skipUnless(HAS_PRAGUE_TZ, "IANA tzdata is not installed locally")
    def test_weekly_friday_boundary_keeps_local_time_across_dst(self) -> None:
        config = deepcopy(self.config)
        config["weekly_tick_weekday"] = 4
        config["weekly_tick_time"] = "17:00"
        spring_start = periodic.weekly_period_start(
            moment("2026-03-27T18:00:00+00:00"), config, PRAGUE
        )
        spring_end = periodic.next_weekly_boundary(spring_start, config, PRAGUE)
        self.assertEqual((17, 0), (spring_end.astimezone(PRAGUE).hour, spring_end.astimezone(PRAGUE).minute))
        self.assertEqual(167 * 3600, (spring_end - spring_start).total_seconds())

        autumn_start = periodic.weekly_period_start(
            moment("2026-10-23T18:00:00+00:00"), config, PRAGUE
        )
        autumn_end = periodic.next_weekly_boundary(autumn_start, config, PRAGUE)
        self.assertEqual((17, 0), (autumn_end.astimezone(PRAGUE).hour, autumn_end.astimezone(PRAGUE).minute))
        self.assertEqual(169 * 3600, (autumn_end - autumn_start).total_seconds())

    def test_daily_entitlement_formula_and_cap(self) -> None:
        expected = {29: 0, 30: 120, 34: 120, 35: 135, 50: 180, 100: 180}
        for points, minutes in expected.items():
            with self.subTest(points=points):
                self.assertEqual(minutes, periodic.digital_entitlement(points, self.config))

    def test_recalibrated_family_entitlement_mapping(self) -> None:
        config = deepcopy(self.config)
        config["daily_target"] = 20
        expected = {19: 0, 20: 120, 24: 120, 25: 135, 29: 135,
                    30: 150, 34: 150, 35: 165, 39: 165, 40: 180, 100: 180}
        for points, minutes in expected.items():
            with self.subTest(points=points):
                self.assertEqual(minutes, periodic.digital_entitlement(points, config))

    def test_weekly_reward_is_from_previous_closed_week(self) -> None:
        config = deepcopy(self.config)
        config["weekly_target"] = 10
        config["weekly_reward"] = {"enabled": True, "label": "Výlet", "description": "Společná odměna"}
        config = periodic.validate_config(config)
        state = periodic.new_state(moment("2026-09-04T18:00:00+00:00"), config, PRAGUE)
        # First boundary is deliberately partial and must not grant a reward.
        self.transaction(state, "2026-09-05T10:00:00+00:00", 50)
        periodic.close_periods(state, config, moment("2026-09-11T18:00:00+00:00"), PRAGUE)
        self.assertIsNone(state["active_weekly_reward"])
        self.transaction(state, "2026-09-12T10:00:00+00:00", 10)
        periodic.close_periods(state, config, moment("2026-09-18T18:00:00+00:00"), PRAGUE)
        reward = state["active_weekly_reward"]
        self.assertTrue(reward["unlocked"])
        self.assertEqual(10, reward["source_points"])
        status = periodic.current_status(state, config, moment("2026-09-19T10:00:00+00:00"), PRAGUE)
        self.assertEqual(0, status["weekly"]["points"])
        self.assertEqual("Výlet", status["weekly"]["active_reward"]["label"])

    def test_invalid_config_is_rejected_by_backend_model(self) -> None:
        invalid = deepcopy(self.config)
        invalid["bonus_step_points"] = 0
        with self.assertRaises(periodic.PeriodicValidationError):
            periodic.validate_config(invalid)
        invalid = deepcopy(self.config)
        invalid["payout_bands"][-1]["payout_percent"] = 90
        with self.assertRaises(periodic.PeriodicValidationError):
            periodic.validate_config(invalid)

    def test_allowance_exact_and_over_cap_boundaries(self) -> None:
        expected = {
            49: (0, 0),
            50: (40, 80),
            70: (70, 140),
            85: (90, 180),
            100: (100, 200),
            110: (110, 220),
            150: (150, 300),
            170: (150, 300),
        }
        for points, (percent, amount) in expected.items():
            with self.subTest(points=points):
                result = periodic.allowance(points, self.config)
                self.assertEqual(percent, result["payout_percent"])
                self.assertEqual(amount, result["amount"])

    def test_monthly_520_payout_boundaries_and_live_threshold(self) -> None:
        config = deepcopy(self.config)
        config["monthly_target"] = 520
        expected = {259: 0, 260: 80, 363: 80, 364: 140, 441: 140,
                    442: 180, 519: 180, 520: 200, 778: 299, 780: 300, 800: 300}
        for points, amount in expected.items():
            with self.subTest(points=points):
                self.assertEqual(amount, periodic.allowance(points, config)["amount"])
        self.assertEqual({"minimum_percent": 50, "points": 260},
                         periodic.first_paying_threshold(config))

        state = periodic.new_state(moment("2026-09-10T10:00:00+00:00"), config, PRAGUE)
        self.transaction(state, "2026-09-10T11:00:00+00:00", 96)
        monthly = periodic.current_status(
            state, config, moment("2026-09-10T12:00:00+00:00"), PRAGUE
        )["monthly"]
        self.assertEqual(0, monthly["estimated_allowance"]["amount"])
        self.assertEqual({"minimum_percent": 50, "points": 260, "points_remaining": 164},
                         monthly["first_paying_threshold"])

    def test_first_payout_uses_configured_bands_and_target(self) -> None:
        config = deepcopy(self.config)
        config["monthly_target"] = 333
        config["payout_bands"] = [
            {"minimum_percent": 0, "payout_percent": 0},
            {"minimum_percent": 40, "payout_percent": 0},
            {"minimum_percent": 65, "payout_percent": 10},
            {"minimum_percent": 100, "payout_percent": 100},
        ]
        self.assertEqual({"minimum_percent": 65, "points": 217},
                         periodic.first_paying_threshold(config))
        config["allowance_at_100"] = 1
        self.assertEqual({"minimum_percent": 100, "points": 333},
                         periodic.first_paying_threshold(config))
        config["allowance_at_100"] = 0
        self.assertIsNone(periodic.first_paying_threshold(config))

    def test_backup_json_round_trip_preserves_state(self) -> None:
        state = periodic.new_state(moment("2026-09-01T10:00:00+00:00"), self.config, PRAGUE)
        self.transaction(state, "2026-09-02T10:00:00+00:00", 30)
        periodic.close_periods(state, self.config, moment("2026-09-03T10:00:00+00:00"), PRAGUE)
        restored = json.loads(json.dumps({"periodic_config": self.config, "periodic": state}))
        self.assertEqual(state, restored["periodic"])
        self.assertEqual(self.config, periodic.validate_config(restored["periodic_config"]))

    def test_profiles_are_independent(self) -> None:
        first = periodic.new_state(moment("2026-09-10T00:00:00+00:00"), self.config, PRAGUE)
        second = periodic.new_state(moment("2026-09-10T00:00:00+00:00"), self.config, PRAGUE)
        self.transaction(first, "2026-09-10T08:00:00+00:00", 30)
        self.transaction(second, "2026-09-10T08:00:00+00:00", -4)
        now = moment("2026-09-10T12:00:00+00:00")
        self.assertEqual(30, periodic.current_status(first, self.config, now, PRAGUE)["daily"]["points"])
        self.assertEqual(-4, periodic.current_status(second, self.config, now, PRAGUE)["daily"]["points"])


if __name__ == "__main__":
    unittest.main()
