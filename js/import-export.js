/**
 * import-export.js
 * Utilities for importing indented-text trees and exporting relationship arrays.
 * No DOM side-effects — callers wire these to buttons.
 */

import { fromPairs, toRelationships } from './data.js';

// ── Indented text → tree ──────────────────────────────────────────────────────

/**
 * Parse an indented plain-text tree into relationship pairs.
 * Indentation: 2 spaces per level (tabs count as 2 spaces).
 *
 * Example input:
 *   Founding Father
 *     Starbender Aerion
 *       Starbender Calliothene
 *
 * Returns array of ["parent", "child"] string pairs, or [] if fewer than 2 nodes.
 */
export function parseIndentedText(text) {
  const pairs = [];
  const stack = [];
  for (const raw of text.split('\n')) {
    if (!raw.trim()) continue;
    let indent = 0;
    for (const ch of raw) {
      if (ch === ' ')  indent += 1;
      else if (ch === '\t') indent += 2;
      else break;
    }
    const depth = Math.round(indent / 2);
    const name  = raw.trim();
    while (stack.length > 0 && stack[stack.length - 1].depth >= depth) {
      stack.pop();
    }
    if (stack.length > 0) {
      pairs.push([stack[stack.length - 1].name, name]);
    }
    stack.push({ name, depth });
  }
  return pairs;
}

/**
 * Parse and build a root node from indented text.
 * Returns { root, nodeCount, pairCount } or null if not enough content.
 */
export function importFromIndentedText(text) {
  const trimmed   = (text || '').trim();
  const pairs     = parseIndentedText(trimmed);
  const nodeCount = trimmed.split('\n').filter(l => l.trim()).length;
  if (nodeCount < 2 || !pairs.length) return null;
  return { root: fromPairs(pairs), nodeCount, pairCount: pairs.length };
}

// ── Tree → indented text ──────────────────────────────────────────────────────

/**
 * Serialize a root node back to indented text (2 spaces per level).
 * Includes a header comment describing the format.
 */
export function exportToIndentedText(root) {
  const lines = [];
  function walk(node, depth) {
    lines.push(' '.repeat(depth * 2) + node.name);
    for (const c of node.children) walk(c, depth + 1);
  }
  walk(root, 0);
  const header = 'Indent indicates parent-child relationship. Same indent = siblings.';
  return header + '\n\n' + lines.join('\n');
}

// ── Relationship array export (for pasting into HTML files) ──────────────────

/**
 * Build the `const relationships = [...]` JS snippet used by the legacy HTML chart.
 */
export function exportRelationshipArray(root) {
  const rels  = toRelationships(root);
  const lines = rels.map(([p, c]) => `  ["${p}", "${c}"]`).join(',\n');
  return `const relationships = [\n${lines}\n];`;
}
