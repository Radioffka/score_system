"""One-time family configuration seed requested in issue #3.

These values are migration data for the existing family profiles, not universal
defaults for new Bodík installations or profiles.
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any
import unicodedata

FAMILY_CONFIG_VERSION = 1
FAMILY_PROFILE_NAMES = {"tomasek", "kuba", "kubik"}

FAMILY_REASON_CATEGORIES = [
    {"id": "school", "name": "Škola", "order": 10},
    {"id": "home", "name": "Domov", "order": 20},
    {"id": "behaviour", "name": "Chování", "order": 30},
    {"id": "offline", "name": "Offline aktivity", "order": 40},
    {"id": "digital", "name": "Digitální disciplína", "order": 50},
]


def _reason(
    reason_id: str,
    name: str,
    value: int,
    category: str,
    limit: int | None = None,
) -> dict[str, Any]:
    return {
        "id": reason_id,
        "name": name,
        "value": value,
        "category": category,
        "max_occurrences_per_day": limit,
    }


FAMILY_REASONS = [
    _reason("school_grade_1", "Jednička", 5, "school"),
    _reason("school_grade_2", "Dvojka", 3, "school"),
    _reason("school_grade_3", "Trojka", 0, "school"),
    _reason("school_grade_4", "Čtyřka", -3, "school"),
    _reason("school_grade_5", "Pětka", -5, "school"),
    _reason("school_praise", "Pochvala učitele / kroužku", 5, "school"),
    _reason("school_activity", "Aktivita / mimořádná práce v hodině", 3, "school"),
    _reason("school_project", "Velká písemka / projekt nad očekávání", 3, "school"),
    _reason("school_homework_independent", "Domácí úkol bez připomínání", 2, "school"),
    _reason("school_homework_missing", "Nesplněný domácí úkol", -5, "school"),
    _reason("school_bag_ready", "Připravená aktovka bez připomínání", 2, "school"),
    _reason("school_supplies_forgotten", "Zapomenuté pomůcky", -2, "school"),
    _reason("school_items_forgotten", "Zapomenuté věci ve škole", -2, "school"),
    _reason("school_serious_problem", "Poznámka / vážnější problém ve škole", -10, "school"),
    _reason("home_make_bed", "Ustlání postele", 1, "home", 1),
    _reason("home_walk_dog", "Venčení psa", 3, "home"),
    _reason("home_tidy_sofa_table", "Srovnání gauče a stolu dohromady", 1, "home"),
    _reason("home_room_regular", "Běžný úklid pokoje", 2, "home", 1),
    _reason("home_room_complete", "Kompletní úklid pokoje", 5, "home", 1),
    _reason("home_dishes", "Pomoc s nádobím / myčkou", 2, "home", 2),
    _reason("home_bin", "Vynesení koše", 2, "home", 2),
    _reason("home_vacuum", "Luxování celého bytu", 3, "home", 1),
    _reason("home_shoes", "Srovnání botníku", 1, "home", 1),
    _reason("home_clothes_tidy", "Uklizení / srovnání oblečení", 1, "home", 1),
    _reason("home_clean_clothes_dirty", "Házení čistého oblečení do špíny", -3, "home", 2),
    _reason("home_teeth_clean", "Vyčištěné zuby bez připomínání", 1, "home", 2),
    _reason("home_teeth_missing", "Nevyčištěné zuby", -3, "home", 2),
    _reason("home_routine", "Ranní / večerní rutina bez dohadování", 2, "home", 1),
    _reason("home_prepare_next_day", "Příprava věcí na další den", 2, "home", 1),
    _reason("behaviour_kind", "Výrazně hezké / nesobecké chování", 3, "behaviour", 2),
    _reason("behaviour_backtalk", "Drzost / odmlouvání", -3, "behaviour", 3),
    _reason("behaviour_swearing", "Sprosté nadávky", -2, "behaviour", 3),
    _reason("behaviour_brother", "Ošklivé chování k bráchovi", -4, "behaviour", 2),
    _reason("behaviour_lying", "Lež / podvádění", -6, "behaviour", 2),
    _reason("behaviour_damage", "Úmyslné ničení věcí", -10, "behaviour", 1),
    _reason("offline_outside_30", "30 min aktivně venku", 2, "offline", 1),
    _reason("offline_outside_60", "60+ min aktivně venku", 4, "offline", 1),
    _reason("offline_sport", "Sport / trénink", 4, "offline", 1),
    _reason("offline_reading", "Čtení 20-30 min", 2, "offline", 1),
    _reason("offline_creative", "Tvoření / LEGO / deskovka 30+ min", 2, "offline", 1),
    _reason("digital_stop_on_time", "Vypnutí zařízení po limitu bez dohadování", 2, "digital", 1),
    _reason("digital_limit_kept", "Celý den dodržen digitální limit", 2, "digital", 1),
    _reason("digital_limit_exceeded", "Překročení limitu bez dovolení", -4, "digital", 2),
    _reason("digital_secret_use", "Tajné používání / obcházení pravidel", -8, "digital", 1),
]


def is_family_profile(name: str) -> bool:
    """Return whether this is one of the explicitly targeted existing profiles."""
    normalized = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    return normalized.casefold().strip() in FAMILY_PROFILE_NAMES


def family_periodic_config() -> dict[str, Any]:
    """Return the agreed independently stored per-profile configuration."""
    return {
        "daily_target": 30,
        "base_digital_minutes": 120,
        "bonus_step_points": 5,
        "bonus_step_minutes": 15,
        "max_digital_minutes": 180,
        "weekly_target": 180,
        "weekly_tick_weekday": 4,
        "weekly_tick_time": "17:00",
        "weekly_reward": {
            "enabled": False,
            "label": "Týdenní odměna",
            "description": "Konkrétní efekt bude nastaven později.",
        },
        "monthly_target": 780,
        "allowance_at_100": 200,
        "payout_bands": [
            {"minimum_percent": 0, "payout_percent": 0},
            {"minimum_percent": 50, "payout_percent": 40},
            {"minimum_percent": 70, "payout_percent": 70},
            {"minimum_percent": 85, "payout_percent": 90},
            {"minimum_percent": 100, "payout_percent": 100},
        ],
        "max_payout_percent": 150,
    }


def family_reasons() -> list[dict[str, Any]]:
    """Return a mutable copy of the agreed reasons."""
    return deepcopy(FAMILY_REASONS)


def family_reason_categories() -> list[dict[str, Any]]:
    """Return the stable semantic categories used by the family model."""
    return deepcopy(FAMILY_REASON_CATEGORIES)
