"""Migration contract tests for the v8.1.0 -> v9 manager data model."""

from __future__ import annotations

import importlib.util
from datetime import timezone
from pathlib import Path
import sys
import types
import unittest

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
        self.assertEqual(2, migrated["data_version"])
        self.assertEqual(17, migrated["revision"])
        self.assertEqual(42, profile["score"])
        self.assertEqual("Starý zápis", profile["history"][0]["desc"])
        self.assertEqual("Výlet", profile["rewards"][0]["category"])
        self.assertEqual([], profile["periodic"]["transactions"])
        self.assertTrue(profile["periodic"]["daily_initial_partial"])
        self.assertFalse(profile["history"][0]["counts_toward_periods"])


if __name__ == "__main__":
    unittest.main()
