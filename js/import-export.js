/**
 * import-export.js
 * Utilities for importing trees (path-list or legacy indented) and exporting
 * relationship arrays. No DOM side-effects; callers wire these to buttons.
 */

import { makeNode, toRelationships } from './data.js';

const PATH_SEP = ' > ';

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
  return '';
}

function parseNodeLine(line) {
  const segments = line.split('|').map(s => s.trim()).filter(Boolean);
  const name = (segments.shift() || '').trim();
  const meta = {};

  for (const segment of segments) {
    const sep = segment.includes(':') ? ':' : (segment.includes('=') ? '=' : null);
    if (!sep) continue;
    const idx = segment.indexOf(sep);
    const rawKey = segment.slice(0, idx).trim();
    const rawValue = segment.slice(idx + 1).trim();
    const key = canonicalizeKey(rawKey);
    if (!key) continue;

    if (key === 'occupation') meta.occupation = rawValue;
    else if (key === 'occupation2') meta.occupation2 = rawValue;
    else if (key === 'emblem') meta.emblem = parseBool(rawValue);
  }

  return { name, meta };
}

function normalizeMeta(meta) {
  const out = {};
  if (meta && typeof meta === 'object') {
    const occupation = String(meta.occupation || '').trim();
    const occupation2 = String(meta.occupation2 || '').trim();
    if (occupation) out.occupation = occupation;
    if (occupation2) out.occupation2 = occupation2;
    if (meta.emblem) out.emblem = true;
  }
  return out;
}

/**
 * Parse indented text into a root node.
 * Format:
 *   Name | occupation: X | secondOccupation: Y | secondOccupationChild: true
 * Indentation: 2 spaces per level (tabs count as 2 spaces).
 */
export function parseIndentedText(text) {
  const stack = [];
  let root = null;
  let nodeCount = 0;
  let pairCount = 0;
  const occupations = new Set();

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
  };
}

/**
 * Parse and build a root node from text. Auto-detects format:
 *   - Path-list (e.g. "Root > Child > Grandchild") — preferred, copy/paste-safe.
 *   - Legacy indented text (2 spaces per level) — still accepted.
 * Returns { root, nodeCount, pairCount, occupations } or null if not enough content.
 */
export function importFromIndentedText(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return null;

  const looksLikePathList = trimmed
    .split('\n')
    .some(l => {
      const t = l.trim();
      if (!t || t.startsWith('#') || t.startsWith('//')) return false;
      const beforeAttrs = t.split('|')[0];
      return beforeAttrs.includes('>');
    });

  const parsed = looksLikePathList
    ? parsePathList(trimmed)
    : parseIndentedText(trimmed);

  if (!parsed.root || parsed.nodeCount < 2 || parsed.pairCount < 1) return null;
  return parsed;
}

// Tree -> path list (preferred, copy/paste-safe)

function metaSuffix(node) {
  const parts = [];
  const occupation = String(node.meta?.occupation || '').trim();
  const occupation2 = String(node.meta?.occupation2 || '').trim();
  if (occupation) parts.push(`occupation: ${occupation}`);
  if (occupation2) parts.push(`secondOccupation: ${occupation2}`);
  if (node.meta?.emblem) parts.push('secondOccupationChild: true');
  return parts.length ? ' | ' + parts.join(' | ') : '';
}

/**
 * Serialize a root node to a path-list. Each line is the full path from root,
 * parts separated by " > ". Sibling order = order of appearance.
 *
 * This format survives copy/paste through chat apps (no leading whitespace to
 * strip) and is unambiguous for AI models to read and write.
 */
export function exportToIndentedText(root) {
  const lines = [];
  function walk(node, ancestry) {
    const path = ancestry ? ancestry + PATH_SEP + node.name : node.name;
    lines.push(path + metaSuffix(node));
    for (const c of node.children) walk(c, path);
  }
  walk(root, '');

  const header = [
    '# Family tree as path list. Each line is the full path from the root.',
    '# Path parts are separated by " > ". Sibling order = order of appearance.',
    '# Optional attributes after " | ": occupation: X | secondOccupation: Y | secondOccupationChild: true',
    '# Lines starting with # are ignored.',
  ].join('\n');

  return header + '\n\n' + lines.join('\n');
}

/**
 * Parse a path-list back into a tree.
 * Each non-comment line: "A > B > C | optional attrs"
 * Order of lines determines sibling order. Parents are auto-created if a child
 * appears before its parent line, but normal exports always list parents first.
 */
export function parsePathList(text) {
  const nodeByPath = new Map(); // full path string -> node
  let root = null;
  let nodeCount = 0;
  let pairCount = 0;
  const occupations = new Set();

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#') || line.startsWith('//')) continue;

    const pipeIdx = line.indexOf('|');
    const pathStr = (pipeIdx === -1 ? line : line.slice(0, pipeIdx)).trim();
    const attrStr = pipeIdx === -1 ? '' : line.slice(pipeIdx); // includes leading |
    if (!pathStr) continue;

    const parts = pathStr.split('>').map(s => s.trim()).filter(Boolean);
    if (parts.length === 0) continue;

    // Walk/create ancestors so out-of-order lines still work.
    let parentNode = null;
    let parentPath = '';
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const fullPath = parentPath ? parentPath + PATH_SEP + name : name;
      let node = nodeByPath.get(fullPath);
      const isLast = i === parts.length - 1;

      if (!node) {
        node = makeNode(name);
        nodeByPath.set(fullPath, node);
        nodeCount += 1;
        if (parentNode) {
          parentNode.children.push(node);
          pairCount += 1;
        } else if (!root) {
          root = node;
        } else if (root.name !== name) {
          // Multiple roots — attach under existing root to keep one tree.
          root.children.push(node);
          pairCount += 1;
        }
      }

      if (isLast && attrStr) {
        const { meta } = parseNodeLine(name + ' ' + attrStr);
        node.meta = normalizeMeta(meta);
        if (node.meta.occupation) occupations.add(node.meta.occupation);
        if (node.meta.occupation2) occupations.add(node.meta.occupation2);
      }

      parentNode = node;
      parentPath = fullPath;
    }
  }

  return {
    root,
    nodeCount,
    pairCount,
    occupations: [...occupations].sort((a, b) => a.localeCompare(b)),
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
