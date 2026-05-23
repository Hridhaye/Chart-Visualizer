/**
 * data.js
 * Core data model: node creation, tree traversal, sign→color mapping,
 * serialization/deserialization, and seed data.
 *
 * Node shape:
 *   { id: number, name: string, collapsed: boolean, children: Node[], meta: NodeMeta }
 *
 * NodeMeta (extensible bag — add fields here for new features):
 *   {
 *     reborn?: boolean             — marks a rebirth character (upcoming)
 *     rebirthChildSplit?: number   — index of first post-rebirth child (upcoming)
 *     occupation?: string          — god-vocation text (upcoming)
 *     occupation2?: string         — secondary occupation for special dual-occupation cards
 *     emblem?: boolean             — DEPRECATED: migrated into meta.symbols on load
 *     notable?: boolean            — DEPRECATED: migrated into meta.symbols on load
 *     rank?: 'ascended' | 'sentinel' — DEPRECATED: migrated into meta.symbols on load
 *     symbols?: string[]           — user-defined symbol terms (e.g. "Notable", "Ascended")
 *   }
 */

/**
 * The one symbol term whose presence is gated on the parent having a second
 * occupation. It cannot be removed from the symbol library.
 */
export const SECOND_OCC_CHILD_TERM = 'Second Occupation Child';

export let uid = 1;

// ── Node factory ──────────────────────────────────────────────────────────────

export function makeNode(name, id = null) {
  const nodeId = id !== null ? id : uid++;
  if (id !== null) uid = Math.max(uid, id + 1);
  return { id: nodeId, name, children: [], collapsed: false, meta: {} };
}

// ── Tree traversal ────────────────────────────────────────────────────────────

export function find(id, n) {
  if (n.id === id) return n;
  for (const c of n.children) {
    const r = find(id, c);
    if (r) return r;
  }
  return null;
}

export function findParent(id, n, parent = null) {
  if (n.id === id) return parent;
  for (const c of n.children) {
    const r = findParent(id, c, n);
    if (r !== undefined) return r;
  }
  return undefined;
}

/** Returns all nodes that are currently visible in the panel tree (respects collapsed). */
export function flatVisible(n, out = []) {
  out.push(n);
  if (!n.collapsed) {
    for (const c of n.children) flatVisible(c, out);
  }
  return out;
}

export function countAll(n) {
  let t = 1;
  for (const c of n.children) t += countAll(c);
  return t;
}

// ── Relationships export (for preview builder) ────────────────────────────────

export function toRelationships(node, out = []) {
  for (const c of node.children) {
    out.push([node.name, c.name]);
    toRelationships(c, out);
  }
  return out;
}

// ── Serialization ─────────────────────────────────────────────────────────────

export function serializeNode(n) {
  return {
    id: n.id,
    name: n.name,
    collapsed: n.collapsed,
    meta: { ...(n.meta || {}) },
    children: n.children.map(serializeNode),
  };
}

export function deserializeNode(d) {
  const n = makeNode(d.name, d.id);
  n.collapsed = d.collapsed || false;
  n.meta = d.meta ? { ...d.meta } : {};
  n.children = (d.children || []).map(deserializeNode);
  return n;
}

// ── Sign → color ──────────────────────────────────────────────────────────────

/**
 * Named signs with fixed brand colors.
 * Add new signs here as they appear in documents.
 */
const SIGN_COLORS = {
  Founding:    '#6c757d',
  Starbender:  '#3b82f6',
  Veilcross:   '#8b5cf6',
  Hollowmark:  '#9ca3af',
  Greythorne:  '#14b8a6',
  Ashenfold:   '#a855f7',
  Duskhollow:  '#64748b',
  Thornveil:   '#22c55e',
  Wychstone:   '#ef4444',
  Sablerune:   '#f97316',
  Marrowfen:   '#a16207',
  Emberlace:   '#fb923c',
  Pyrelace:    '#f87171',
};

const AUTO_PALETTE = [
  '#06b6d4', '#ec4899', '#84cc16', '#f59e0b',
  '#6366f1', '#10b981', '#f43f5e', '#0ea5e9',
  '#d946ef', '#16a34a', '#dc2626', '#7c3aed',
];

const _autoColorMap = {};
let _autoColorIdx = 0;

export function getAutoColorMap() { return { ..._autoColorMap }; }
export function setAutoColorMap(map) { Object.assign(_autoColorMap, map); }
export function getAutoColorIdx() { return _autoColorIdx; }
export function setAutoColorIdx(i) { _autoColorIdx = i; }

export function signOf(name) {
  if (name === 'Founding Father') return 'Founding';
  return name.split(' ')[0];
}

