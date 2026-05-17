/**
 * import-export.js
 * Utilities for importing indented-text trees and exporting relationship arrays.
 * No DOM side-effects; callers wire these to buttons.
 */

import { makeNode, toRelationships } from './data.js';

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
 * Parse and build a root node from indented text.
 * Returns { root, nodeCount, pairCount, occupations } or null if not enough content.
 */
export function importFromIndentedText(text) {
  const trimmed = (text || '').trim();
  const parsed = parseIndentedText(trimmed);
  if (!parsed.root || parsed.nodeCount < 2 || parsed.pairCount < 1) return null;
  return parsed;
}

// Tree -> indented text

/**
 * Serialize a root node back to indented text (2 spaces per level).
 */
export function exportToIndentedText(root) {
  function metaSuffix(node) {
    const parts = [];
    const occupation = String(node.meta?.occupation || '').trim();
    const occupation2 = String(node.meta?.occupation2 || '').trim();
    if (occupation) parts.push(`occupation: ${occupation}`);
    if (occupation2) parts.push(`secondOccupation: ${occupation2}`);
    if (node.meta?.emblem) parts.push('secondOccupationChild: true');
    return parts.length ? ' | ' + parts.join(' | ') : '';
  }

  const lines = [];
  function walk(node, depth) {
    lines.push(' '.repeat(depth * 2) + node.name + metaSuffix(node));
    for (const c of node.children) walk(c, depth + 1);
  }

  walk(root, 0);

  const header = [
    '# Indent indicates parent-child relationship. Same indent = siblings.',
    '# Optional attributes per line: | occupation: ... | secondOccupation: ... | secondOccupationChild: true|false',
  ].join('\n');

  return header + '\n\n' + lines.join('\n');
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
