/**
 * mutations.js
 * All tree mutation operations and the undo stack.
 *
 * Pattern: every public mutation calls pushUndoState() before modifying,
 * then calls the provided callbacks (render, scheduleUpdate).
 *
 * Callers pass { root, setRoot, sel, setSel, render, scheduleUpdate }
 * as a context object (ctx) so this module stays free of global state.
 */

import { makeNode, find, findParent, serializeNode, deserializeNode,
         getAutoColorMap, getAutoColorIdx, setAutoColorMap, setAutoColorIdx }
  from './data.js';

// ── Undo stack ────────────────────────────────────────────────────────────────

const UNDO_LIMIT = 30;
const _stack = [];

function snapshot(ctx) {
  const extra = typeof ctx.captureExtraState === 'function'
    ? (ctx.captureExtraState() || {})
    : {};
  return {
    tree:     serializeNode(ctx.root()),
    uid:      ctx.uid(),
    sel:      ctx.sel(),
    autoMap:  { ...getAutoColorMap() },
    autoIdx:  getAutoColorIdx(),
    extra,
  };
}

export function pushUndoState(ctx) {
  _stack.push(snapshot(ctx));
  if (_stack.length > UNDO_LIMIT) _stack.shift();
  ctx.onUndoChange(_stack.length);
}

export function doUndo(ctx) {
  if (!_stack.length) return;
  const state = _stack.pop();
  ctx.setRoot(deserializeNode(state.tree));
  ctx.setUid(state.uid);
  ctx.setSel(state.sel);
  setAutoColorMap(state.autoMap || {});
  setAutoColorIdx(state.autoIdx || 0);
  if (typeof ctx.restoreExtraState === 'function') {
    ctx.restoreExtraState(state.extra || {});
  }
  ctx.onUndoChange(_stack.length);
  ctx.render();
  ctx.scheduleUpdate();
}

export function undoDepth() { return _stack.length; }

// ── Mutations ─────────────────────────────────────────────────────────────────

/**
 * Add a child to node `pid`.
 * Returns the new node's id.
 * options.skipRename — if true, don't fire the rename callback.
 */
export function addChild(pid, ctx, options = {}) {
  pushUndoState(ctx);
  const p = find(pid, ctx.root());
  const c = makeNode('New Member');
  p.children.push(c);
  p.collapsed = false;
  ctx.setSel(c.id);
  ctx.render();
  ctx.scheduleUpdate();
  if (!options.skipRename) ctx.onRequestRename(c.id, options.previewInline);
  return c.id;
}

/**
 * Add a sibling after node `id`.
 * Returns the new node's id.
 */
export function addSibling(id, ctx, options = {}) {
  const p = findParent(id, ctx.root());
  if (!p) return null;
  pushUndoState(ctx);
  const idx = p.children.findIndex(c => c.id === id);
  const s = makeNode('New Member');
  p.children.splice(idx + 1, 0, s);
  ctx.setSel(s.id);
  ctx.render();
  ctx.scheduleUpdate();
  if (!options.skipRename) ctx.onRequestRename(s.id, options.previewInline);
  return s.id;
}

/** Delete node `id`. Selects parent after deletion. */
export function deleteNode(id, ctx) {
  const p = findParent(id, ctx.root());
  if (!p) return;
  pushUndoState(ctx);
  p.children = p.children.filter(c => c.id !== id);
  ctx.setSel(p.id);
  ctx.render();
  ctx.scheduleUpdate();
}

/**
 * Rename node `id` to `nextName`.
 * Returns true if the rename was applied.
 */
export function renameNode(id, nextName, ctx) {
  const node = find(id, ctx.root());
  const v = (nextName || '').trim();
  if (!node || !v || v === node.name) return false;
  pushUndoState(ctx);
  node.name = v;
  ctx.setSel(id);
  ctx.render();
  ctx.scheduleUpdate();
  return true;
}

/** Move node `id` up (-1) or down (+1) among its siblings. */
export function moveSibling(id, dir, ctx) {
  const p = findParent(id, ctx.root());
  if (!p) return;
  const idx = p.children.findIndex(c => c.id === id);
  const next = idx + dir;
  if (next < 0 || next >= p.children.length) return;
  pushUndoState(ctx);
  [p.children[idx], p.children[next]] = [p.children[next], p.children[idx]];
  ctx.setSel(id);
  ctx.render();
  ctx.scheduleUpdate();
  ctx.onScrollTo(id);
}

/**
 * Move node `id` to become a child of `nextParentId`.
 * Prevents cycles. Returns true on success.
 */
export function reparentNode(id, nextParentId, ctx) {
  if (id === nextParentId) return false;
  const node       = find(id, ctx.root());
  const oldParent  = findParent(id, ctx.root());
  const nextParent = find(nextParentId, ctx.root());
  if (!node || !oldParent || !nextParent) return false;
  // Prevent cycles: nextParentId must not be a descendant of id
  if (find(nextParentId, node)) return false;
  const oldIdx = oldParent.children.findIndex(c => c.id === id);
  if (oldIdx < 0) return false;
  pushUndoState(ctx);
  oldParent.children.splice(oldIdx, 1);
  nextParent.children.push(node);
  nextParent.collapsed = false;
  ctx.setSel(id);
  ctx.render();
  ctx.scheduleUpdate();
  ctx.onScrollTo(id);
  return true;
}

/**
 * Update arbitrary meta fields on node `id`.
 * Pass a partial object; it is merged into node.meta.
 * Example: updateMeta(id, { occupation: 'The Alchemist' }, ctx)
 */
export function updateMeta(id, patch, ctx) {
  const node = find(id, ctx.root());
  if (!node) return;
  pushUndoState(ctx);
  node.meta = { ...node.meta, ...patch };
  ctx.render();
  ctx.scheduleUpdate();
}

/** Expand or collapse all nodes (recursively). */
export function setAllCollapsed(n, collapsed) {
  n.collapsed = collapsed;
  for (const c of n.children) setAllCollapsed(c, collapsed);
}
