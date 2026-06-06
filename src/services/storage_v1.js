/**
 * storage_v1.js
 *
 * Centralized localStorage service.
 * All keys and read/write logic live here.
 * Nothing in App.jsx should call localStorage directly.
 *
 * Scope:
 *   - UI preferences (theme, guest notice)
 *   - Fallback record cache (used when Supabase is unavailable)
 *
 * Note: primary record data is stored in Supabase (via /services/db).
 * localStorage is only used for:
 *   1. UI state that doesn't need cloud sync (theme, guest dismiss)
 *   2. Offline/fallback record cache (optional, not yet implemented)
 */

// ─── All localStorage keys in one place ──────────────────────
const KEYS = {
  THEME:          "hb_theme",
  GUEST_DISMISSED:"hb_guest_ok",
  RECORD_CACHE:   "hb_record_cache",   // reserved for offline cache
};

// ─── Raw accessor (private) ───────────────────────────────────
const _get = (key, fallback = null) => {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
};

const _set = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn("[storage] write failed:", key, e);
  }
};

// ─── Theme preference ─────────────────────────────────────────
export const getTheme  = ()        => _get(KEYS.THEME, "light");
export const saveTheme = (theme)   => _set(KEYS.THEME, theme);

// ─── Guest notice ─────────────────────────────────────────────
export const getGuestDismissed  = ()  => _get(KEYS.GUEST_DISMISSED, false);
export const setGuestDismissed  = ()  => _set(KEYS.GUEST_DISMISSED, true);

// ─── Record cache (fallback / offline) ───────────────────────
/**
 * loadRecords — load cached records from localStorage.
 * Returns an empty array if nothing is cached or parsing fails.
 * @returns {Array} raw record objects (not yet derived)
 */
export const loadRecords = () => _get(KEYS.RECORD_CACHE, []);

/**
 * saveRecords — write raw (stripped) records to localStorage cache.
 * Call with the result of records.map(strip) before dispatching to UI.
 * @param {Array} rawList — array of storable (stripped) record objects
 */
export const saveRecords = (rawList) => _set(KEYS.RECORD_CACHE, rawList);

/**
 * clearRecords — wipe the local cache (e.g. on logout).
 */
export const clearRecords = () => _set(KEYS.RECORD_CACHE, []);
