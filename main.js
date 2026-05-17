/**
 * main.js
 * App entry point. Owns mutable state and wires all modules together.
 *
 * State is minimal and explicit:
 *   root          — the root Node
 *   uid           — next node id counter (mutated by makeNode inside mutations)
 *   sel           — currently selected node id (number | null)
 *   editing       — id of node being renamed in the panel (number | null)
 *   cameraState   — last known {x, y, zoom} from the preview iframe
 *   spacing       — current spacing multiplier (1.0–1.7)
 *   hasUnsaved    — whether the tree has unsaved changes
 *   syncCfg       — { gistId, fileName, token }
 */

import {
  makeNode, find, findParent, flatVisible, signOf,
  fromPairs, serializeNode, deserializeNode,
  SEED_PAIRS, uid as liveUid,
} from './js/data.js';

import {
  pushUndoState, doUndo, undoDepth,
  addChild, addSibling, deleteNode, renameNode, moveSibling,
  reparentNode, setAllCollapsed,
} from './js/mutations.js';

import { renderPanel, startPanelRename } from './js/panel.js';
import { buildChartSrcdoc } from './js/preview-builder.js';
import {
  buildSnapshot, applySnapshot,
  saveToLocal, loadFromLocal,
  saveSpacing, loadSpacing,
  loadSyncConfig, saveSyncConfig,
  pushToGist, pullFromGist,
} from './js/storage.js';
import {
  importFromIndentedText,
  exportToIndentedText,
  exportRelationshipArray,
} from './js/import-export.js';

// ── Mutable state ─────────────────────────────────────────────────────────────

let root    = fromPairs(SEED_PAIRS);
let sel     = null;
let editing = null;       // id of node being renamed in panel, or null
let cameraState    = null;
let spacing        = 1.0;
let hasUnsaved     = false;
let syncCfg        = loadSyncConfig();
let pendingPreviewRename = null;  // id to open rename in preview after next render
let occupations = [];
let showOccupationSlips = false;

// ── Context object (passed to mutations) ─────────────────────────────────────
// Mutations use this to access/update state without circular imports.
// `liveUid` is a live ES module binding — it reflects the current value of
// the `uid` let in data.js whenever it's read.

const ctx = {
  root:           () => root,
  setRoot:        (r) => { root = r; },
  uid:            () => liveUid,
  setUid:         (_v) => { /* data.js manages uid internally via makeNode */ },
  sel:            () => sel,
  setSel:         (id) => { sel = id; },
  render:         () => renderAll(),
  scheduleUpdate: () => schedulePreviewUpdate(),
  onUndoChange:   (depth) => updateUndoButton(depth),
  onRequestRename:(id, previewInline) => {
    if (previewInline) {
      pendingPreviewRename = id;
    } else {
      requestAnimationFrame(() => panelStartRename(id));
    }
  },
  onScrollTo:     (id) => scrollTreeTo(id),
  captureExtraState: () => ({
    occupations: [...occupations],
    showOccupationSlips,
  }),
  restoreExtraState: (extra) => {
    occupations = uniqueSortedOccupations(extra.occupations || []);
    showOccupationSlips = !!extra.showOccupationSlips;
    refreshOccSlipButton();
  },
};

// ── DOM refs ──────────────────────────────────────────────────────────────────

const treeEl        = document.getElementById('treeRoot');
const legendEl      = document.getElementById('legend');
const statusEl      = document.getElementById('status');
const previewEl     = document.getElementById('preview');
const panelEl       = document.getElementById('panel');
const bottomToolsEl = document.getElementById('bottomTools');
const saveIndicator = document.getElementById('saveIndicator');
const btnSave       = document.getElementById('btnSave');
const btnUndo       = document.getElementById('btnUndo');
const btnSyncPull   = document.getElementById('btnSyncPull');
const spacingSlider = document.getElementById('spacingSlider');
const spacingValue  = document.getElementById('spacingValue');