export function colorForNode(name) {
  const s = signOf(name);
  if (SIGN_COLORS[s]) return SIGN_COLORS[s];
  if (!_autoColorMap[s]) {
    _autoColorMap[s] = AUTO_PALETTE[_autoColorIdx++ % AUTO_PALETTE.length];
  }
  return _autoColorMap[s];
}

/** Full map of sign → color, for injecting into the preview iframe. */
export function allColorMap() {
  return { ...SIGN_COLORS, ..._autoColorMap };
}

/**
 * Split a node name into { sign, rest } for the rename UI.
 * "Founding Father" is the documented root special case: sign = "Founding", rest = "Father".
 * For any other name, sign is the first word and rest is everything after.
 * Returns { sign:'', rest:name } for single-word / empty names so the caller can fall back.
 */
export function splitName(name) {
  const n = String(name || '').trim();
  if (!n) return { sign: '', rest: '' };
  if (n === 'Founding Father') return { sign: 'Founding', rest: 'Father' };
  const sp = n.indexOf(' ');
  if (sp === -1) return { sign: '', rest: n };
  return { sign: n.slice(0, sp), rest: n.slice(sp + 1).trim() };
}

/** Recombine a sign + rest into a name. Empty sign falls back to rest alone. */
export function joinName(sign, rest) {
  const s = String(sign || '').trim();
  const r = String(rest || '').trim();
  if (s === 'Founding' && r === 'Father') return 'Founding Father';
  if (!s) return r;
  if (!r) return s;
  return s + ' ' + r;
}

/** All signs currently present in the tree (auto-assigned ones included). */
export function signsInTree(root, out = new Set()) {
  out.add(signOf(root.name));
  for (const c of root.children) signsInTree(c, out);
  return out;
}

/**
 * Union of fixed-named signs (SIGN_COLORS) and signs present in the tree,
 * sorted alphabetically. Used to populate the rename dropdown.
 */
export function knownSigns(root) {
  const set = new Set(Object.keys(SIGN_COLORS));
  if (root) for (const s of signsInTree(root)) if (s) set.add(s);
  return [...set].sort((a, b) => a.localeCompare(b));
}

// ── Symbol system ────────────────────────────────────────────────────────────

/**
 * Normalize a symbol term: trimmed, single-spaced, preserving case.
 */
export function normalizeTerm(term) {
  return String(term || '').trim().replace(/\s+/g, ' ');
}

/** Case-insensitive equality for terms. */
export function termsEqual(a, b) {
  return normalizeTerm(a).toLowerCase() === normalizeTerm(b).toLowerCase();
}

/**
 * Return the symbol terms on a node as a normalized, deduped array.
 * Reads from meta.symbols. Does NOT touch legacy fields.
 */
