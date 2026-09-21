"""Bodík v9: authenticated ledger with periodic goals and entitlements."""

from __future__ import annotations

import logging

import voluptuous as vol

from homeassistant.core import HomeAssistant
from homeassistant.helpers.typing import ConfigType

from .api import async_register_services, async_register_websocket_commands
from .const import DOMAIN, VERSION
from .frontend_registration import async_register_frontend
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

    configured_panels = config.get("panel_custom", []) or []
    panel_configured_in_yaml = any(
        isinstance(panel, dict) and panel.get("url_path") == "bodik"
        for panel in configured_panels
    )
    await async_register_frontend(
        hass, panel_configured_in_yaml=panel_configured_in_yaml
    )

    _LOGGER.info("Bodík v%s je připraven", VERSION)
    return True
