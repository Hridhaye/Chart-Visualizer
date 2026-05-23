/**
 * storage.js
 * Handles all persistence:
 *   - localStorage for the tree, spacing preference, and sync config
 *   - GitHub Gist for optional cloud sync
 *
 * None of these functions touch the DOM directly.
 * They return results; callers decide how to surface them in the UI.
 */

import { serializeNode, deserializeNode, getAutoColorMap, getAutoColorIdx,
         setAutoColorMap, setAutoColorIdx }
  from './data.js';

const SAVE_KEY     = 'cult_chart_v1';
const SPACING_KEY  = 'cult_chart_spacing';
const SYNC_CFG_KEY = 'cult_chart_sync_cfg_v1';

// ── Snapshot helpers ──────────────────────────────────────────────────────────

/**
 * Build a JSON-serializable snapshot of the current tree state.
 * `uid` must be passed in because it lives in data.js as a module-level let.
 */
export function buildSnapshot(root, uid, extras = {}) {
  return {
    tree:     serializeNode(root),
    autoMap:  { ...getAutoColorMap() },
    autoIdx:  getAutoColorIdx(),
    uid,
    savedAt:  new Date().toISOString(),
    ...extras,
  };
}

/**
 * Apply a snapshot to the app state.
 * Returns { root, uid } — callers are responsible for calling render().
 */
export function applySnapshot(data) {
  if (data.autoMap) setAutoColorMap(data.autoMap);
  if (typeof data.autoIdx === 'number') setAutoColorIdx(data.autoIdx);
  const root = deserializeNode(data.tree);
  const uid  = typeof data.uid === 'number' ? data.uid : 1;
  const occupations = Array.isArray(data.occupations)
    ? data.occupations.filter(v => typeof v === 'string').map(v => v.trim()).filter(Boolean)
    : [];
  const showOccupationSlips = !!data.showOccupationSlips;
  const symbolTerms = Array.isArray(data.symbolTerms)
    ? data.symbolTerms.filter(v => typeof v === 'string').map(v => v.trim()).filter(Boolean)
    : [];
  return { root, uid, occupations, showOccupationSlips, symbolTerms };
}

// ── Local save / load ─────────────────────────────────────────────────────────

export function saveToLocal(root, uid, extras = {}) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(buildSnapshot(root, uid, extras)));
    return true;
  } catch (e) {
    console.error('[storage] local save failed', e);
    return false;
  }
}

/**
 * Load from localStorage.
 * Returns { root, uid } on success, or null if nothing is stored.
 */
export function loadFromLocal() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    return applySnapshot(JSON.parse(raw));
  } catch (e) {
    console.error('[storage] local load failed', e);
    return null;
  }
}

// ── Spacing preference ────────────────────────────────────────────────────────

export function saveSpacing(value) {
  try { localStorage.setItem(SPACING_KEY, String(value)); } catch (e) {}
}

export function loadSpacing(fallback = 1.0) {
  try {
    const raw = localStorage.getItem(SPACING_KEY);
    if (!raw) return fallback;
    const v = parseFloat(raw);
    return isNaN(v) ? fallback : Math.min(1.7, Math.max(1.0, v));
  } catch (e) {
    return fallback;
  }
}

// ── Sync config ───────────────────────────────────────────────────────────────

const DEFAULT_SYNC_CFG = { gistId: '', fileName: 'cult-chart-save.json', token: '' };

export function loadSyncConfig() {
  try {
    const raw = localStorage.getItem(SYNC_CFG_KEY);
    if (!raw) return { ...DEFAULT_SYNC_CFG };
    const cfg = JSON.parse(raw);
    return {
      gistId:   (cfg.gistId   || '').trim(),
      fileName: (cfg.fileName || '').trim() || 'cult-chart-save.json',
      token:    (cfg.token    || '').trim(),
    };
  } catch (e) {
    return { ...DEFAULT_SYNC_CFG };
  }
}

export function saveSyncConfig(cfg) {
  try { localStorage.setItem(SYNC_CFG_KEY, JSON.stringify(cfg)); } catch (e) {}
}

// ── GitHub Gist ───────────────────────────────────────────────────────────────

/**
 * Push current tree to a GitHub Gist.
 * Returns { ok: boolean, status?: number, error?: string }
 */
export async function pushToGist(cfg, root, uid, extras = {}) {
  if (!cfg.gistId || !cfg.token) {
    return { ok: false, error: 'Missing gist ID or token' };
  }
  try {
    const res = await fetch(
      `https://api.github.com/gists/${encodeURIComponent(cfg.gistId)}`,
      {
        method: 'PATCH',
        headers: {
          'Accept':        'application/vnd.github+json',
          'Authorization': `Bearer ${cfg.token}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({
          files: {
            [cfg.fileName || 'cult-chart-save.json']: {
              content: JSON.stringify(buildSnapshot(root, uid, extras), null, 2),
            },
          },
        }),
      }
    );
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: 'Network error' };
  }
}

/**
 * Pull tree from a GitHub Gist.
 * Returns { ok: true, data } on success, or { ok: false, error }
 */
export async function pullFromGist(cfg) {
  if (!cfg.gistId) return { ok: false, error: 'Missing gist ID' };
  try {
    const headers = { 'Accept': 'application/vnd.github+json' };
    if (cfg.token) headers['Authorization'] = `Bearer ${cfg.token}`;
    const res = await fetch(
      `https://api.github.com/gists/${encodeURIComponent(cfg.gistId)}?_=${Date.now()}`,
      { headers, cache: 'no-store' }
    );
    if (!res.ok) return { ok: false, status: res.status };
    const gist     = await res.json();
    const fileName = cfg.fileName || 'cult-chart-save.json';
    const file     = gist.files?.[fileName];
    if (!file?.content) return { ok: false, error: `File not found: ${fileName}` };
    const data = JSON.parse(file.content);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: 'Parse or network error' };
  }
}