export function getNodeSymbols(node) {
  const list = Array.isArray(node?.meta?.symbols) ? node.meta.symbols : [];
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const t = normalizeTerm(raw);
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

/**
 * Compute the short visual letter(s) for each term in the given list.
 * Returns an object: { term: letters }.
 *
 * Algorithm: start with 1 letter for every term. While any group of terms
 * shares the same prefix, extend each colliding term by one letter (capped
 * at 3). Comparison is case-insensitive; output preserves original casing
 * from the source term, capitalizing the first letter and lowercasing the rest.
 */
export function computeSymbolLetters(terms) {
  const norm = terms.map(t => normalizeTerm(t)).filter(Boolean);
  const lens = new Map();
  for (const t of norm) lens.set(t, 1);

  const MAX_LEN = 3;
  for (let pass = 0; pass < MAX_LEN; pass++) {
    const buckets = new Map();
    for (const t of norm) {
      const len = Math.min(lens.get(t), t.length);
      const key = t.slice(0, len).toLowerCase();
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(t);
    }
    let extended = false;
    for (const group of buckets.values()) {
      if (group.length < 2) continue;
      for (const t of group) {
        const cur = lens.get(t);
        if (cur < t.length && cur < MAX_LEN) {
          lens.set(t, cur + 1);
          extended = true;
        }
      }
    }
    if (!extended) break;
  }

  const out = {};
  for (const t of norm) {
    const n = Math.min(lens.get(t), t.length);
    const slice = t.slice(0, n);
    // First letter capitalized, rest lowercased — gives "As", "Asc", etc.
    out[t] = slice.charAt(0).toUpperCase() + slice.slice(1).toLowerCase();
  }
  return out;
}

/**
 * Migrate legacy boolean/string meta fields into meta.symbols. Runs on load
 * and on every deserialize. Idempotent — safe to call repeatedly.
 *
 * Returns the set of terms that were introduced into the library by this
 * migration, so the caller can seed them into the user's symbol library.
 */
export function migrateLegacySymbolsInTree(root) {
  const introduced = new Set();
  function visit(n) {
    if (!n) return;
    const meta = n.meta || {};
    const existing = Array.isArray(meta.symbols) ? meta.symbols.slice() : [];
    const haveLower = new Set(existing.map(t => normalizeTerm(t).toLowerCase()));
    const add = term => {
      const t = normalizeTerm(term);
      if (!t) return;
      const k = t.toLowerCase();
      if (!haveLower.has(k)) {
        existing.push(t);
        haveLower.add(k);
      }
      introduced.add(t);
    };
    if (meta.notable === true) add('Notable');
    if (meta.emblem === true)  add(SECOND_OCC_CHILD_TERM);
    if (meta.rank === 'ascended') add('Ascended');
    if (meta.rank === 'sentinel') add('Sentinel');

    if (existing.length || 'symbols' in meta) {
      n.meta = { ...meta, symbols: existing };
    }
    // Clear deprecated fields so they don't keep migrating / round-tripping.
    if (n.meta) {
      if ('notable' in n.meta) delete n.meta.notable;
      if ('emblem'  in n.meta) delete n.meta.emblem;
      if ('rank'    in n.meta) delete n.meta.rank;
    }
    for (const c of n.children || []) visit(c);
  }
  visit(root);
  return [...introduced];
}

// ── Tree from relationship pairs ──────────────────────────────────────────────

export function fromPairs(pairs) {
  const map = {};
  const childSet = new Set();
  for (const [p, c] of pairs) {
    if (!map[p]) map[p] = makeNode(p);
    if (!map[c]) map[c] = makeNode(c);
    map[p].children.push(map[c]);
    childSet.add(c);
  }
  const rootName = Object.keys(map).find(n => !childSet.has(n));
  return map[rootName];
}

// ── Seed data ─────────────────────────────────────────────────────────────────

export const SEED_PAIRS = [
  ['Founding Father', 'Starbender Aerion'],
  ['Founding Father', 'Veilcross Hadrien'],
  ['Founding Father', 'Hollowmark Ennis'],
  ['Starbender Aerion', 'Starbender Calliothene'],
  ['Starbender Aerion', 'Starbender Tarn'],
  ['Veilcross Hadrien', 'Veilcross Ilm'],
  ['Veilcross Hadrien', 'Veilcross Joren'],
  ['Starbender Calliothene', 'Greythorne Sael'],
  ['Starbender Calliothene', 'Greythorne Eirevann'],
  ['Starbender Calliothene', 'Greythorne Talin'],
  ['Starbender Tarn', 'Starbender Korin'],
  ['Starbender Tarn', 'Starbender Duvaine'],
  ['Starbender Tarn', 'Starbender Oren'],
  ['Veilcross Ilm', 'Veilcross Pell'],
  ['Veilcross Ilm', 'Veilcross Oranthas'],
  ['Veilcross Joren', 'Veilcross Sora'],
  ['Greythorne Sael', 'Greythorne Una'],
  ['Greythorne Sael', 'Greythorne Veor'],
  ['Greythorne Sael', 'Greythorne Velindra'],
  ['Greythorne Eirevann', 'Ashenfold Thrennovael'],
  ['Starbender Korin', 'Starbender Zev'],
  ['Starbender Korin', 'Starbender Orvanthis'],
  ['Starbender Duvaine', 'Duskhollow Caleo'],
  ['Starbender Oren', 'Starbender Isolvar'],
  ['Veilcross Pell', 'Veilcross Emrethis'],
  ['Veilcross Pell', 'Veilcross Faro'],
  ['Veilcross Oranthas', 'Thornveil Gend'],
  ['Veilcross Oranthas', 'Thornveil Hesper'],
  ['Veilcross Oranthas', 'Thornveil Iro'],
  ['Veilcross Sora', 'Veilcross Aemorrhis'],
  ['Veilcross Sora', 'Veilcross Jorah'],
  ['Greythorne Talin', 'Greythorne Lir'],
  ['Greythorne Una', 'Greythorne Mei'],
  ['Greythorne Velindra', 'Wychstone Noor'],
  ['Ashenfold Thrennovael', 'Sablerune Oris'],
  ['Ashenfold Thrennovael', 'Sablerune Renn'],
  ['Starbender Zev', 'Starbender Quill'],
  ['Starbender Orvanthis', 'Marrowfen Rann'],
  ['Starbender Orvanthis', 'Marrowfen Saris'],
  ['Duskhollow Caleo', 'Duskhollow Ula'],
  ['Veilcross Emrethis', 'Emberlace Vren'],
  ['Veilcross Emrethis', 'Emberlace Wyl'],
  ['Thornveil Iro', 'Thornveil Xeph'],
  ['Veilcross Aemorrhis', 'Pyrelace Yorrin'],
  ['Veilcross Aemorrhis', 'Pyrelace Zera'],
  ['Marrowfen Saris', 'Marrowfen Sera'],
];
