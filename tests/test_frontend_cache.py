"""Regression tests for release-versioned Bodík frontend assets."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
COMPONENT = ROOT / "custom_components" / "bodik"


def _load_const_module():
    spec = importlib.util.spec_from_file_location(
        "bodik_test_const", COMPONENT / "const.py"
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FrontendCacheTests(unittest.TestCase):
    """Ensure a release changes the complete effective asset namespace."""

    def test_release_version_is_the_single_cache_namespace_source(self) -> None:
        const = _load_const_module()
        manifest_version = json.loads(
            (COMPONENT / "manifest.json").read_text(encoding="utf-8")
        )["version"]
        panel_source = (COMPONENT / "frontend" / "bodik-panel.js").read_text(
            encoding="utf-8"
        )
        panel_version_match = re.search(
            r'^const VERSION = "([^"]+)";$', panel_source, re.MULTILINE
        )

        self.assertEqual(const.VERSION, manifest_version)
        self.assertIsNotNone(panel_version_match)
        self.assertEqual(panel_version_match.group(1), manifest_version)
        self.assertEqual(
            const.FRONTEND_VERSIONED_URL,
            f"/bodik-panel/{manifest_version}",
        )
        self.assertEqual(
            const.FRONTEND_MODULE_URL,
            f"/bodik-panel/{manifest_version}/bodik-panel.js",
        )
        self.assertNotEqual(
            const.frontend_versioned_url("9.1.1"),
            const.frontend_versioned_url("9.1.2"),
        )

    def test_first_party_imports_and_css_follow_main_module_url(self) -> None:
        panel_source = (COMPONENT / "frontend" / "bodik-panel.js").read_text(
            encoding="utf-8"
        )

        self.assertIn('from "./bodik-ui-utils.mjs"', panel_source)
        self.assertIn(
            'new URL("./bodik-panel.css", import.meta.url).href', panel_source
        )
        self.assertNotIn("/bodik-panel/bodik-panel.css?v=", panel_source)

    def test_legacy_loader_and_manual_panel_compatibility_are_preserved(self) -> None:
        registration = (COMPONENT / "frontend_registration.py").read_text(
            encoding="utf-8"
        )

        self.assertIn('url = f"{FRONTEND_URL_ROOT}/bodik-panel.js"', registration)
        self.assertIn('text=f\'import "{FRONTEND_MODULE_URL}";\\n\'', registration)
        self.assertIn('"Cache-Control": "no-store, max-age=0"', registration)
        self.assertIn("panel_configured_in_yaml", registration)
        self.assertIn('hass.data.get(\n        "frontend_panels", {}', registration)
        self.assertIn(
            "StaticPathConfig(FRONTEND_VERSIONED_URL, frontend_path, True)",
            registration,
        )


if __name__ == "__main__":
    unittest.main()