// Import/sync DOM refs
const importToggle  = document.getElementById('importToggle');
const importArrow   = document.getElementById('importArrow');
const importBody    = document.getElementById('importBody');
const importInput   = document.getElementById('importInput');
const importStatus  = document.getElementById('importStatus');
const btnImport     = document.getElementById('btnImport');
const syncToggle    = document.getElementById('syncToggle');
const syncArrow     = document.getElementById('syncArrow');
const syncBody      = document.getElementById('syncBody');
const syncStatus    = document.getElementById('syncStatus');
const syncGistId    = document.getElementById('syncGistId');
const syncFileName  = document.getElementById('syncFileName');
const syncToken     = document.getElementById('syncToken');
const btnSyncConfig = document.getElementById('btnSyncConfig');
const btnOccSlips   = document.getElementById('btnOccSlips');
const occToggle     = document.getElementById('occToggle');
const occArrow      = document.getElementById('occArrow');
const occBody       = document.getElementById('occBody');
const occInput      = document.getElementById('occInput');
const btnOccAdd     = document.getElementById('btnOccAdd');
const occSelect     = document.getElementById('occSelect');
const btnOccClear   = document.getElementById('btnOccClear');
const occList       = document.getElementById('occList');

// ── Render ────────────────────────────────────────────────────────────────────

function renderAll() {
  renderPanel(treeEl, legendEl, statusEl, root, sel, {
    onSelect:     (id) => selectNode(id),
    onRename:     (id) => panelStartRename(id),
    onAddChild:   (id) => addChild(id, ctx),
    onAddSibling: (id) => addSibling(id, ctx),
    onDelete:     (id) => deleteNode(id, ctx),
    onMoveUp:     (id) => moveSibling(id, -1, ctx),
    onMoveDown:   (id) => moveSibling(id, +1, ctx),
  });
  renderOccupationUi();
}

// ── Selection ─────────────────────────────────────────────────────────────────

function selectNode(id, opts = {}) {
  sel = id;
  renderAll();
  syncPreviewSelection();
  if (opts.scrollTree && id !== null) scrollTreeTo(id);
}

