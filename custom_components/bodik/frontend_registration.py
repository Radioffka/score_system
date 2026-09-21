"""Frontend asset and sidebar panel registration for Bodik."""

from __future__ import annotations

import logging

from aiohttp import web

from homeassistant.components import panel_custom
from homeassistant.components.http import HomeAssistantView, StaticPathConfig
from homeassistant.core import HomeAssistant

from .const import (
    DOMAIN,
    FRONTEND_MODULE_URL,
    FRONTEND_URL_ROOT,
    FRONTEND_VERSIONED_URL,
)

_LOGGER = logging.getLogger(__name__)

_PANEL_URL_PATH = "bodik"
_LEGACY_ASSETS = ("bodik-panel.css", "bodik-ui-utils.mjs")


class BodikFrontendLoaderView(HomeAssistantView):
    """Compatibility loader that forwards stable URLs to versioned assets."""

    url = f"{FRONTEND_URL_ROOT}/bodik-panel.js"
    name = "api:bodik:frontend_loader"
    requires_auth = False

    async def get(self, request: web.Request) -> web.Response:
        """Return a deliberately tiny, non-cacheable version selector."""
        return web.Response(
            text=f'import "{FRONTEND_MODULE_URL}";\n',
            content_type="text/javascript",
            charset="utf-8",
            headers={
                "Cache-Control": "no-store, max-age=0",
                "Pragma": "no-cache",
            },
        )


async def async_register_frontend(
    hass: HomeAssistant, *, panel_configured_in_yaml: bool = False
) -> None:
    """Register immutable assets, compatibility aliases and the sidebar panel."""
    frontend_path = hass.config.path("custom_components", DOMAIN, "frontend")
    static_paths = [
        StaticPathConfig(FRONTEND_VERSIONED_URL, frontend_path, True),
    ]
    static_paths.extend(
        StaticPathConfig(
            f"{FRONTEND_URL_ROOT}/{asset}",
            f"{frontend_path}/{asset}",
            False,
        )
        for asset in _LEGACY_ASSETS
    )
    await hass.http.async_register_static_paths(static_paths)
    hass.http.register_view(BodikFrontendLoaderView)

    # A manually configured panel_custom remains authoritative. Its legacy
    # module URL now loads the same release-versioned dependency graph.
    if panel_configured_in_yaml or _PANEL_URL_PATH in hass.data.get(
        "frontend_panels", {}
    ):
        _LOGGER.info(
            "Panel Bodík je již zaregistrován; zachovávám existující konfiguraci"
        )
        return

    await panel_custom.async_register_panel(
        hass,
        webcomponent_name="bodik-panel",
        frontend_url_path=_PANEL_URL_PATH,
        sidebar_title="Bodík",
        sidebar_icon="mdi:trophy",
        module_url=FRONTEND_MODULE_URL,
        embed_iframe=False,
        require_admin=False,
    )
