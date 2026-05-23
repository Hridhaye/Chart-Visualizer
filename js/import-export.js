/**
 * import-export.js
 * Utilities for importing trees (path-list or legacy indented) and exporting
 * relationship arrays. No DOM side-effects; callers wire these to buttons.
 */

import { makeNode, toRelationships, normalizeTerm, SECOND_OCC_CHILD_TERM } from './data.js';

const EDGE_SEP = ' >> ';
const ROOT_PREFIX = '!ROOT ';

// Indented text -> tree

function parseBool(value) {
  const s = String(value || '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'y' || s === 'on';
}

function canonicalizeKey(key) {
  const k = String(key || '').trim().toLowerCase().replace(/[_\-\s]/g, '');
  if (k === 'occupation' || k === 'occ') return 'occupation';
  if (k === 'secondoccupation' || k === 'occupation2' || k === 'secondocc' || k === 'occ2') return 'occupation2';
  if (
    k === 'secondoccupationchild' ||
    k === 'secondemblemchild' ||
    k === 'secondemblem' ||
    k === 'emblem'
  ) return 'emblem';
  if (k === 'notable' || k === 'isnotable') return 'notable';
  if (k === 'rank' || k === 'class' || k === 'tier') return 'rank';
  return '';
}

// Reserved keys handled specifically (occupation / occupation2). Any other
// "Word: true" tag becomes a symbol term, including the legacy keys
// (notable / rank / secondOccupationChild) for backwards compatibility.
const RESERVED_VALUE_KEYS = new Set(['occupation', 'occupation2']);

function legacyKeyToTerm(canonicalKey, rawValue) {
  if (canonicalKey === 'notable') return parseBool(rawValue) ? 'Notable' : null;
  if (canonicalKey === 'emblem')  return parseBool(rawValue) ? SECOND_OCC_CHILD_TERM : null;
  if (canonicalKey === 'rank') {
    const v = String(rawValue || '').trim().toLowerCase();
    if (v === 'ascended') return 'Ascended';
    if (v === 'sentinel') return 'Sentinel';
    return null;
  }
  return null;
}

function parseNodeLine(line) {
  const segments = line.split('|').map(s => s.trim()).filter(Boolean);
  const name = (segments.shift() || '').trim();
  const meta = {};
  const symbols = [];
  const seenSymbol = new Set();

  function addSymbol(term) {
    const t = normalizeTerm(term);
    if (!t) return;
    const k = t.toLowerCase();
    if (seenSymbol.has(k)) return;
    seenSymbol.add(k);
    symbols.push(t);
  }

  for (const segment of segments) {
    const sep = segment.includes(':') ? ':' : (segment.includes('=') ? '=' : null);
    if (!sep) continue;
    const idx = segment.indexOf(sep);
    const rawKey = segment.slice(0, idx).trim();
    const rawValue = segment.slice(idx + 1).trim();

    const canonical = canonicalizeKey(rawKey);
    if (canonical === 'occupation') { meta.occupation = rawValue; continue; }
    if (canonical === 'occupation2') { meta.occupation2 = rawValue; continue; }

    // Legacy boolean/rank fields → symbol terms.
    if (canonical === 'notable' || canonical === 'emblem' || canonical === 'rank') {
      const term = legacyKeyToTerm(canonical, rawValue);
      if (term) addSymbol(term);
      continue;
    }

    // Anything else of the form "Word: true" is treated as a symbol term.
    // The term is taken from rawKey verbatim (after normalization) so casing
    // and spaces from the user are preserved.
    if (parseBool(rawValue)) addSymbol(rawKey);
  }

  if (symbols.length) meta.symbols = symbols;
  return { name, meta };
}

function normalizeMeta(meta) {
  const out = {};
  if (meta && typeof meta === 'object') {
    const occupation = String(meta.occupation || '').trim();
    const occupation2 = String(meta.occupation2 || '').trim();
    if (occupation) out.occupation = occupation;
    if (occupation2) out.occupation2 = occupation2;
    // Pass through any pre-existing symbols (from in-memory tree → snapshot path).
    if (Array.isArray(meta.symbols) && meta.symbols.length) {
      const seen = new Set();
      const list = [];
      for (const raw of meta.symbols) {
        const t = normalizeTerm(raw);
        if (!t) continue;
        const k = t.toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        list.push(t);
      }
      if (list.length) out.symbols = list;
    }
  }
  return out;
}

/**
 * Parse indented text into a root node.
 * Format:
 *   Name | occupation: X | secondOccupation: Y | secondOccupationChild: true | notable: true
 * Indentation: 2 spaces per level (tabs count as 2 spaces).
 */
export function parseIndentedText(text) {
  const stack = [];
  let root = null;
  let nodeCount = 0;
  let pairCount = 0;
  const occupations = new Set();
  const symbolTerms = new Set();

  for (const raw of text.split('\n')) {
    if (!raw.trim()) continue;
    const trimmedLine = raw.trim();
    if (trimmedLine.startsWith('#') || trimmedLine.startsWith('//')) continue;

    let indent = 0;
    for (const ch of raw) {
      if (ch === ' ') indent += 1;
      else if (ch === '\t') indent += 2;
      else break;
    }

    const depth = Math.round(indent / 2);
    const { name, meta } = parseNodeLine(trimmedLine);
    if (!name) continue;

    const node = makeNode(name);
    node.meta = normalizeMeta(meta);
    if (node.meta.occupation) occupations.add(node.meta.occupation);
    if (node.meta.occupation2) occupations.add(node.meta.occupation2);
    if (Array.isArray(node.meta.symbols)) for (const t of node.meta.symbols) symbolTerms.add(t);

    while (stack.length > 0 && stack[stack.length - 1].depth >= depth) {
      stack.pop();
    }

    if (stack.length > 0) {
      stack[stack.length - 1].node.children.push(node);
      pairCount += 1;
    } else if (!root) {
      root = node;
    } else {
      // Multiple top-level lines: attach to root to keep a single tree.
      root.children.push(node);
      pairCount += 1;
    }

    stack.push({ depth, node });
    nodeCount += 1;
  }

  return {
    root,
    nodeCount,
    pairCount,
    occupations: [...occupations].sort((a, b) => a.localeCompare(b)),
    symbolTerms: [...symbolTerms].sort((a, b) => a.localeCompare(b)),
  };
}

/**
 * Parse and build a root node from text. Auto-detects format:
 *   - Edge list (e.g. "Parent >> Child") — preferred, copy/paste-safe, compact.
 *   - Legacy indented text (2 spaces per level) — still accepted.
 * Returns { root, nodeCount, pairCount, occupations } or null if not enough content.
 */
export function importFromIndentedText(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return null;

  const looksLikeEdgeList = trimmed
    .split('\n')
    .some(l => {
      const t = l.trim();
      if (!t || t.startsWith('#') || t.startsWith('//')) return false;
      return t.includes('>>') || t.startsWith(ROOT_PREFIX);
    });

  const parsed = looksLikeEdgeList
    ? parseEdgeList(trimmed)
    : parseIndentedText(trimmed);

  if (!parsed.root || parsed.nodeCount < 2 || parsed.pairCount < 1) return null;
  return parsed;
}

// Tree -> edge list (preferred, copy/paste-safe, compact)

function metaSuffix(node) {
  const parts = [];
  const occupation = String(node.meta?.occupation || '').trim();
  const occupation2 = String(node.meta?.occupation2 || '').trim();
  if (occupation) parts.push(`occupation: ${occupation}`);
  if (occupation2) parts.push(`secondOccupation: ${occupation2}`);
  if (Array.isArray(node.meta?.symbols)) {
    const seen = new Set();
    for (const raw of node.meta.symbols) {
      const t = normalizeTerm(raw);
      if (!t) continue;
      const k = t.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      parts.push(`${t}: true`);
    }
  }
  return parts.length ? ' | ' + parts.join(' | ') : '';
}

/**
 * Serialize a root node to an edge list. Each line is one parent-child edge:
 *   "Parent >> Child | optional attrs on child"
 * Sibling order = order of appearance. The root is the node that never appears
 * as a child; an optional "!ROOT Name | attrs" line carries root attributes.
 *
 * This format survives copy/paste through chat apps (no leading whitespace to
 * strip), stays compact at any depth, and is easy for AI models to generate
 * and edit (one line = one relationship).
 */
export function exportToIndentedText(root) {
  const lines = [];
  const rootSuffix = metaSuffix(root);
  if (rootSuffix || root.children.length === 0) {
    lines.push(ROOT_PREFIX + root.name + rootSuffix);
  }

  function walk(node) {
    for (const c of node.children) {
      lines.push(node.name + EDGE_SEP + c.name + metaSuffix(c));
      walk(c);
    }
  }
  walk(root);

  const header = [
    '# Family tree as an edge list. Each line is one parent-child relationship:',
    '#   Parent >> Child              (optionally: | occupation: X | secondOccupation: Y | <SymbolTerm>: true ...)',
    '# Sibling order = order of appearance under each parent.',
    '# The root is the node that never appears on the right side of ">>".',
    '# A "!ROOT Name | attrs" line (if present) sets attributes on the root.',
    '# Lines starting with # are ignored. Node names are treated as unique identifiers.',
  ].join('\n');

  return header + '\n\n' + lines.join('\n');
}

/**
 * Parse an edge list back into a tree.
 * Lines: "Parent >> Child | optional attrs"  or  "!ROOT Name | optional attrs"
 * Node names are unique identifiers. Order of edges = sibling order.
 */
export function parseEdgeList(text) {
  const nodeByName = new Map();
  const childSet = new Set();
  let nodeCount = 0;
  let pairCount = 0;
  const occupations = new Set();
  const symbolTerms = new Set();
  let explicitRootName = null;

  function getOrCreate(name) {
    let n = nodeByName.get(name);
    if (!n) {
      n = makeNode(name);
      nodeByName.set(name, n);
      nodeCount += 1;
    }
    return n;
  }

  function applyAttrs(node, attrStr) {
    if (!attrStr) return;
    const { meta } = parseNodeLine(node.name + ' ' + attrStr);
    node.meta = normalizeMeta(meta);
    if (node.meta.occupation) occupations.add(node.meta.occupation);
    if (node.meta.occupation2) occupations.add(node.meta.occupation2);
    if (Array.isArray(node.meta.symbols)) for (const t of node.meta.symbols) symbolTerms.add(t);
  }

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#') || line.startsWith('//')) continue;

    if (line.startsWith(ROOT_PREFIX)) {
      const rest = line.slice(ROOT_PREFIX.length).trim();
      const pipeIdx = rest.indexOf('|');
      const name = (pipeIdx === -1 ? rest : rest.slice(0, pipeIdx)).trim();
      const attrStr = pipeIdx === -1 ? '' : rest.slice(pipeIdx);
      if (!name) continue;
      const node = getOrCreate(name);
      applyAttrs(node, attrStr);
      explicitRootName = name;
      continue;
    }

    const sepIdx = line.indexOf('>>');
    if (sepIdx === -1) continue;

    const parentName = line.slice(0, sepIdx).trim();
    const after = line.slice(sepIdx + 2);
    const pipeIdx = after.indexOf('|');
    const childName = (pipeIdx === -1 ? after : after.slice(0, pipeIdx)).trim();
    const attrStr = pipeIdx === -1 ? '' : after.slice(pipeIdx);
    if (!parentName || !childName) continue;

    const parent = getOrCreate(parentName);
    const child = getOrCreate(childName);

    if (!childSet.has(childName)) {
      parent.children.push(child);
      childSet.add(childName);
      pairCount += 1;
    }
    applyAttrs(child, attrStr);
  }

  let root = null;
  if (explicitRootName && nodeByName.has(explicitRootName)) {
    root = nodeByName.get(explicitRootName);
  } else {
    for (const [name, node] of nodeByName) {
      if (!childSet.has(name)) { root = node; break; }
    }
  }

  return {
    root,
    nodeCount,
    pairCount,
    occupations: [...occupations].sort((a, b) => a.localeCompare(b)),
    symbolTerms: [...symbolTerms].sort((a, b) => a.localeCompare(b)),
  };
}

// Relationship array export (for pasting into HTML files)

/**
 * Build the `const relationships = [...]` JS snippet used by the legacy HTML chart.
 */
export function exportRelationshipArray(root) {
  const rels = toRelationships(root);
  const lines = rels.map(([p, c]) => `  ["${p}", "${c}"]`).join(',\n');
  return `const relationships = [\n${lines}\n];`;
}
