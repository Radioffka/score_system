"""Constants for the Bodik integration."""

DOMAIN = "bodik"
VERSION = "9.0.0"

STORAGE_KEY = DOMAIN
STORAGE_VERSION = 1

EVENT_UPDATED = "bodik_updated"

SERVICE_ADJUST_SCORE = "adjust_score"
SERVICE_SET_SCORE = "set_score"
SERVICE_GET_INFO = "get_info"
SERVICE_READ_SCORES = "read_scores"
SERVICE_READ_PERIODIC = "read_periodic"

MAX_HISTORY = 500
MAX_PROFILES = 20
MAX_REASONS = 200
MAX_REWARDS = 200
MAX_ABS_SCORE = 1_000_000
MAX_PERIOD_RESULTS = 400

LEGACY_RELATIVE_PATH = "www/bodik_data/settings.json"
