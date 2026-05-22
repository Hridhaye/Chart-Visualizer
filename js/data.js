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
 *     emblem?: boolean             — marks a node with a special child/emblem indicator
 *     notable?: boolean            — marks a node/card as notable
 *     rank?: 'ascended' | 'sentinel' — special rank shown as A/S badge
 *   }
 */

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