function scrollTreeTo(id) {
  requestAnimationFrame(() => {
    treeEl.querySelector(`[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest' });
  });
}

// ── Panel rename ──────────────────────────────────────────────────────────────

function panelStartRename(id) {
  editing = id;
  sel     = id;
  syncPreviewSelection();
  const node = find(id, root);
  if (!node) return;

  startPanelRename(
    treeEl, id, node,
    // onCommit
    (id, nextName) => {
      editing = null;
      renameNode(id, nextName, ctx);
      if (!nextName) renderAll(); // re-render even if rename was a no-op
    },
    // onCancel
    () => {
      editing = null;
      renderAll();
      syncPreviewSelection();
    }
  );
}

// ── Preview iframe ────────────────────────────────────────────────────────────

let debounceTimer = null;

function schedulePreviewUpdate() {
  markUnsaved();
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    previewEl.srcdoc = buildChartSrcdoc(root, cameraState, sel, spacing, {
      showOccupationSlips,
      occupations,
    });
  }, 300);
}

function syncPreviewSelection() {
  previewEl.contentWindow?.postMessage({ type: 'select-node', id: sel }, '*');
}

function syncPreviewRename() {
  if (pendingPreviewRename === null) return;
  previewEl.contentWindow?.postMessage({ type: 'start-rename', id: pendingPreviewRename }, '*');
  pendingPreviewRename = null;
}

previewEl.addEventListener('load', () => {
  syncPreviewSelection();
  syncPreviewRename();
});

// Messages from preview iframe
window.addEventListener('message', e => {
  if (!e.data) return;

  if (e.data.type === 'cam') {
    cameraState = e.data.cam;
    return;
  }

  if (e.data.type === 'select-node') {
    const id = e.data.id;
    if (id === null)                          selectNode(null);
    else if (typeof id === 'number' && find(id, root)) selectNode(id, { scrollTree: true });
    return;
  }

  if (e.data.type === 'node-action') {
    const { id, action } = e.data;
    if (typeof id !== 'number' || !find(id, root)) return;

    switch (action) {
      case 'rename':
        selectNode(id, { scrollTree: true });
        if (e.data.inline) { pendingPreviewRename = id; syncPreviewRename(); }
        else panelStartRename(id);
        break;
      case 'rename-commit':
        renameNode(id, e.data.value, ctx);
        break;
      case 'add-child':
        addChild(id, ctx, { previewInline: !!e.data.inline });
        break;
      case 'add-sibling':
        addSibling(id, ctx, { previewInline: !!e.data.inline });
        break;
      case 'move-up':
        moveSibling(id, -1, ctx);
        break;
      case 'move-down':
        moveSibling(id, +1, ctx);
        break;
      case 'delete':
        deleteNode(id, ctx);
        break;
      case 'reparent':
        if (typeof e.data.targetId === 'number') reparentNode(id, e.data.targetId, ctx);
        break;
      case 'set-occupation': {
        const node = find(id, root);
        if (!node) break;
        const next = String(e.data.value || '').trim();
        const prev = String(node.meta?.occupation || '').trim();
        if (next === prev) break;
        pushUndoState(ctx);
        node.meta = { ...node.meta, occupation: next };
        renderAll();
        schedulePreviewUpdate();
        break;
      }
    }
  }
});

// ── Save / load ───────────────────────────────────────────────────────────────

function markUnsaved() {
  hasUnsaved = true;
  saveIndicator.textContent = '● unsaved';
  saveIndicator.classList.add('visible');
  btnSave.classList.remove('saved');
  btnSave.textContent = 'Save';
}

function markSaved() {
  hasUnsaved = false;
  saveIndicator.textContent = 'Saved ✓';
  setTimeout(() => saveIndicator.classList.remove('visible'), 2000);
  btnSave.textContent = 'Saved';
  btnSave.classList.add('saved');
  setTimeout(() => { btnSave.textContent = 'Save'; btnSave.classList.remove('saved'); }, 2000);
}

function setSyncStatus(message, ok) {
  syncStatus.textContent = message;
  syncStatus.className   = `import-status ${ok ? 'ok' : 'err'}`;
}

btnSave.addEventListener('click', async () => {
  const extras = { occupations, showOccupationSlips };
  saveToLocal(root, liveUid, extras);
  if (syncCfg.gistId && syncCfg.token) {
    const result = await pushToGist(syncCfg, root, liveUid, extras);
    if (!result.ok) setSyncStatus(`Cloud save failed${result.status ? ` (${result.status})` : ''}`, false);
    else setSyncStatus('Cloud save complete', true);
  }
  markSaved();
});

btnSyncPull.addEventListener('click', async () => {
  const result = await pullFromGist(syncCfg);
  if (!result.ok) { setSyncStatus(`Pull failed: ${result.error || result.status}`, false); return; }
  const { root: newRoot, occupations: nextOcc = [], showOccupationSlips: nextSlips = false } = applySnapshot(result.data);
  root = newRoot;
  occupations = uniqueSortedOccupations(nextOcc);
  showOccupationSlips = !!nextSlips;
  saveToLocal(root, liveUid, { occupations, showOccupationSlips });
  renderAll();
  schedulePreviewUpdate();
  setSyncStatus('Pulled latest cloud save', true);
});

// ── Undo ──────────────────────────────────────────────────────────────────────

function updateUndoButton(depth) {
  btnUndo.disabled = depth === 0;
}

btnUndo.addEventListener('click', () => doUndo(ctx));

// ── Panel toggle ──────────────────────────────────────────────────────────────

let panelOpen  = true;
let bottomOpen = true;
const btnToggle = document.getElementById('btnToggle');
const btnBottom = document.getElementById('btnBottom');

btnToggle.addEventListener('click', () => {
  panelOpen = !panelOpen;
  panelEl.classList.toggle('collapsed', !panelOpen);
  btnToggle.style.color = panelOpen ? '' : 'var(--accent)';
});

function setBottomOpen(open) {
  bottomOpen = open;
  bottomToolsEl.classList.toggle('collapsed', !open);
  btnBottom.textContent = open ? 'Hide bottom' : 'Show bottom';
}
btnBottom.addEventListener('click', () => setBottomOpen(!bottomOpen));

function refreshOccSlipButton() {
  btnOccSlips.textContent = `Occ slips: ${showOccupationSlips ? 'On' : 'Off'}`;
}

btnOccSlips.addEventListener('click', () => {
  showOccupationSlips = !showOccupationSlips;
  refreshOccSlipButton();
  schedulePreviewUpdate();
});

// ── Expand / collapse all ─────────────────────────────────────────────────────

document.getElementById('btnExp').addEventListener('click', () => {
  pushUndoState(ctx);
  setAllCollapsed(root, false);
  renderAll();
});
document.getElementById('btnCol').addEventListener('click', () => {
  pushUndoState(ctx);
  for (const c of root.children) setAllCollapsed(c, true);
  renderAll();
});

// ── Spacing slider ────────────────────────────────────────────────────────────

function applySpacing(value) {
  spacing = Math.min(1.7, Math.max(1.0, value));
  spacingSlider.value    = spacing.toFixed(1);
  spacingValue.textContent = spacing.toFixed(1) + 'x';
  saveSpacing(spacing);
  schedulePreviewUpdate();
}

spacingSlider.addEventListener('input', e => applySpacing(parseFloat(e.target.value)));

// ── Import (indented text) ────────────────────────────────────────────────────

importToggle.addEventListener('click', () => {
  const open = importBody.classList.toggle('open');
  importArrow.classList.toggle('open', open);
});

importInput.addEventListener('input', () => {
  const text = importInput.value.trim();
  if (!text) {
    importStatus.textContent = '—';
    importStatus.className   = 'import-status';
    btnImport.disabled = true;
    return;
  }
  const result = importFromIndentedText(text);
  if (!result) {
    importStatus.textContent = 'Need at least 2 indented nodes';
    importStatus.className   = 'import-status err';
    btnImport.disabled = true;
  } else {
    importStatus.textContent = `${result.nodeCount} nodes · ${result.pairCount} relationships`;
    importStatus.className   = 'import-status ok';
    btnImport.disabled = false;
  }
});

btnImport.addEventListener('click', () => {
  const result = importFromIndentedText(importInput.value.trim());
  if (!result) return;
  pushUndoState(ctx);
  root = result.root;
  sel  = null;
  importInput.value      = '';
  importStatus.textContent = '—';
  importStatus.className = 'import-status';
  btnImport.disabled = true;
  importBody.classList.remove('open');
  importArrow.classList.remove('open');
  renderAll();
  schedulePreviewUpdate();
});

// ── Export: copy relationship array ──────────────────────────────────────────

document.getElementById('btnCopy').addEventListener('click', () => {
  const text = exportRelationshipArray(root);
  navigator.clipboard.writeText(text).then(() => {
    const b = document.getElementById('btnCopy');
    const prev = b.textContent;
    b.textContent = 'Copied ✓';
    setTimeout(() => b.textContent = prev, 1800);
  });
});

// ── Export: print text (pushes into import pane for easy copy) ───────────────

document.getElementById('btnPrintText').addEventListener('click', () => {
  const text = exportToIndentedText(root);
  importInput.value = text;
  setBottomOpen(true);
  if (!importBody.classList.contains('open')) {
    importBody.classList.add('open');
    importArrow.classList.add('open');
  }
  importInput.dispatchEvent(new Event('input', { bubbles: true }));
  const b = document.getElementById('btnPrintText');
  const prev = b.textContent;
  b.textContent = 'Inserted ✓';
  setTimeout(() => b.textContent = prev, 1500);
});

// ── Cloud sync config ─────────────────────────────────────────────────────────

syncToggle.addEventListener('click', () => {
  const open = syncBody.classList.toggle('open');
  syncArrow.classList.toggle('open', open);
});

btnSyncConfig.addEventListener('click', () => {
  syncCfg = {
    gistId:   (syncGistId.value   || '').trim(),
    fileName: (syncFileName.value || '').trim() || 'cult-chart-save.json',
    token:    (syncToken.value    || '').trim(),
  };
  saveSyncConfig(syncCfg);
  setSyncStatus('Config saved', true);
  // Hydrate fields in case filename was defaulted
  syncFileName.value = syncCfg.fileName;
});

function uniqueSortedOccupations(values) {
  const seen = new Set();
  for (const raw of values || []) {
    const v = String(raw || '').trim();
    if (v) seen.add(v);
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

function traverse(node, fn) {
  fn(node);
  for (const c of node.children) traverse(c, fn);
}

function renderOccupationUi() {
  if (!occSelect || !occList) return;

  occSelect.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = occupations.length ? 'Choose occupation...' : 'No occupations yet';
  occSelect.appendChild(placeholder);

  for (const occ of occupations) {
    const opt = document.createElement('option');
    opt.value = occ;
    opt.textContent = occ;
    occSelect.appendChild(opt);
  }

  const node = sel !== null ? find(sel, root) : null;
  occSelect.disabled = !node || occupations.length === 0;
  btnOccClear.disabled = !node || !node.meta?.occupation;

  if (node?.meta?.occupation && occupations.includes(node.meta.occupation)) {
    occSelect.value = node.meta.occupation;
  } else {
    occSelect.value = '';
  }

  occList.innerHTML = '';
  if (!occupations.length) {
    const empty = document.createElement('div');
    empty.className = 'occ-empty';
    empty.textContent = 'No occupations defined.';
    occList.appendChild(empty);
    return;
  }

  for (const occ of occupations) {
    const row = document.createElement('div');
    row.className = 'occ-item';
    const name = document.createElement('span');
    name.className = 'occ-item-name';
    name.textContent = occ;
    name.title = 'Double-click to rename';
    name.addEventListener('dblclick', () => startOccupationRename(occ, row, name));
    name.addEventListener('click', () => startOccupationRename(occ, row, name));
    name.style.cursor = 'text';
    const edit = document.createElement('button');
    edit.className = 'btn-import';
    edit.textContent = 'Edit';
    edit.addEventListener('click', () => startOccupationRename(occ, row, name));
    const del = document.createElement('button');
    del.className = 'btn-import';
    del.textContent = 'Delete';
    del.addEventListener('click', () => deleteOccupation(occ));
    row.appendChild(name);
    row.appendChild(edit);
    row.appendChild(del);
    occList.appendChild(row);
  }
}

function startOccupationRename(oldValue, row, labelEl) {
  const input = document.createElement('input');
  input.className = 'import-textarea occ-input';
  input.value = oldValue;
  input.style.height = '30px';
  input.style.padding = '4px 8px';
  row.replaceChild(input, labelEl);
  input.focus();
  input.select();

  const commit = () => {
    const nextValue = (input.value || '').trim();
    renameOccupation(oldValue, nextValue);
  };
  const cancel = () => renderOccupationUi();

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  });
}

function addOccupation() {
  const value = (occInput.value || '').trim();
  if (!value || occupations.includes(value)) return;
  occupations = uniqueSortedOccupations([...occupations, value]);
  occInput.value = '';
  renderOccupationUi();
  schedulePreviewUpdate();
}

function deleteOccupation(occupation) {
  if (!occupations.includes(occupation)) return;
  pushUndoState(ctx);
  occupations = occupations.filter(v => v !== occupation);
  traverse(root, node => {
    if (node.meta?.occupation === occupation) {
      node.meta = { ...node.meta, occupation: '' };
    }
  });
  renderAll();
  schedulePreviewUpdate();
}

function renameOccupation(oldValue, nextValue) {
  const prev = (oldValue || '').trim();
  const next = (nextValue || '').trim();
  if (!prev) {
    renderOccupationUi();
    return;
  }
  if (!next || next === prev) {
    renderOccupationUi();
    return;
  }
  if (occupations.includes(next)) {
    renderOccupationUi();
    return;
  }

  pushUndoState(ctx);
  occupations = occupations.map(v => (v === prev ? next : v));
  occupations = uniqueSortedOccupations(occupations);
  traverse(root, node => {
    if (node.meta?.occupation === prev) {
      node.meta = { ...node.meta, occupation: next };
    }
  });
  renderAll();
  schedulePreviewUpdate();
}

occToggle.addEventListener('click', () => {
  const open = occBody.classList.toggle('open');
  occArrow.classList.toggle('open', open);
});

btnOccAdd.addEventListener('click', addOccupation);
occInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    e.preventDefault();
    addOccupation();
  }
});

occSelect.addEventListener('change', () => {
  if (sel === null) return;
  const node = find(sel, root);
  if (!node) return;
  const next = occSelect.value;
  const prev = node.meta?.occupation || '';
  if (next === prev) return;
  pushUndoState(ctx);
  node.meta = { ...node.meta, occupation: next };
  renderAll();
  schedulePreviewUpdate();
});

btnOccClear.addEventListener('click', () => {
  if (sel === null) return;
  const node = find(sel, root);
  if (!node || !node.meta?.occupation) return;
  pushUndoState(ctx);
  node.meta = { ...node.meta, occupation: '' };
  renderAll();
  schedulePreviewUpdate();
});

function hydrateSyncUi(cfg) {
  syncGistId.value   = cfg.gistId   || '';
  syncFileName.value = cfg.fileName || 'cult-chart-save.json';
  syncToken.value    = cfg.token    || '';
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────────

document.addEventListener('keydown', e => {
  // Undo: Ctrl/Cmd+Z
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    doUndo(ctx);
    return;
  }

  // Don't intercept shortcuts while a panel rename input is active
  if (editing !== null) return;
  if (!sel)             return;

  if (e.key === 'Tab') {
    e.preventDefault();
    addChild(sel, ctx);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const p = findParent(sel, root);
    if (p) addSibling(sel, ctx);
    else   addChild(sel, ctx);
  } else if (e.key === 'F2') {
    e.preventDefault();
    panelStartRename(sel);
  } else if (e.key === ' ') {
    e.preventDefault();
    const node = find(sel, root);
    if (node?.children.length) {
      node.collapsed = !node.collapsed;
      renderAll();
    }
  } else if (e.key === 'Delete') {
    const parent = findParent(sel, root);
    if (parent) { e.preventDefault(); deleteNode(sel, ctx); }
  } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.shiftKey) {
    e.preventDefault();
    const parent = findParent(sel, root);
    if (parent) moveSibling(sel, e.key === 'ArrowUp' ? -1 : 1, ctx);
  } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault();
    const flat = flatVisible(root);
    const i    = flat.findIndex(n => n.id === sel);
    const next = flat[i + (e.key === 'ArrowDown' ? 1 : -1)];
    if (next) selectNode(next.id, { scrollTree: true });
  }
});

// ── Init ──────────────────────────────────────────────────────────────────────

(function init() {
  // Load saved tree (or keep seed)
  const saved = loadFromLocal();
  if (saved) {
    root = saved.root;
    occupations = uniqueSortedOccupations(saved.occupations || []);
    showOccupationSlips = !!saved.showOccupationSlips;
  }

  // Load spacing preference
  spacing = loadSpacing(1.0);
  spacingSlider.value      = spacing.toFixed(1);
  spacingValue.textContent = spacing.toFixed(1) + 'x';

  // Populate sync UI
  hydrateSyncUi(syncCfg);

  // Initial render
  refreshOccSlipButton();
  renderAll();
  schedulePreviewUpdate();

  // Mark clean (no unsaved changes at startup)
  hasUnsaved = false;
  saveIndicator.classList.remove('visible');
  btnSave.textContent = 'Save';
  updateUndoButton(0);

  // Auto-pull from cloud if configured
  if (syncCfg.gistId) {
    pullFromGist(syncCfg).then(result => {
      if (!result.ok) return;
      const { root: newRoot, occupations: nextOcc = [], showOccupationSlips: nextSlips = false } = applySnapshot(result.data);
      root = newRoot;
      occupations = uniqueSortedOccupations(nextOcc);
      showOccupationSlips = !!nextSlips;
      refreshOccSlipButton();
      saveToLocal(root, liveUid, { occupations, showOccupationSlips });
      renderAll();
      schedulePreviewUpdate();
    });
  }
})();
