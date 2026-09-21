"""Authenticated WebSocket and service API for Bodík."""

from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, ServiceCall, SupportsResponse, callback
from homeassistant.exceptions import ServiceValidationError
import homeassistant.helpers.config_validation as cv

from .const import (
    DOMAIN,
    MAX_ABS_SCORE,
    SERVICE_ADJUST_SCORE,
    SERVICE_GET_INFO,
    SERVICE_READ_SCORES,
    SERVICE_SET_SCORE,
)
from .manager import BodikConflictError, BodikManager, BodikValidationError


_LOGGER = logging.getLogger(__name__)

PROFILE_FIELD = vol.All(cv.string, vol.Length(min=1, max=128))
REASON_FIELD = vol.All(cv.string, vol.Length(max=250))
SCORE_FIELD = vol.All(vol.Coerce(int), vol.Range(min=-MAX_ABS_SCORE, max=MAX_ABS_SCORE))


def _user_id(connection: websocket_api.ActiveConnection) -> str | None:
    user = getattr(connection, "user", None)
    return user.id if user else None


def _send_exception(
    connection: websocket_api.ActiveConnection, message_id: int, err: Exception
) -> None:
    if isinstance(err, BodikConflictError):
        code = "conflict"
    elif isinstance(err, PermissionError):
        code = "unauthorized"
    elif isinstance(err, BodikValidationError):
        code = "invalid_format"
    else:
        code = "unknown_error"
        _LOGGER.exception("Neočekávaná chyba při zpracování požadavku Bodíku")
    connection.send_error(message_id, code, str(err))


async def _require_manager_permission(
    connection: websocket_api.ActiveConnection,
    message_id: int,
    manager: BodikManager,
) -> str | None:
    user_id = _user_id(connection)
    if not await manager.async_can_manage(user_id):
        connection.send_error(
            message_id,
            "unauthorized",
            "Uživatel nemá oprávnění spravovat Bodík.",
        )
        return None
    return user_id


