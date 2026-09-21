"""Bodík v9: authenticated ledger with periodic goals and entitlements."""

from __future__ import annotations

import logging

import voluptuous as vol

from homeassistant.components.http import StaticPathConfig
from homeassistant.core import HomeAssistant
from homeassistant.helpers.typing import ConfigType

from .api import async_register_services, async_register_websocket_commands
from .const import DOMAIN, VERSION
from .manager import BodikManager

_LOGGER = logging.getLogger(__name__)

CONFIG_SCHEMA = vol.Schema(
    {vol.Optional(DOMAIN): vol.Schema({})}, extra=vol.ALLOW_EXTRA
)


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Set up secure Bodík storage, APIs, services and frontend assets."""
    _LOGGER.info("Startuji Bodík v%s", VERSION)

    manager = BodikManager(hass)
    try:
        await manager.async_initialize()
    except Exception:  # noqa: BLE001 - setup must log the exact HA exception
        _LOGGER.exception("Bodík nelze inicializovat")
        return False

    hass.data[DOMAIN] = manager
    async_register_websocket_commands(hass, manager)
    async_register_services(hass, manager)

    component_path = hass.config.path("custom_components", DOMAIN)
    await hass.http.async_register_static_paths(
        [
            StaticPathConfig(
                "/bodik-panel/bodik-panel.js",
                f"{component_path}/bodik-panel.js",
                False,
            ),
            StaticPathConfig(
                "/bodik-panel/bodik-panel.css",
                f"{component_path}/bodik-panel.css",
                False,
            ),
            StaticPathConfig(
                "/bodik-panel/bodik-ui-utils.mjs",
                f"{component_path}/bodik-ui-utils.mjs",
                False,
            ),
        ]
    )

    _LOGGER.info("Bodík v%s je připraven", VERSION)
    return True
