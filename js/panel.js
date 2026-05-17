/**
 * panel.js
 * Renders the left-panel member tree and the sign legend.
 * Pure DOM operations — no state mutations happen here.
 * All user actions fire callbacks passed in via PanelCallbacks.
 *
 * @typedef PanelCallbacks
 * @property {Function} onSelect      (id) → void
 * @property {Function} onRename      (id) → void   (opens inline rename input)
 * @property {Function} onAddChild    (id) → void
 * @property {Function} onAddSibling  (id) → void
 * @property {Function} onDelete      (id) → void
 * @property {Function} onMoveUp      (id) → void
 * @property {Function} onMoveDown    (id) → void
 */

import { find, findParent, countAll, toRelationships, signOf, flatVisible, colorForNode }
  from './data.js';

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Re-render the full panel tree into `treeEl`.
 * @param {HTMLElement} treeEl
 * @param {HTMLElement} legendEl
 * @param {HTMLElement} statusEl
 * @param {Object}      root         — root node
 * @param {number|null} selectedId
 * @param {PanelCallbacks} cb
 */
export function renderPanel(treeEl, legendEl, statusEl, root, selectedId, cb) {
  treeEl.innerHTML = '';
  _renderNode(treeEl, root, [], true, root, selectedId, cb);
  _renderLegend(legendEl, root);
  const memberCount = countAll(root) - 1; // exclude Founding Father
  const relCount    = toRelationships(root).length;
  statusEl.textContent = `${memberCount} members · ${relCount} relationships`;
}

// ── Internal: tree rows ───────────────────────────────────────────────────────

function _renderNode(treeEl, node, parentBits, isLast, root, selectedId, cb) {
  const depth = parentBits.length;

  const row = document.createElement('div');
  row.className = 'tree-row' + (node.id === selectedId ? ' selected' : '');
  row.dataset.id = node.id;

  // Indentation guides
  if (depth === 0) {
    const sp = document.createElement('div');
    sp.style.cssText = 'flex-shrink:0;width:8px;';
    row.appendChild(sp);
  } else {
    for (let i = 0; i < depth - 1; i++) {
      const vl = document.createElement('div');
      vl.className = 'vline' + (parentBits[i] ? ' continues' : '');
      row.appendChild(vl);
    }
    const conn = document.createElement('div');
    conn.className = 'connector' + (isLast ? '' : ' not-last');
    row.appendChild(conn);
  }

  // Expand/collapse toggle
  const tog = document.createElement('div');
  const hasChildren = node.children.length > 0;
  tog.className = 'toggle' + (hasChildren ? '' : ' leaf');
  tog.textContent = hasChildren ? (node.collapsed ? '+' : '−') : '·';
  tog.addEventListener('click', e => {
    e.stopPropagation();
    if (hasChildren) {
      node.collapsed = !node.collapsed;
      renderPanel(treeEl, null, null, root, selectedId, cb); // partial re-render ok
    }
  });
  row.appendChild(tog);

  // Sign color dot
  const dot = document.createElement('div');
  dot.className = 'sign-dot';
  dot.style.background = colorForNode(node.name);
  row.appendChild(dot);

  // Label
  const lbl = document.createElement('div');
  lbl.className = 'node-label' + (depth === 0 ? ' root-lbl' : '');
  lbl.textContent = node.name;
  row.appendChild(lbl);

  // Action buttons (revealed on hover / always on touch)
  row.appendChild(_makeRowActions(node, depth, root, cb));

  // Events
  row.addEventListener('click',    () => cb.onSelect(node.id));
  row.addEventListener('dblclick', e  => { e.stopPropagation(); cb.onRename(node.id); });

  treeEl.appendChild(row);

  // Recurse into children
  if (!node.collapsed) {
    for (let i = 0; i < node.children.length; i++) {
      const last = i === node.children.length - 1;
      _renderNode(treeEl, node.children[i], [...parentBits, !last], last, root, selectedId, cb);
    }
  }
}

function _makeRowActions(node, depth, root, cb) {
  const acts = document.createElement('div');
  acts.className = 'row-actions';

  if (depth > 0) {
    const parent = findParent(node.id, root);
    const idx    = parent ? parent.children.findIndex(c => c.id === node.id) : -1;

    const bUp = _mkRowBtn('▲', 'Move up', () => cb.onMoveUp(node.id));
    bUp.classList.add('reorder');
    if (idx === 0) bUp.classList.add('disabled');
    acts.appendChild(bUp);

    const bDn = _mkRowBtn('▼', 'Move down', () => cb.onMoveDown(node.id));
    bDn.classList.add('reorder');
    if (!parent || idx === parent.children.length - 1) bDn.classList.add('disabled');
    acts.appendChild(bDn);

    acts.appendChild(_mkRowBtn('↔', 'Add sibling', () => cb.onAddSibling(node.id)));
  }

  acts.appendChild(_mkRowBtn('+', 'Add child (Tab)', () => cb.onAddChild(node.id)));
  acts.appendChild(_mkRowBtn('✎', 'Rename (F2)',     () => cb.onRename(node.id)));

  if (depth > 0) {
    const bd = _mkRowBtn('×', 'Delete', () => cb.onDelete(node.id));
    bd.classList.add('del');
    acts.appendChild(bd);
  }

  return acts;
}

function _mkRowBtn(text, title, onClick) {
  const b = document.createElement('button');
  b.className = 'row-btn';
  b.textContent = text;
  b.title = title;
  b.addEventListener('click', e => { e.stopPropagation(); onClick(); });
  return b;
}

// ── Internal: legend ──────────────────────────────────────────────────────────

function _renderLegend(legendEl, root) {
  if (!legendEl) return;
  legendEl.innerHTML = '';
  const seen = new Set();
  function collect(n) {
    const s = signOf(n.name);
    if (!seen.has(s)) {
      seen.add(s);
      const item = document.createElement('div');
      item.className = 'legend-item';
      const d = document.createElement('div');
      d.className = 'legend-dot';
      d.style.background = colorForNode(n.name);
      const lbl = document.createElement('span');
      lbl.textContent = s;
      item.appendChild(d);
      item.appendChild(lbl);
      legendEl.appendChild(item);
    }
    for (const c of n.children) collect(c);
  }
  collect(root);
}

// ── Inline rename (panel-side) ────────────────────────────────────────────────

/**
 * Replace the label in the tree row for `id` with an editable input.
 * onCommit(id, newName) fires when Enter/blur occurs.
 * onCancel()           fires on Escape.
 */
export function startPanelRename(treeEl, id, node, onCommit, onCancel) {
  const row = treeEl.querySelector(`[data-id="${id}"]`);
  if (!row) return;
  const lbl     = row.querySelector('.node-label');
  const oldName = node.name;

  const inp = document.createElement('input');
  inp.className   = 'node-input';
  inp.value       = oldName;
  inp.spellcheck  = false;
  lbl.replaceWith(inp);
  inp.focus();
  inp.select();

  function commit() {
    onCommit(id, inp.value.trim());
  }

  inp.addEventListener('blur', commit);
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); e.stopPropagation(); commit(); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel(); }
  });
}