@websocket_api.websocket_command({vol.Required("type"): "bodik/get"})
@websocket_api.async_response
async def websocket_get(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    manager: BodikManager = hass.data[DOMAIN]
    connection.send_result(msg["id"], await manager.async_payload(_user_id(connection)))


@websocket_api.websocket_command(
    {
        vol.Required("type"): "bodik/save_config",
        vol.Required("revision"): vol.Coerce(int),
        vol.Required("data"): dict,
    }
)
@websocket_api.async_response
async def websocket_save_config(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    manager: BodikManager = hass.data[DOMAIN]
    user_id = await _require_manager_permission(connection, msg["id"], manager)
    if user_id is None:
        return
    try:
        result = await manager.async_save_config(msg["data"], msg["revision"], user_id)
    except Exception as err:  # Home Assistant sends a structured WS error below.
        _send_exception(connection, msg["id"], err)
        return
    connection.send_result(
        msg["id"], {"data": result, "revision": result["revision"]}
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): "bodik/import_backup",
        vol.Required("revision"): vol.Coerce(int),
        vol.Required("backup"): dict,
    }
)
@websocket_api.async_response
async def websocket_import_backup(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Import a complete settings and history backup."""
    manager: BodikManager = hass.data[DOMAIN]
    user_id = await _require_manager_permission(connection, msg["id"], manager)
    if user_id is None:
        return
    try:
        result = await manager.async_import_backup(
            msg["backup"], msg["revision"], user_id
        )
    except Exception as err:
        _send_exception(connection, msg["id"], err)
        return
    connection.send_result(
        msg["id"], {"data": result, "revision": result["revision"]}
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): "bodik/adjust_score",
        vol.Required("profile_id"): PROFILE_FIELD,
        vol.Required("delta"): SCORE_FIELD,
        vol.Optional("reason", default="Ruční změna bodů"): REASON_FIELD,
    }
)
@websocket_api.async_response
async def websocket_adjust_score(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    manager: BodikManager = hass.data[DOMAIN]
    user_id = await _require_manager_permission(connection, msg["id"], manager)
    if user_id is None:
        return
    try:
        result = await manager.async_adjust_score(
            msg["profile_id"],
            msg["delta"],
            msg["reason"],
            await manager.async_user_name(user_id),
        )
    except Exception as err:
        _send_exception(connection, msg["id"], err)
        return
    connection.send_result(msg["id"], {"profile": result})


@websocket_api.websocket_command(
    {
        vol.Required("type"): "bodik/set_score",
        vol.Required("profile_id"): PROFILE_FIELD,
        vol.Required("value"): SCORE_FIELD,
        vol.Optional("reason", default="Ruční nastavení bodů"): REASON_FIELD,
    }
)
@websocket_api.async_response
async def websocket_set_score(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    manager: BodikManager = hass.data[DOMAIN]
    user_id = await _require_manager_permission(connection, msg["id"], manager)
    if user_id is None:
        return
    try:
        result = await manager.async_set_score(
            msg["profile_id"],
            msg["value"],
            msg["reason"],
            await manager.async_user_name(user_id),
        )
    except Exception as err:
        _send_exception(connection, msg["id"], err)
        return
    connection.send_result(msg["id"], {"profile": result})


@websocket_api.websocket_command(
    {
        vol.Required("type"): "bodik/clear_history",
        vol.Required("profile_id"): PROFILE_FIELD,
    }
)
@websocket_api.async_response
async def websocket_clear_history(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    manager: BodikManager = hass.data[DOMAIN]
    user_id = await _require_manager_permission(connection, msg["id"], manager)
    if user_id is None:
        return
    try:
        result = await manager.async_clear_history(msg["profile_id"], user_id)
    except Exception as err:
        _send_exception(connection, msg["id"], err)
        return
    connection.send_result(msg["id"], {"profile": result})


@callback
def async_register_websocket_commands(
    hass: HomeAssistant, manager: BodikManager
) -> None:
    """Register authenticated frontend commands."""
    del manager  # The live manager is resolved from hass.data by every handler.
    websocket_api.async_register_command(hass, websocket_get)
    websocket_api.async_register_command(hass, websocket_save_config)
    websocket_api.async_register_command(hass, websocket_import_backup)
    websocket_api.async_register_command(hass, websocket_adjust_score)
    websocket_api.async_register_command(hass, websocket_set_score)
    websocket_api.async_register_command(hass, websocket_clear_history)


ADJUST_SCHEMA = vol.Schema(
    {
        vol.Required("profile"): PROFILE_FIELD,
        vol.Required("amount"): SCORE_FIELD,
        vol.Optional("reason", default="Změna přes službu Home Assistantu"): REASON_FIELD,
    }
)
SET_SCHEMA = vol.Schema(
    {
        vol.Required("profile"): PROFILE_FIELD,
        vol.Required("value"): SCORE_FIELD,
        vol.Optional("reason", default="Nastavení přes službu Home Assistantu"): REASON_FIELD,
    }
)


async def _require_service_manager_permission(
    call: ServiceCall, manager: BodikManager
) -> None:
    """Allow system automations and authorized interactive service calls."""
    user_id = call.context.user_id
    if user_id is not None and not await manager.async_can_manage(user_id):
        raise ServiceValidationError(
            "Uživatel nemá oprávnění spravovat Bodík."
        )


@callback
def async_register_services(hass: HomeAssistant, manager: BodikManager) -> None:
    """Register automation and MCP-facing services."""

    async def handle_adjust(call: ServiceCall) -> dict[str, Any]:
        await _require_service_manager_permission(call, manager)
        profile = await manager.async_adjust_score(
            call.data["profile"],
            call.data["amount"],
            call.data["reason"],
            await manager.async_user_name(call.context.user_id),
        )
        return {"profile": profile, **manager.scores_response()}

    async def handle_set(call: ServiceCall) -> dict[str, Any]:
        await _require_service_manager_permission(call, manager)
        profile = await manager.async_set_score(
            call.data["profile"],
            call.data["value"],
            call.data["reason"],
            await manager.async_user_name(call.context.user_id),
        )
        return {"profile": profile, **manager.scores_response()}

    async def handle_info(_call: ServiceCall) -> dict[str, Any]:
        return manager.info_response()

    async def handle_scores(_call: ServiceCall) -> dict[str, Any]:
        return manager.scores_response()

    hass.services.async_register(
        DOMAIN,
        SERVICE_ADJUST_SCORE,
        handle_adjust,
        schema=ADJUST_SCHEMA,
        supports_response=SupportsResponse.OPTIONAL,
    )
    hass.services.async_register(
        DOMAIN,
        SERVICE_SET_SCORE,
        handle_set,
        schema=SET_SCHEMA,
        supports_response=SupportsResponse.OPTIONAL,
    )
    hass.services.async_register(
        DOMAIN,
        SERVICE_GET_INFO,
        handle_info,
        schema=vol.Schema({}),
        supports_response=SupportsResponse.ONLY,
    )
    hass.services.async_register(
        DOMAIN,
        SERVICE_READ_SCORES,
        handle_scores,
        schema=vol.Schema({}),
        supports_response=SupportsResponse.ONLY,
    )
