"""Constants for the Bodik integration."""

DOMAIN = "bodik"
VERSION = "9.2.1"

FRONTEND_URL_ROOT = "/bodik-panel"


def frontend_versioned_url(version: str = VERSION) -> str:
    """Return the immutable frontend namespace for a release."""
    return f"{FRONTEND_URL_ROOT}/{version}"


FRONTEND_VERSIONED_URL = frontend_versioned_url()
FRONTEND_MODULE_URL = f"{FRONTEND_VERSIONED_URL}/bodik-panel.js"

STORAGE_KEY = DOMAIN
STORAGE_VERSION = 1
DATA_VERSION = 4

EVENT_UPDATED = "bodik_updated"

SERVICE_ADJUST_SCORE = "adjust_score"
SERVICE_APPLY_REASON = "apply_reason"
SERVICE_SET_SCORE = "set_score"
SERVICE_GET_INFO = "get_info"
SERVICE_READ_SCORES = "read_scores"
SERVICE_READ_PERIODIC = "read_periodic"

MAX_HISTORY = 500
MAX_PROFILES = 20
MAX_REASONS = 200
MAX_REASON_CATEGORIES = 50
MAX_REWARDS = 200
MAX_ABS_SCORE = 1_000_000
MAX_PERIOD_RESULTS = 400

LEGACY_RELATIVE_PATH = "www/bodik_data/settings.json"
