/**
 * preview-builder.js
 * Builds the srcdoc HTML string for the chart preview iframe.
 *
 * Separated from everything else so that:
 *   (a) It can be reasoned about independently.
 *   (b) Card layout changes (adding occupation field, rebirth styling)
 *       only touch this file.
 *
 * The generated document uses postMessage to communicate back:
 *   { type: 'cam',         cam: {x, y, zoom} }
 *   { type: 'select-node', id: number | null }
 *   { type: 'node-action', id, action, ...extras }
 *
 * And it receives:
 *   { type: 'select-node', id }
 *   { type: 'start-rename', id }
 */

import { serializeNode, allColorMap, knownSigns, SECOND_OCC_CHILD_TERM } from './data.js';

// ── Card layout constants ─────────────────────────────────────────────────────
// These are exposed so tests or callers can override without touching the template.

export const CARD = {
  baseWidth:  190,   // px at 1x spacing multiplier
  baseHeight: 100,   // px at 1x
  baseFontSz: 16,    // px at 1x (scales with spacing multiplier)
};

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Build and return the full srcdoc string.
 *
 * @param {object}      rootNode        — serialized (plain-object) root node
 * @param {object|null} cameraState     — {x, y, zoom} or null for auto-center
 * @param {number|null} selectedId
 * @param {number}      spacingMult     — 1.0–1.7
 */
export function buildChartSrcdoc(rootNode, cameraState, selectedId, spacingMult = 1.0, options = {}) {
  const colorMap  = allColorMap();
  const camJSON   = cameraState ? JSON.stringify(cameraState) : 'null';
  const selJSON   = typeof selectedId === 'number' ? JSON.stringify(selectedId) : 'null';
  const occJSON   = JSON.stringify({
    showOccupationSlips: !!options.showOccupationSlips,
    occupations: Array.isArray(options.occupations) ? options.occupations : [],
    knownSigns: knownSigns(rootNode),
    rootId: rootNode?.id ?? null,
    symbolTerms: Array.isArray(options.symbolTerms) ? options.symbolTerms : [],
    hiddenSymbols: Array.isArray(options.hiddenSymbols) ? options.hiddenSymbols : [],
    highlightSymbols: Array.isArray(options.highlightSymbols) ? options.highlightSymbols : [],
    secondOccChildTerm: SECOND_OCC_CHILD_TERM,
    pickerOpenId: typeof options.pickerOpenId === 'number' ? options.pickerOpenId : null,
  });
  const smClamped = Math.min(1.7, Math.max(1.0, spacingMult));

  // We pass the full tree (not just pairs) so the preview can access meta fields.
  const treeJSON  = JSON.stringify(serializeNode(rootNode));

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
${_buildPreviewCSS(smClamped)}
</style></head><body>
<div id="scene"><div id="world"><svg id="edges"></svg><div id="nodesLayer"></div></div></div>
<script>
const PREVIEW_OPTIONS=${occJSON};
${_buildPreviewScript(treeJSON, camJSON, selJSON, smClamped, colorMap)}
<\/script></body></html>`;
}

// ── CSS generation ────────────────────────────────────────────────────────────

function _buildPreviewCSS(sm) {
  const nodeW  = Math.round(CARD.baseWidth  * sm);
  const nodeH  = Math.round(CARD.baseHeight * sm);
  const fontSz = Math.round(CARD.baseFontSz * sm);
  const slipFont = Math.max(12, Math.round(fontSz * 0.78));
  const btnSz  = Math.round(28 * sm);
  const btnFnt = Math.max(13, Math.round(13 * sm));
  const actGap = Math.round(6 * sm);
  const actPad = `${Math.round(6 * sm)}px ${Math.round(8 * sm)}px`;

  // Sign colors injected as CSS classes
  const colorCSS = Object.entries(allColorMap())
    .map(([k, v]) => `.${k}{background:${v}}`)
    .join('');

  return `
*{box-sizing:border-box}
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#eef3fb;
  font-family:Arial,sans-serif;user-select:none;-webkit-user-select:none;
  text-rendering:geometricPrecision;-webkit-font-smoothing:antialiased}
#scene{position:relative;width:100vw;height:100vh;overflow:hidden;cursor:grab;touch-action:none}
#scene.dragging{cursor:grabbing}
#world{position:absolute;left:0;top:0;transform-origin:0 0;
  will-change:transform;backface-visibility:hidden;-webkit-backface-visibility:hidden}
svg{position:absolute;inset:0;overflow:visible;pointer-events:none;z-index:1}
#nodesLayer{position:absolute;left:0;top:0;z-index:2}

/* ── Node card ── */
.node-wrap{position:absolute;transform:translateX(-50%);
  display:flex;flex-direction:column;align-items:center;gap:12px;z-index:1}
.node-wrap.selected{z-index:2500}
.node{
  position:relative;
  width:${nodeW}px;
  min-height:${nodeH}px;
  padding:10px;
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  text-align:center;
  /* Name text */
  font-size:${fontSz}px;font-weight:800;line-height:1.1;
  border-radius:4px;border:1px solid rgba(0,0,0,.28);
  box-shadow:0 1px 2px rgba(0,0,0,.08);
  text-shadow:0 1px 2px rgba(0,0,0,.18);
  contain:layout style paint;cursor:pointer}
.node.selected{outline:3px solid rgba(212,168,76,.9);outline-offset:4px;
  box-shadow:0 0 0 1px rgba(255,255,255,.28),0 8px 24px rgba(0,0,0,.22)}
.node.drag-source{outline:3px solid rgba(244,208,120,.95);outline-offset:5px;
  box-shadow:0 0 0 2px rgba(255,255,255,.38),0 12px 26px rgba(0,0,0,.3)}
.node.drop-target{outline:3px solid rgba(34,197,94,.95);outline-offset:5px;
  box-shadow:0 0 0 2px rgba(255,255,255,.42),0 12px 26px rgba(0,0,0,.28)}
.node.node-highlight{
  transform:scale(1.12);
  transform-origin:center center;
  border-color:rgba(255,210,90,.95);
  contain:none;
  position:relative;
  z-index:1}
.node-wrap.has-highlight{
  z-index:50;
  overflow:visible}
.node-wrap.has-highlight::before{
  content:"";
  position:absolute;
  left:50%;top:${Math.round(nodeH * 0.5)}px;
  width:${Math.round(nodeW * 1.22)}px;
  height:${Math.round(nodeH * 1.55)}px;
  transform:translate(-50%,-50%);
  background:rgba(255,196,70,.95);
  border:2px solid rgba(255,210,90,1);
  border-radius:6px;
  z-index:0;
  pointer-events:none}

/* ── Occupation sub-label (upcoming field — hidden until meta.occupation is set) ── */
.occupation-slip{
  display:none;
  min-width:${Math.round(nodeW * 0.92)}px;
  max-width:${Math.round(nodeW * 1.22)}px;
  padding:${Math.max(8, Math.round(sm * 9))}px ${Math.max(12, Math.round(sm * 14))}px;
  border:2px solid rgba(0,0,0,.28);
  border-top:none;
  border-radius:0 0 8px 8px;
  background:rgba(255,252,242,.98);
  color:#2a251f;
  font-size:${slipFont}px;
  font-weight:800;
  text-align:center;
  line-height:1.28;
  letter-spacing:0.02em;
  box-shadow:0 4px 12px rgba(0,0,0,.2);
  cursor:pointer;
}
.occupation-slip.visible{display:block}
.occupation-slip.visible:hover{filter:brightness(1.08)}

/* ── Rebirth badge (upcoming — hidden until meta.reborn is set) ── */
.rebirth-badge{
  display:none;
  position:absolute;top:4px;right:6px;
  font-size:9px;font-weight:700;letter-spacing:0.08em;
  color:rgba(255,255,255,0.55);
  pointer-events:none;
}
.rebirth-badge.visible{display:block}

.double-occupation-badge,
.sym-badge{
  display:none;
  position:absolute;
  width:var(--symbol-size,24px);
  height:var(--symbol-size,24px);
  align-items:center;
  justify-content:center;
  pointer-events:none;
  font-size:calc(var(--symbol-size,24px) * 0.55);
  font-weight:700;
  line-height:1;
  color:currentColor;
  border-radius:50%;
  background:rgba(0,0,0,0.12);
  white-space:nowrap;
}
.double-occupation-badge{
  top:8px;right:8px;
}
.double-occupation-badge.visible,
.sym-badge.visible{display:flex}

/* ── Action bar ── */
.node-actions{display:none;align-items:center;gap:${actGap}px;
  padding:${actPad};border-radius:999px;
  background:rgba(19,17,16,.92);box-shadow:0 10px 24px rgba(0,0,0,.22);position:relative;z-index:2600}
.node-wrap.selected .node-actions{display:flex}
.node-btn{width:${btnSz}px;height:${btnSz}px;border:none;border-radius:999px;
  background:rgba(255,255,255,.08);color:#f3ead9;
  font:700 ${btnFnt}px/1 Arial,sans-serif;
  display:flex;align-items:center;justify-content:center;cursor:pointer}
.node-btn:hover,.node-btn:active{background:rgba(212,168,76,.22);color:#f6d183}
.node-btn.disabled{opacity:.38;pointer-events:none}
.node-input,
.node-occ-select,
.node-inline-editor{
  width:${Math.round(nodeW * 1.08)}px;
  min-height:${Math.max(44, Math.round(48 * sm))}px;
  padding:${Math.max(10, Math.round(10 * sm))}px ${Math.max(12, Math.round(12 * sm))}px;
  border-radius:8px;
  background:rgba(24,22,20,.96);
  color:#f0e5cf;
  font:700 ${Math.max(14, Math.round(14 * sm))}px/1.15 Arial,sans-serif;
  text-align:center;
  outline:none;
  box-shadow:0 12px 26px rgba(0,0,0,.34);
  position:relative;
  z-index:2550;
  transform-origin:bottom center;
}
.node-input{border:2px solid rgba(212,168,76,.92);}
.node-occ-select{border:2px solid rgba(212,168,76,.72);}

/* Split rename: sign <select> + name <input>, inside one wrapper sized like .node-inline-editor. */
.node-rename-split{
  width:${Math.round(nodeW * 1.65)}px;
  display:flex;
  gap:${Math.max(6, Math.round(6 * sm))}px;
  align-items:stretch;
  position:relative;
  z-index:2550;
  transform-origin:bottom center;
}
.node-rename-split .rs-sign,
.node-rename-split .rs-rest,
.node-rename-split .rs-sign-text{
  min-height:${Math.max(44, Math.round(48 * sm))}px;
  padding:${Math.max(8, Math.round(8 * sm))}px ${Math.max(10, Math.round(10 * sm))}px;
  border-radius:8px;
  background:rgba(24,22,20,.96);
  color:#f0e5cf;
  font:700 ${Math.max(14, Math.round(14 * sm))}px/1.15 Arial,sans-serif;
  outline:none;
  box-shadow:0 12px 26px rgba(0,0,0,.34);
  border:2px solid rgba(212,168,76,.72);
  text-align:center;
}
.node-rename-split .rs-sign{flex:1 1 50%;min-width:0;}
.node-rename-split .rs-sign-text{flex:1 1 50%;min-width:0;}
.node-rename-split .rs-rest{flex:1 1 50%;min-width:0;border-color:rgba(212,168,76,.92);}
.node-rename-split .rs-sign option{background:#1e1b18;color:#f0e5cf;}

/* Symbol picker editor (opens when the symbol action button is clicked). */
.node-sym-picker{
  width:${Math.round(nodeW * 1.65)}px;
  display:flex;
  flex-direction:column;
  gap:${Math.max(6, Math.round(6 * sm))}px;
  padding:${Math.max(10, Math.round(10 * sm))}px;
  border-radius:10px;
  background:rgba(24,22,20,.98);
  color:#f0e5cf;
  border:2px solid rgba(212,168,76,.72);
  box-shadow:0 12px 26px rgba(0,0,0,.34);
  position:relative;
  z-index:2550;
  transform-origin:bottom center;
}
.node-sym-picker .sym-chips{
  display:flex;flex-wrap:wrap;gap:${Math.max(4, Math.round(5 * sm))}px;
  max-height:${Math.round(180 * sm)}px;overflow-y:auto;
  justify-content:center;
}
.node-sym-picker .sym-chip{
  border:1px solid rgba(212,168,76,.5);
  background:rgba(255,255,255,.05);
  color:#f0e5cf;
  border-radius:999px;
  padding:${Math.max(6, Math.round(6 * sm))}px ${Math.max(10, Math.round(10 * sm))}px;
  font:700 ${Math.max(13, Math.round(13 * sm))}px/1 Arial,sans-serif;
  cursor:pointer;
}
.node-sym-picker .sym-chip.on{
  background:rgba(212,168,76,.85);
  color:#1b1110;
  border-color:rgba(212,168,76,.95);
}
.node-sym-picker .sym-chip.disabled{
  opacity:0.4;
  cursor:not-allowed;
}
.node-sym-picker .sym-empty{
  text-align:center;
  font:700 ${Math.max(12, Math.round(12 * sm))}px/1.2 Arial,sans-serif;
  opacity:0.7;
  padding:4px 0;
}
.node-sym-picker .sym-add-row{
  display:flex;gap:6px;align-items:center;
}
.node-sym-picker .sym-add-input{
  flex:1 1 auto;
  min-width:0;
  background:rgba(0,0,0,.35);
  color:#f0e5cf;
  border:1px solid rgba(212,168,76,.55);
  border-radius:6px;
  padding:${Math.max(6, Math.round(6 * sm))}px ${Math.max(8, Math.round(8 * sm))}px;
  font:700 ${Math.max(13, Math.round(13 * sm))}px/1.15 Arial,sans-serif;
  outline:none;
}
.node-sym-picker .sym-add-btn,
.node-sym-picker .sym-done-btn{
  background:rgba(212,168,76,.85);
  color:#1b1110;
  border:none;
  border-radius:6px;
  padding:${Math.max(6, Math.round(6 * sm))}px ${Math.max(10, Math.round(10 * sm))}px;
  font:700 ${Math.max(13, Math.round(13 * sm))}px/1 Arial,sans-serif;
  cursor:pointer;
}
.node-sym-picker .sym-chip-x{
  margin-left:6px;
  opacity:0.7;
  font-weight:900;
}
.node-sym-picker .sym-chip-x:hover{opacity:1;}
.node-occ-select option{
  background:#1e1b18;
  color:#f0e5cf;
}

/* ── Touch overrides ── */
@media (pointer:coarse){
  .node-actions{gap:${Math.round(6*sm)}px;padding:${Math.round(6*sm)}px ${Math.round(8*sm)}px}
  .node-btn{width:${Math.round(36*sm)}px;height:${Math.round(36*sm)}px;
    font-size:${Math.max(15,Math.round(15*sm))}px}
  .node-input,.node-occ-select,.node-inline-editor,.node-rename-split .rs-sign,.node-rename-split .rs-rest,.node-rename-split .rs-sign-text{font-size:16px;min-height:${Math.max(44, Math.round(42 * sm))}px;padding:10px 12px}
  .node-sym-picker .sym-add-input,.node-sym-picker .sym-add-btn,.node-sym-picker .sym-done-btn,.node-sym-picker .sym-chip{font-size:16px}
  .node-rename-split, .node-sym-picker{max-width: 88vw;}
}
@media screen and (max-width:1024px){
  .node-actions{gap:${Math.round(7*sm)}px;padding:${Math.round(7*sm)}px ${Math.round(9*sm)}px}
  .node-btn{width:${Math.round(38*sm)}px;height:${Math.round(38*sm)}px;
    font-size:${Math.max(16,Math.round(16*sm))}px}
  .node-input,.node-occ-select,.node-inline-editor,.node-rename-split .rs-sign,.node-rename-split .rs-rest,.node-rename-split .rs-sign-text{font-size:16px;min-height:${Math.max(48, Math.round(46 * sm))}px;padding:10px 12px}
  .node-sym-picker .sym-add-input,.node-sym-picker .sym-add-btn,.node-sym-picker .sym-done-btn,.node-sym-picker .sym-chip{font-size:16px}
  .node-rename-split, .node-sym-picker{max-width: 88vw;}
}
@media screen and (max-width:767px){
  .node-actions{gap:${Math.round(4*sm)}px;padding:${Math.round(4*sm)}px ${Math.round(6*sm)}px}
  .node-btn{width:${Math.round(30*sm)}px;height:${Math.round(30*sm)}px;
    font-size:${Math.max(14,Math.round(14*sm))}px}
  .node-input,.node-occ-select,.node-inline-editor,.node-rename-split .rs-sign,.node-rename-split .rs-rest,.node-rename-split .rs-sign-text{min-height:${Math.max(40, Math.round(38 * sm))}px;padding:8px 10px}
  .node-rename-split, .node-sym-picker{max-width: 95vw;}
}
${colorCSS}`;
}

// ── Script generation ─────────────────────────────────────────────────────────

function _buildPreviewScript(treeJSON, camJSON, selJSON, sm, colorMap) {
  const smClamped = Math.min(1.7, Math.max(1.0, sm));

  // Layout constants (mirrored inside the iframe script)
  const nodeW   = Math.round(CARD.baseWidth  * smClamped);
  const nodeH   = Math.round(CARD.baseHeight * smClamped);
  const t       = (smClamped - 1) / 0.7;
  const gapX    = Math.max(Math.round(280 * (1 + t * 0.45)), nodeW + 44);
  const gapY    = Math.round(170 + Math.pow(t, 1.05) * 120);
  const branchG = Math.max(24, Math.min(58, Math.round(gapY * 0.34)));

  const colorMapJSON = JSON.stringify(colorMap);

  // The script body is a self-contained IIFE injected into the iframe.
  // It reads TREE (serialized node tree) and renders the chart.
  // ─────────────────────────────────────────────────────────────────
  // NOTE: When adding the occupation field or rebirth highlighting,
  // update _buildCard() below — that is the only function that touches
  // per-node DOM structure.
  return `
(function(){
const TREE=${treeJSON};
const INIT_CAM=${camJSON};
const INIT_SEL=${selJSON};
const SHOW_OCCUPATION_SLIPS=(typeof PREVIEW_OPTIONS==='object' && !!PREVIEW_OPTIONS.showOccupationSlips);
const OCCUPATION_OPTIONS=(typeof PREVIEW_OPTIONS==='object' && Array.isArray(PREVIEW_OPTIONS.occupations))
  ? PREVIEW_OPTIONS.occupations.filter(v=>typeof v==='string')
  : [];
const KNOWN_SIGNS=(typeof PREVIEW_OPTIONS==='object' && Array.isArray(PREVIEW_OPTIONS.knownSigns))
  ? PREVIEW_OPTIONS.knownSigns.filter(v=>typeof v==='string')
  : [];
const ROOT_ID=(typeof PREVIEW_OPTIONS==='object' && typeof PREVIEW_OPTIONS.rootId==='number')
  ? PREVIEW_OPTIONS.rootId
  : null;
const SYMBOL_TERMS=(typeof PREVIEW_OPTIONS==='object' && Array.isArray(PREVIEW_OPTIONS.symbolTerms))
  ? PREVIEW_OPTIONS.symbolTerms.filter(v=>typeof v==='string')
  : [];
const HIDDEN_SYMBOLS=new Set(
  (typeof PREVIEW_OPTIONS==='object' && Array.isArray(PREVIEW_OPTIONS.hiddenSymbols))
    ? PREVIEW_OPTIONS.hiddenSymbols.filter(v=>typeof v==='string').map(v=>v.toLowerCase())
    : []
);
const HIGHLIGHT_SYMBOLS=new Set(
  (typeof PREVIEW_OPTIONS==='object' && Array.isArray(PREVIEW_OPTIONS.highlightSymbols))
    ? PREVIEW_OPTIONS.highlightSymbols.filter(v=>typeof v==='string').map(v=>v.toLowerCase())
    : []
);
const SECOND_OCC_CHILD_TERM=(typeof PREVIEW_OPTIONS==='object' && typeof PREVIEW_OPTIONS.secondOccChildTerm==='string')
  ? PREVIEW_OPTIONS.secondOccChildTerm
  : 'Second Occupation Child';
const INIT_PICKER_ID=(typeof PREVIEW_OPTIONS==='object' && typeof PREVIEW_OPTIONS.pickerOpenId==='number')
  ? PREVIEW_OPTIONS.pickerOpenId
  : null;
const NODE_COLOR_MAP=${colorMapJSON};

/* ── Symbol helpers (mirrors data.js) ── */
function normTerm(t){return String(t||'').trim().replace(/\\s+/g,' ');}
function nodeSymbols(node){
  const list=Array.isArray(node?.meta?.symbols)?node.meta.symbols:[];
  const seen=new Set(); const out=[];
  for(const raw of list){
    const t=normTerm(raw); if(!t) continue;
    const k=t.toLowerCase(); if(seen.has(k)) continue;
    seen.add(k); out.push(t);
  }
  return out;
}
function computeLetters(terms){
  const norm=terms.map(normTerm).filter(Boolean);
  const lens=new Map();
  for(const t of norm) lens.set(t,1);
  const MAX=3;
  for(let pass=0; pass<MAX; pass++){
    const buckets=new Map();
    for(const t of norm){
      const n=Math.min(lens.get(t),t.length);
      const key=t.slice(0,n).toLowerCase();
      if(!buckets.has(key)) buckets.set(key,[]);
      buckets.get(key).push(t);
    }
    let extended=false;
    for(const group of buckets.values()){
      if(group.length<2) continue;
      for(const t of group){
        const c=lens.get(t);
        if(c<t.length && c<MAX){ lens.set(t,c+1); extended=true; }
      }
    }
    if(!extended) break;
  }
  const out={};
  for(const t of norm){
    const n=Math.min(lens.get(t),t.length);
    const s=t.slice(0,n);
    out[t]=s.charAt(0).toUpperCase()+s.slice(1).toLowerCase();
  }
  return out;
}
/* Returns {top:y%, left:x%} for the i-th symbol in a card (0..N-1).
   Corners cycle TR, TL, BR, BL; subsequent indices stack inward along
   the same edge. Hardcoded 8px insets match the existing badge layout. */
function symbolPosition(i, total){
  const corner=i%4;             // 0..3
  const ring=Math.floor(i/4);   // 0,1,2…
  const inset=8;
  const step=Math.max(18, Math.round(24*0.85)); // stacking step in px
  const off=ring*step;
  switch(corner){
    case 0: return {top:(inset+off)+'px', right:inset+'px', left:'', bottom:''};
    case 1: return {top:(inset+off)+'px', left:inset+'px', right:'', bottom:''};
    case 2: return {bottom:(inset+off)+'px', right:inset+'px', left:'', top:''};
    case 3: return {bottom:(inset+off)+'px', left:inset+'px', right:'', top:''};
  }
  return {top:inset+'px', left:inset+'px', right:'', bottom:''};
}

/* Split / join — mirrors data.js. Keep behavior identical. */
function splitName(name){
  const n=String(name||'').trim();
  if(!n) return {sign:'',rest:''};
  if(n==='Founding Father') return {sign:'Founding',rest:'Father'};
  const sp=n.indexOf(' ');
  if(sp===-1) return {sign:'',rest:n};
  return {sign:n.slice(0,sp),rest:n.slice(sp+1).trim()};
}
function joinName(sign,rest){
  const s=String(sign||'').trim();
  const r=String(rest||'').trim();
  if(s==='Founding' && r==='Father') return 'Founding Father';
  if(!s) return r;
  if(!r) return s;
  return s+' '+r;
}
const SLIP_VERTICAL_CLEARANCE=${Math.max(10, Math.round(nodeH * 0.15))};

function installIOSFocusZoomGuard(){
  const isiPhone=/iPhone|iPod/.test(navigator.userAgent);
  if(!isiPhone) return;
  const viewport=document.querySelector('meta[name="viewport"]');
  if(!viewport) return;
  const baseContent=viewport.getAttribute('content')||'width=device-width,initial-scale=1';
  const lockedContent=baseContent.includes('maximum-scale')?baseContent:baseContent+',maximum-scale=1';
  let restoreTimer=null;
  function lock(){
    clearTimeout(restoreTimer);
    viewport.setAttribute('content',lockedContent);
  }
  function restore(){
    clearTimeout(restoreTimer);
    restoreTimer=setTimeout(()=>{
      viewport.setAttribute('content',lockedContent);
      requestAnimationFrame(()=>viewport.setAttribute('content',baseContent));
    },350);
  }
  document.addEventListener('focusin',e=>{
    if(e.target?.matches?.('input,textarea,select')) lock();
  });
  document.addEventListener('focusout',e=>{
    if(e.target?.matches?.('input,textarea,select')) restore();
  });
}
installIOSFocusZoomGuard();

/* ── Layout constants ── */
const C={
  nW:${nodeW}, nH:${nodeH},
  xG:${gapX},  yG:${nodeH + gapY} + (SHOW_OCCUPATION_SLIPS ? SLIP_VERTICAL_CLEARANCE : 0),
  pX:120,      pY:80,
  bG:${branchG},
  minZ:0.15,   maxZ:3,
};

/* ── DOM refs ── */
const sc=document.getElementById('scene');
const wr=document.getElementById('world');
const sv=document.getElementById('edges');
const nl=document.getElementById('nodesLayer');

/* ── Tree index ── */
const ch=new Map(), po=new Map(), nd=new Map(), an=[];
let rt=null;
function walk(n,p){
  nd.set(n.id,n); an.push(n);
  if(p!==null) po.set(n.id,p); else rt=n.id;
  ch.set(n.id,n.children.map(c=>c.id));
  for(const c of n.children) walk(c,n.id);
}
walk(TREE,null);

/* ── Treemap layout (Reingold–Tilford x, depth y) ── */
const ps=new Map(); let li=0;
function lay(n,d){
  const k=ch.get(n)||[];
  if(!k.length){ps.set(n,{x:li++,y:d});return;}
  const s=li;
  for(const c of k) lay(c,d+1);
  ps.set(n,{x:(s+li-1)/2,y:d});
}
lay(rt,0);
const maxDepth=Math.max(...[...ps.values()].map(p=>p.y));
const cw=C.pX*2+Math.max(0,(li-1)*C.xG)+C.nW;
const ch2=C.pY*2+maxDepth*C.yG+C.nH;
wr.style.width=cw+'px'; wr.style.height=ch2+'px';
sv.setAttribute('width',cw); sv.setAttribute('height',ch2);
sv.setAttribute('viewBox','0 0 '+cw+' '+ch2);
const xOf=n=>C.pX+ps.get(n).x*C.xG;
const yOf=n=>C.pY+ps.get(n).y*C.yG;

/* ── Utilities ── */
const sc2=n=>n==='Founding Father'?'Founding':n.split(' ')[0];
function textColorFor(bg){
  if(typeof bg!=='string') return '#1e1e1e';
  const h=bg.replace('#','');
  const r=parseInt(h.slice(0,2),16),g=parseInt(h.slice(2,4),16),b=parseInt(h.slice(4,6),16);
  const lum=0.2126*r+0.7152*g+0.0722*b;
  return lum>160?'#111111':'#fbf6eb';
}
function darkenHex(hex, factor){
  if(typeof hex!=='string'||!hex.startsWith('#')||hex.length!==7) return '#8a8a8a';
  const r=Math.max(0,Math.min(255,Math.round(parseInt(hex.slice(1,3),16)*(1-factor))));
  const g=Math.max(0,Math.min(255,Math.round(parseInt(hex.slice(3,5),16)*(1-factor))));
  const b=Math.max(0,Math.min(255,Math.round(parseInt(hex.slice(5,7),16)*(1-factor))));
  return '#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('');
}
function post(msg){window.parent.postMessage(msg,'*');}
function act(id,action,extras){post({type:'node-action',id,action,...(extras||{})});}

/* ── Drag-reparent state ── */
let selId=INIT_SEL, renamingId=null, focusRenameId=null, occupationEditingId=null, focusOccId=null, secondOccupationEditingId=null, focusOcc2Id=null, symbolEditingId=INIT_PICKER_ID;
let suppressSceneClick=false, suppressNodeClickUntil=0;
const REPAR_HOLD_MS=260, REPAR_MOVE_TOL=8;
let holdDrag=null;
function canDropOn(src,tgt){
  if(typeof src!=='number'||typeof tgt!=='number'||src===tgt) return false;
  let cur=tgt;
  while(cur!==undefined){if(cur===src)return false;cur=po.get(cur);}
  return true;
}
function wrapById(id){return nl.querySelector('.node-wrap[data-id="'+id+'"]');}
function clearDropDecor(){
  if(!holdDrag) return;
  wrapById(holdDrag.sourceId)?.querySelector('.node')?.classList.remove('drag-source');
  if(typeof holdDrag.targetId==='number')
    wrapById(holdDrag.targetId)?.querySelector('.node')?.classList.remove('drop-target');
}
function setDropTarget(tgtId){
  if(!holdDrag) return;
  if(holdDrag.targetId===tgtId) return;
  if(typeof holdDrag.targetId==='number')
    wrapById(holdDrag.targetId)?.querySelector('.node')?.classList.remove('drop-target');
  holdDrag.targetId=tgtId;
  if(typeof tgtId==='number')
    wrapById(tgtId)?.querySelector('.node')?.classList.add('drop-target');
}
function pickTarget(cx,cy,src){
  const el=document.elementFromPoint(cx,cy);
  const wrap=el?.closest('.node-wrap');
  if(!wrap) return null;
  const id=Number(wrap.dataset.id);
  return Number.isFinite(id)&&canDropOn(src,id)?id:null;
}
function beginHoldReparent(e,id){
  if(e.pointerType==='mouse'&&e.button!==0) return;
  if(renamingId!==null||occupationEditingId!==null||secondOccupationEditingId!==null||symbolEditingId!==null) return;
  const wrap=wrapById(id); if(!wrap) return;
  const nodeEl=wrap.querySelector('.node'); if(!nodeEl) return;
  // NOTE: do NOT stopPropagation or setPointerCapture here — the scene needs
  // this pointerdown to start panning. We only capture once the long-press
  // timer fires (i.e. user is actually reparenting, not panning).
  holdDrag={pointerId:e.pointerId,sourceId:id,
    startX:e.clientX,startY:e.clientY,lastX:e.clientX,lastY:e.clientY,
    active:false,targetId:null,timer:null};
  const onMove=ev=>{
    if(!holdDrag||ev.pointerId!==holdDrag.pointerId) return;
    holdDrag.lastX=ev.clientX; holdDrag.lastY=ev.clientY;
    const moved=Math.hypot(ev.clientX-holdDrag.startX,ev.clientY-holdDrag.startY);
    if(!holdDrag.active&&moved>REPAR_MOVE_TOL){clearTimeout(holdDrag.timer);holdDrag.timer=null;return;}
    if(!holdDrag.active) return;
    ev.preventDefault();
    setDropTarget(pickTarget(ev.clientX,ev.clientY,holdDrag.sourceId));
  };
  const finish=ev=>{
    if(!holdDrag||ev.pointerId!==holdDrag.pointerId) return;
    clearTimeout(holdDrag.timer);
    const wasActive=holdDrag.active, srcId=holdDrag.sourceId, tgtId=holdDrag.targetId;
    clearDropDecor(); holdDrag=null;
    nodeEl.removeEventListener('pointermove',onMove);
    nodeEl.removeEventListener('pointerup',finish);
    nodeEl.removeEventListener('pointercancel',finish);
    if(wasActive&&typeof tgtId==='number'&&canDropOn(srcId,tgtId)){
      suppressNodeClickUntil=performance.now()+420;
      act(srcId,'reparent',{targetId:tgtId});
      post({type:'select-node',id:srcId});
    }
  };
  holdDrag.timer=setTimeout(()=>{
    if(!holdDrag||holdDrag.pointerId!==e.pointerId) return;
    // Only now do we claim the pointer — user clearly wants to reparent.
    holdDrag.active=true;
    // Stop any momentum and tell the scene to drop this pointer so it
    // can't pan further while the user is dragging to a new parent.
    try{ stopMomentum(); }catch(_){}
    try{
      if(ptrs.has(holdDrag.pointerId)){
        ptrs.delete(holdDrag.pointerId);
        sc.classList.remove('dragging');
        try{ sc.releasePointerCapture(holdDrag.pointerId); }catch(_){}
      }
    }catch(_){}
    try{ nodeEl.setPointerCapture(holdDrag.pointerId); }catch(_){}
    nodeEl.classList.add('drag-source');
    setDropTarget(pickTarget(holdDrag.lastX,holdDrag.lastY,holdDrag.sourceId));
  },REPAR_HOLD_MS);
  nodeEl.addEventListener('pointermove',onMove);
  nodeEl.addEventListener('pointerup',finish);
  nodeEl.addEventListener('pointercancel',finish);
}

/* ── Node button factory ── */
function mkBtn(txt,title,handler,disabled){
  const b=document.createElement('button');
  b.className='node-btn'+(disabled?' disabled':'');
  b.type='button'; b.textContent=txt; b.title=title;
  b.addEventListener('pointerdown',e=>e.stopPropagation());
  b.addEventListener('click',e=>{e.stopPropagation();if(!disabled)handler();});
  return b;
}

/* ── Rename (inside preview) ── */
function beginRename(id){
  selId=id; renamingId=id; focusRenameId=id;
  occupationEditingId=null; focusOccId=null;
  updateSelection(); renderNodes();
  post({type:'select-node',id});
}
function commitRename(id,inp){
  const value=inp.value.trim();
  renamingId=null; focusRenameId=null; renderNodes();
  if(value) act(id,'rename-commit',{value});
}
function commitRenameSplit(id, value){
  renamingId=null; focusRenameId=null; renderNodes();
  if(value) act(id,'rename-commit',{value});
}
function cancelRename(){renamingId=null;focusRenameId=null;renderNodes();}
function beginOccupationEdit(id){
  selId=id;
  renamingId=null; focusRenameId=null;
  occupationEditingId=id; focusOccId=id;
  secondOccupationEditingId=null; focusOcc2Id=null;
  updateSelection(); renderNodes();
  post({type:'select-node',id});
}
function commitOccupation(id, sel){
  const value=(sel.value||'').trim();
  occupationEditingId=null; focusOccId=null; renderNodes();
  act(id,'set-occupation',{value});
}
function cancelOccupationEdit(){
  occupationEditingId=null; focusOccId=null; renderNodes();
}

function beginSecondOccupationEdit(id){
  selId=id;
  renamingId=null; focusRenameId=null;
  occupationEditingId=null; focusOccId=null;
  secondOccupationEditingId=id; focusOcc2Id=id;
  updateSelection(); renderNodes();
  post({type:'select-node',id});
}
function commitSecondOccupation(id, sel){
  const value=(sel.value||'').trim();
  secondOccupationEditingId=null; focusOcc2Id=null; renderNodes();
  act(id,'set-occupation-2',{value});
}
function cancelSecondOccupationEdit(){
  secondOccupationEditingId=null; focusOcc2Id=null; renderNodes();
}

function beginSymbolPicker(id){
  selId=id;
  renamingId=null; focusRenameId=null;
  occupationEditingId=null; focusOccId=null;
  secondOccupationEditingId=null; focusOcc2Id=null;
  symbolEditingId=id;
  updateSelection(); renderNodes();
  post({type:'select-node',id});
  post({type:'picker-state',id});
}
function closeSymbolPicker(){
  const wasOpenOn=symbolEditingId;
  symbolEditingId=null;
  renderNodes();
  if(wasOpenOn!==null) post({type:'picker-state',id:null});
}

/* ── Card DOM builder ──
   THIS IS THE FUNCTION TO EDIT when adding occupation / rebirth fields.
   It builds the inner content of each .node div.
   Currently: just the name text.
   Future: add .node-occupation div and .rebirth-badge here.
── */
function buildCardContent(nodeEl, node){
  const bgColor = NODE_COLOR_MAP[sc2(node.name)] || '#ffffff';
  const fg=textColorFor(bgColor);
  const hasDouble = !!(node.meta?.occupation2) && !HIDDEN_SYMBOLS.has('__second_occupation__');
  const syms = nodeSymbols(node).filter(t => !HIDDEN_SYMBOLS.has(t.toLowerCase()));

  // Highlight if any visible symbol on this card is in the highlight set.
  // Two highlighted symbols still produce a single highlight (class is binary).
  const highlighted =
    (hasDouble && HIGHLIGHT_SYMBOLS.has('__second_occupation__')) ||
    syms.some(t => HIGHLIGHT_SYMBOLS.has(t.toLowerCase()));
  if (highlighted) nodeEl.classList.add('node-highlight');

  // Total symbol count includes the hardcoded 2O badge if present.
  const totalSymbols = (hasDouble ? 1 : 0) + syms.length;
  const symbolSize =
    totalSymbols >= 6 ? 20 :
    totalSymbols >= 4 ? 22 :
    totalSymbols >= 3 ? 24 :
    totalSymbols === 2 ? 28 : 32;
  nodeEl.style.setProperty('--symbol-size', symbolSize + 'px');

  if(hasDouble) nodeEl.classList.add('double-occupation');

  // Name
  const nameLbl=document.createElement('span');
  nameLbl.textContent=node.name;
  nameLbl.style.color=fg;
  nodeEl.appendChild(nameLbl);

  // Double-occupation badge (hardcoded, top-right). Takes corner index 0.
  const occ2Badge=document.createElement('div');
  occ2Badge.className='double-occupation-badge'+(hasDouble ? ' visible' : '');
  occ2Badge.textContent='R';
  occ2Badge.style.color=fg;
  nodeEl.appendChild(occ2Badge);

  // Dynamic symbol badges from meta.symbols.
  // Start placing at corner index 1 (TL) if 2O takes index 0; otherwise from 0.
  const letterMap = computeLetters(syms);
  const startIdx = hasDouble ? 1 : 0;
  syms.forEach((term, i) => {
    const idx = startIdx + i;
    const badge=document.createElement('div');
    badge.className='sym-badge visible';
    badge.textContent=letterMap[term] || term.charAt(0).toUpperCase();
    badge.title=term;
    badge.style.color=fg;
    const pos=symbolPosition(idx, totalSymbols);
    if(pos.top)    badge.style.top=pos.top;
    if(pos.bottom) badge.style.bottom=pos.bottom;
    if(pos.left)   badge.style.left=pos.left;
    if(pos.right)  badge.style.right=pos.right;
    nodeEl.appendChild(badge);
  });

  // Rebirth badge (hidden until meta.reborn is true)
  const rebirthEl=document.createElement('div');
  rebirthEl.className='rebirth-badge'+(node.meta?.reborn?' visible':'');
  rebirthEl.textContent='↺';
  nodeEl.appendChild(rebirthEl);
}

/* ── Render nodes ── */
let actionBtnScale = 1;

function applyActionButtonScale(scale = actionBtnScale) {
  actionBtnScale = scale;
  try{
    for(const a of nl.querySelectorAll('.node-actions')){
      // Anchor the panel to its top edge so zoom compensation grows downward
      // instead of sliding up over the inline editor above it.
      a.style.transformOrigin = 'top center';
      a.style.transform = 'scale('+scale+')';
    }
    for(const el of nl.querySelectorAll('.node-inline-editor, .node-rename-split, .node-sym-picker')){
      // Anchor editors to their bottom edge so they expand upward, away from
      // the action bar below them, while still matching the current zoom.
      el.style.transformOrigin = 'bottom center';
      el.style.transform = 'scale('+scale+')';
    }
  }catch(e){}
}

function updateSelection(){
  for(const wrap of nl.children){
    const on=Number(wrap.dataset.id)===selId;
    wrap.classList.toggle('selected',on);
    wrap.querySelector('.node')?.classList.toggle('selected',on);
  }
  // Keep the latest zoom-compensation applied even when selection rerenders
  // the node DOM without moving the camera.
  applyActionButtonScale();
}

function renderNodes(){
  nl.innerHTML='';
  for(const node of an){
    const id=node.id;
    const wrap=document.createElement('div');
    wrap.className='node-wrap';
    wrap.dataset.id=id;
    wrap.style.left=xOf(id)+'px';
    wrap.style.top=yOf(id)+'px';

    if(renamingId===id){
      const isRoot=(ROOT_ID!==null && id===ROOT_ID);
      if(isRoot){
        // Root keeps the plain single input — "Founding Father" is the documented exception.
        const inp=document.createElement('input');
        inp.className='node-input node-inline-editor'; inp.type='text';
        inp.value=node.name; inp.spellcheck=false;
        inp.addEventListener('pointerdown',e=>e.stopPropagation());
        inp.addEventListener('click',e=>e.stopPropagation());
        inp.addEventListener('blur',()=>commitRename(id,inp));
        inp.addEventListener('keydown',e=>{
          if(e.key==='Enter'){e.preventDefault();e.stopPropagation();commitRename(id,inp);}
          if(e.key==='Escape'){e.preventDefault();e.stopPropagation();cancelRename();}
        });
        wrap.appendChild(inp);
        if(focusRenameId===id){
          requestAnimationFrame(()=>{inp.focus();inp.select();focusRenameId=null;});
        }
      } else {
        // Split: sign <select> (+ optional 'Other…' text input) + name <input>.
        const cur=splitName(node.name);
        const signs=KNOWN_SIGNS.slice();
        if(cur.sign && !signs.includes(cur.sign)) signs.push(cur.sign);

        const box=document.createElement('div');
        box.className='node-rename-split';

        const sel=document.createElement('select');
        sel.className='rs-sign';
        for(const s of signs){
          const opt=document.createElement('option');
          opt.value=s; opt.textContent=s;
          sel.appendChild(opt);
        }
        const otherOpt=document.createElement('option');
        otherOpt.value='__other__'; otherOpt.textContent='Other…';
        sel.appendChild(otherOpt);
        sel.value=(cur.sign && signs.includes(cur.sign)) ? cur.sign : (signs[0] || '__other__');

        const signInp=document.createElement('input');
        signInp.type='text';
        signInp.className='rs-sign-text';
        signInp.placeholder='Sign';
        signInp.spellcheck=false;
        signInp.value=(sel.value==='__other__') ? cur.sign : '';
        signInp.style.display=(sel.value==='__other__') ? '' : 'none';

        const rest=document.createElement('input');
        rest.type='text';
        rest.className='rs-rest';
        rest.placeholder='Name';
        rest.spellcheck=false;
        rest.value=cur.rest;

        box.appendChild(sel);
        box.appendChild(signInp);
        box.appendChild(rest);

        // Stop pointer events so the scene doesn't pan or close the editor.
        for(const el of [box,sel,signInp,rest]){
          el.addEventListener('pointerdown',e=>e.stopPropagation());
          el.addEventListener('click',e=>e.stopPropagation());
        }

        let committed=false;
        function doCommit(){
          if(committed) return;
          committed=true;
          const signRaw=(sel.value==='__other__') ? signInp.value : sel.value;
          const joined=joinName(signRaw, rest.value);
          // Fallback: if joined is empty (both fields blank), don't rename.
          // If only the name field has content, commitRenameSplit handles it.
          commitRenameSplit(id, joined || rest.value.trim());
        }
        function doCancel(){
          if(committed) return;
          committed=true;
          cancelRename();
        }

        sel.addEventListener('change',()=>{
          if(sel.value==='__other__'){
            signInp.style.display='';
            requestAnimationFrame(()=>signInp.focus());
          } else {
            signInp.style.display='none';
          }
        });

        // Commit on blur only when focus actually leaves the wrapper.
        function onBlur(){
          setTimeout(()=>{
            if(!box.contains(document.activeElement)) doCommit();
          },0);
        }
        sel.addEventListener('blur',onBlur);
        signInp.addEventListener('blur',onBlur);
        rest.addEventListener('blur',onBlur);

        for(const el of [sel,signInp,rest]){
          el.addEventListener('keydown',e=>{
            if(e.key==='Enter'){e.preventDefault();e.stopPropagation();doCommit();}
            if(e.key==='Escape'){e.preventDefault();e.stopPropagation();doCancel();}
          });
        }

        wrap.appendChild(box);
        if(focusRenameId===id){
          requestAnimationFrame(()=>{rest.focus();rest.select();focusRenameId=null;});
        }
      }
    } else if(occupationEditingId===id){
      const sel=document.createElement('select');
      sel.className='node-occ-select node-inline-editor';
      const empty=document.createElement('option');
      empty.value=''; empty.textContent='(No occupation)';
      sel.appendChild(empty);
      for(const occ of OCCUPATION_OPTIONS){
        const opt=document.createElement('option');
        opt.value=occ;
        opt.textContent=occ;
        sel.appendChild(opt);
      }
      sel.value=(node.meta?.occupation||'').trim();
      sel.addEventListener('pointerdown',e=>e.stopPropagation());
      sel.addEventListener('click',e=>e.stopPropagation());
      sel.addEventListener('blur',()=>commitOccupation(id,sel));
      sel.addEventListener('keydown',e=>{
        if(e.key==='Enter'){e.preventDefault();e.stopPropagation();commitOccupation(id,sel);}
        if(e.key==='Escape'){e.preventDefault();e.stopPropagation();cancelOccupationEdit();}
      });
      sel.addEventListener('change',()=>commitOccupation(id,sel));
      wrap.appendChild(sel);
      if(focusOccId===id){
        requestAnimationFrame(()=>{sel.focus();focusOccId=null;});
      }
    } else if(symbolEditingId===id){
      // Symbol picker: chips for every term in the library + add-new + done.
      const box=document.createElement('div');
      box.className='node-sym-picker';

      const parentId=po.get(id);
      const parentNode=parentId!==undefined?nd.get(parentId):null;
      const parentHas2O=!!(parentNode?.meta?.occupation2);

      const current=nodeSymbols(node);
      const currentLower=new Set(current.map(t=>t.toLowerCase()));

      // Build the chip list from the union of (library terms, current node terms,
      // and the locked SECOND_OCC_CHILD_TERM so it's always present).
      const libSet=new Set();
      libSet.add(SECOND_OCC_CHILD_TERM);
      for(const t of SYMBOL_TERMS) libSet.add(normTerm(t));
      for(const t of current) libSet.add(t);
      const allTerms=[...libSet].filter(Boolean).sort((a,b)=>a.localeCompare(b));

      const chips=document.createElement('div');
      chips.className='sym-chips';

      function rebuildChips(){
        chips.innerHTML='';
        if(!allTerms.length){
          const empty=document.createElement('div');
          empty.className='sym-empty';
          empty.textContent='No symbols defined. Add one below.';
          chips.appendChild(empty);
          return;
        }
        for(const term of allTerms){
          const chip=document.createElement('button');
          chip.type='button';
          const isOn=currentLower.has(term.toLowerCase());
          const isLocked=(term.toLowerCase()===SECOND_OCC_CHILD_TERM.toLowerCase());
          const disabled=isLocked && !parentHas2O && !isOn;
          chip.className='sym-chip'+(isOn?' on':'')+(disabled?' disabled':'');
          chip.title=term+(disabled?' — requires parent with second occupation':'');
          chip.textContent=term;
          if(!isLocked){
            // Add a small delete affordance to remove from the library.
            const x=document.createElement('span');
            x.className='sym-chip-x';
            x.textContent='×';
            x.title='Remove from library';
            x.addEventListener('click',e=>{
              e.stopPropagation();
              act(id,'remove-symbol-term',{term});
            });
            chip.appendChild(x);
          }
          chip.addEventListener('pointerdown',e=>e.stopPropagation());
          chip.addEventListener('click',e=>{
            e.stopPropagation();
            if(disabled) return;
            // Toggle assignment on this node.
            if(isOn){
              const next=current.filter(t=>t.toLowerCase()!==term.toLowerCase());
              act(id,'set-symbols',{symbols:next});
            } else {
              act(id,'set-symbols',{symbols:[...current,term]});
            }
          });
          chips.appendChild(chip);
        }
      }
      rebuildChips();
      box.appendChild(chips);

      // Add-new row
      const addRow=document.createElement('div');
      addRow.className='sym-add-row';
      const addInp=document.createElement('input');
      addInp.type='text';
      addInp.className='sym-add-input';
      addInp.placeholder='New symbol term…';
      addInp.spellcheck=false;
      const addBtn=document.createElement('button');
      addBtn.type='button';
      addBtn.className='sym-add-btn';
      addBtn.textContent='Add';
      const doneBtn=document.createElement('button');
      doneBtn.type='button';
      doneBtn.className='sym-done-btn';
      doneBtn.textContent='Done';

      function submitAdd(){
        const t=normTerm(addInp.value);
        if(!t) return;
        addInp.value='';
        // Send to host; main.js will add to the library and assign to this node.
        act(id,'add-symbol-term',{term:t,assignToNode:true});
      }

      addBtn.addEventListener('pointerdown',e=>e.stopPropagation());
      addBtn.addEventListener('click',e=>{e.stopPropagation();submitAdd();});
      doneBtn.addEventListener('pointerdown',e=>e.stopPropagation());
      doneBtn.addEventListener('click',e=>{e.stopPropagation();closeSymbolPicker();});
      addInp.addEventListener('pointerdown',e=>e.stopPropagation());
      addInp.addEventListener('click',e=>e.stopPropagation());
      addInp.addEventListener('keydown',e=>{
        if(e.key==='Enter'){e.preventDefault();e.stopPropagation();submitAdd();}
        if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeSymbolPicker();}
      });

      addRow.appendChild(addInp);
      addRow.appendChild(addBtn);
      addRow.appendChild(doneBtn);
      box.appendChild(addRow);

      // Stop bubbling so the scene doesn't pan or deselect.
      box.addEventListener('pointerdown',e=>e.stopPropagation());
      box.addEventListener('click',e=>e.stopPropagation());

      wrap.appendChild(box);
    } else if(secondOccupationEditingId===id){
      const sel=document.createElement('select');
      sel.className='node-occ-select node-inline-editor';
      const empty=document.createElement('option');
      empty.value=''; empty.textContent='(No second occupation)';
      sel.appendChild(empty);
      for(const occ of OCCUPATION_OPTIONS){
        const opt=document.createElement('option');
        opt.value=occ;
        opt.textContent=occ;
        sel.appendChild(opt);
      }
      sel.value=(node.meta?.occupation2||'').trim();
      sel.addEventListener('pointerdown',e=>e.stopPropagation());
      sel.addEventListener('click',e=>e.stopPropagation());
      sel.addEventListener('blur',()=>commitSecondOccupation(id,sel));
      sel.addEventListener('keydown',e=>{
        if(e.key==='Enter'){e.preventDefault();e.stopPropagation();commitSecondOccupation(id,sel);}
        if(e.key==='Escape'){e.preventDefault();e.stopPropagation();cancelSecondOccupationEdit();}
      });
      sel.addEventListener('change',()=>commitSecondOccupation(id,sel));
      wrap.appendChild(sel);
      if(focusOcc2Id===id){
        requestAnimationFrame(()=>{sel.focus();focusOcc2Id=null;});
      }
    } else {
      const d=document.createElement('div');
      d.className='node '+sc2(node.name);
      d.addEventListener('pointerdown',e=>{e.stopPropagation();beginHoldReparent(e,id);});
      d.addEventListener('click',e=>{
        e.stopPropagation();
        if(performance.now()<suppressNodeClickUntil) return;
        selId=id;
        const wasPickerOpen=symbolEditingId!==null;
        renamingId=null;
        occupationEditingId=null;
        secondOccupationEditingId=null;
        symbolEditingId=null;
        renderNodes(); post({type:'select-node',id});
        if(wasPickerOpen) post({type:'picker-state',id:null});
      });
      buildCardContent(d, node);
      if(d.classList.contains('node-highlight')) wrap.classList.add('has-highlight');
      wrap.appendChild(d);
      const occ=(node.meta?.occupation||'').trim();
      if(SHOW_OCCUPATION_SLIPS && occ){
        const slip=document.createElement('div');
        slip.className='occupation-slip visible';
        slip.textContent=occ;
        const base=NODE_COLOR_MAP[sc2(node.name)]||'#bdbdbd';
        const slipBg=darkenHex(base,0.16);
        slip.style.background=slipBg;
        slip.style.color=textColorFor(slipBg);
        slip.style.borderColor='rgba(0,0,0,.24)';
        slip.addEventListener('pointerdown',e=>e.stopPropagation());
        slip.addEventListener('click',e=>{e.stopPropagation();beginOccupationEdit(id);});
        wrap.appendChild(slip);
      }
      const occ2=(node.meta?.occupation2||'').trim();
      if(SHOW_OCCUPATION_SLIPS && occ2){
        const slip=document.createElement('div');
        slip.className='occupation-slip visible';
        slip.textContent=occ2;
        slip.style.marginTop='-4px';
        slip.style.background='rgba(212,168,76,.9)';
        slip.style.color='#1b1110';
        slip.style.borderColor='rgba(0,0,0,.24)';
        slip.addEventListener('pointerdown',e=>e.stopPropagation());
        slip.addEventListener('click',e=>{e.stopPropagation();beginSecondOccupationEdit(id);});
        wrap.appendChild(slip);
      }
    }

    /* Action bar */
    const acts=document.createElement('div');
    acts.className='node-actions';
    const parentId=po.get(id);
    const parentNode=parentId!==undefined?nd.get(parentId):null;
    const sibs=parentId!==undefined?(ch.get(parentId)||[]):[];
    const idx=sibs.indexOf(id);
    if(parentId!==undefined){
      acts.appendChild(mkBtn('▲','Move up',()=>act(id,'move-up'),idx<=0));
      acts.appendChild(mkBtn('▼','Move down',()=>act(id,'move-down'),idx===-1||idx>=sibs.length-1));
      acts.appendChild(mkBtn('↔','Add sibling',()=>act(id,'add-sibling',{inline:true})));
    }
    acts.appendChild(mkBtn('+','Add child',()=>act(id,'add-child',{inline:true})));
    acts.appendChild(mkBtn('✎','Rename',()=>beginRename(id)));
    acts.appendChild(mkBtn('Oc','Set occupation',()=>beginOccupationEdit(id)));
    acts.appendChild(mkBtn('2O','Second occupation',()=>beginSecondOccupationEdit(id), OCCUPATION_OPTIONS.length===0));
    acts.appendChild(mkBtn('◆','Symbols',()=>beginSymbolPicker(id)));
    if(parentId!==undefined) acts.appendChild(mkBtn('×','Delete',()=>act(id,'delete')));
    wrap.appendChild(acts);
    nl.appendChild(wrap);
  }
  updateSelection();
}

/* ── Render edges ── */
function renderEdges(){
  sv.innerHTML='';
  for(const [par,kids] of ch){
    if(!kids.length) continue;
    const px=xOf(par), pb=yOf(par)+C.nH, by=pb+C.bG;
    const xs=kids.map(xOf), mn=Math.min(...xs), mx2=Math.max(...xs);
    const g=document.createElementNS('http://www.w3.org/2000/svg','g');
    g.setAttribute('stroke','rgba(70,70,70,.9)');
    g.setAttribute('stroke-width','2.4');
    g.setAttribute('fill','none');
    const t=document.createElementNS('http://www.w3.org/2000/svg','path');
    t.setAttribute('d',kids.length>1
      ?'M '+px+' '+pb+' V '+by+' H '+mn+' H '+mx2
      :'M '+px+' '+pb+' V '+by+' H '+xs[0]);
    g.appendChild(t);
    for(const c of kids){
      const cx=xOf(c),cy=yOf(c),dd=document.createElementNS('http://www.w3.org/2000/svg','path');
      dd.setAttribute('d','M '+cx+' '+by+' V '+cy);
      g.appendChild(dd);
    }
    sv.appendChild(g);
  }
}

renderNodes(); renderEdges();

/* ── Inbound messages ── */
window.addEventListener('message',e=>{
  if(!e.data) return;
  if(e.data.type==='select-node'){
    selId=e.data.id;
    if(selId===null){ renamingId=null; occupationEditingId=null; }
    updateSelection();
  }
  if(e.data.type==='start-rename'&&typeof e.data.id==='number'){
    beginRename(e.data.id);
  }
});

/* ════════════════════════════════════════════════
   CAMERA — pan / pinch / wheel
   ════════════════════════════════════════════════ */
const cam={x:0,y:0,z:1};
function sendCam(){window.parent.postMessage({type:'cam',cam:{x:cam.x,y:cam.y,zoom:cam.z}},'*');}
function applyTransform(){
  wr.style.transform='translate3d('+Math.round(cam.x)+'px,'+Math.round(cam.y)+'px,0) scale('+cam.z+')';
  // Keep action buttons visible when zoomed out by counter-scaling them.
  // Clamp the inverse scale so buttons don't become excessively large.
  try{
    const minScale = 1;
    const maxScale = 3.4; // allow a larger panel when zoomed far out
    const safeZ = Math.max(cam.z, 0.18);
    const inv = 1 / safeZ;
    // Piecewise: track 1/z naturally near 1x; only ramp aggressively once
    // we're zoomed out past ~0.7x (inv > 1.4). Keeps close-zoom UI from
    // ballooning while preserving readable buttons at far zoom.
    const KNEE = 1.4;
    const aggressiveInv = inv <= KNEE ? inv : KNEE + Math.pow(inv - KNEE, 1.22);
    const btnScale = Math.min(maxScale, Math.max(minScale, aggressiveInv));
    applyActionButtonScale(btnScale);
  }catch(e){}
  sendCam();
}
if(INIT_CAM){cam.x=INIT_CAM.x;cam.y=INIT_CAM.y;cam.z=INIT_CAM.zoom;applyTransform();}
else{const r=sc.getBoundingClientRect();cam.x=r.width/2-xOf(rt)*cam.z;cam.y=40;applyTransform();}

/* Pointer/gesture state */
const ptrs=new Map();
let vx=0,vy=0,rafId=null;
let tapStartX=0,tapStartY=0,dragMoved=false;
let panAnchorX=0,panAnchorY=0,camAnchorX=0,camAnchorY=0,lastPanX=0,lastPanY=0;
let pinchActive=false,pinch0d=0,pinch0z=0,pinch0mx=0,pinch0my=0,pinchCam0x=0,pinchCam0y=0;
let lastPanMoveAt=0;
const PINCH_DAMPEN=0.85;
const PINCH_INTENT_PX=2;
const PINCH_PAN_DAMPEN=0.85;

/* Velocity ring buffer */
const VEL_BUF=6,vBufX=new Float32Array(VEL_BUF),vBufY=new Float32Array(VEL_BUF);
let vBufIdx=0;
function resetVelBuf(){vBufX.fill(0);vBufY.fill(0);vBufIdx=0;}
function pushVelSample(dx,dy){vBufX[vBufIdx%VEL_BUF]=dx;vBufY[vBufIdx%VEL_BUF]=dy;vBufIdx++;}
function readVel(){
  let sx=0,sy=0,sw=0;
  const n=Math.min(vBufIdx,VEL_BUF);
  for(let i=0;i<n;i++){const slot=(vBufIdx-n+i)%VEL_BUF,w=i+1;sx+=vBufX[slot]*w;sy+=vBufY[slot]*w;sw+=w;}
  return sw>0?{x:sx/sw,y:sy/sw}:{x:0,y:0};
}

/* Momentum */
const FRICTION=0.84,VEL_MIN=0.35,VEL_MAX=18;
const MOMENTUM_RELEASE_IDLE_MS=90;
const MOMENTUM_RELEASE_MIN=0.55;
function momentumTick(){
  vx*=FRICTION;vy*=FRICTION;
  if(Math.abs(vx)<VEL_MIN&&Math.abs(vy)<VEL_MIN){rafId=null;sendCam();return;}
  cam.x+=vx;cam.y+=vy;applyTransform();
  rafId=requestAnimationFrame(momentumTick);
}
function stopMomentum(){if(rafId){cancelAnimationFrame(rafId);rafId=null;}}
function launchMomentum(){
  const spd=Math.hypot(vx,vy);
  if(spd>VEL_MAX){vx=vx/spd*VEL_MAX;vy=vy/spd*VEL_MAX;}
  if(Math.abs(vx)>VEL_MIN||Math.abs(vy)>VEL_MIN) rafId=requestAnimationFrame(momentumTick);
  else{vx=0;vy=0;}
}

function snapshotPan(){
  const[p]=[...ptrs.values()];
  panAnchorX=lastPanX=p.x;panAnchorY=lastPanY=p.y;
  camAnchorX=cam.x;camAnchorY=cam.y;resetVelBuf();
}
function getPinchMid(){
  const[a,b]=[...ptrs.values()];
  return{mx:(a.x+b.x)/2,my:(a.y+b.y)/2,d:Math.hypot(a.x-b.x,a.y-b.y)};
}
function snapshotPinch(){
  pinchActive=true;
  const{mx,my,d}=getPinchMid();
  const r=sc.getBoundingClientRect();
  pinch0d=d;pinch0z=cam.z;
  pinch0mx=mx-r.left;pinch0my=my-r.top;
  pinchCam0x=cam.x;pinchCam0y=cam.y;
}

sc.addEventListener('pointerdown',e=>{
  if(e.pointerType==='mouse'&&e.button!==0) return;
  stopMomentum();sc.setPointerCapture(e.pointerId);
  ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(ptrs.size===1){pinchActive=false;snapshotPan();tapStartX=e.clientX;tapStartY=e.clientY;dragMoved=false;sc.classList.add('dragging');}
  else if(ptrs.size===2) snapshotPinch();
});
sc.addEventListener('pointermove',e=>{
  if(!ptrs.has(e.pointerId)) return;
  ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY});
  // If the user started their gesture on a node but is now panning,
  // cancel the pending hold-reparent timer so the node doesn't grab
  // the pointer mid-pan.
  if(holdDrag&&!holdDrag.active&&holdDrag.pointerId===e.pointerId){
    const moved=Math.hypot(e.clientX-holdDrag.startX,e.clientY-holdDrag.startY);
    if(moved>REPAR_MOVE_TOL){clearTimeout(holdDrag.timer);holdDrag=null;}
  }
  if(ptrs.size===1&&!pinchActive){
    const p=ptrs.get(e.pointerId);
    const fdx=p.x-lastPanX,fdy=p.y-lastPanY;
    if(Math.hypot(p.x-tapStartX,p.y-tapStartY)>6) dragMoved=true;
    if(Math.abs(fdx)>0.01||Math.abs(fdy)>0.01) lastPanMoveAt=performance.now();
    pushVelSample(fdx,fdy);lastPanX=p.x;lastPanY=p.y;
    cam.x=camAnchorX+(p.x-panAnchorX);cam.y=camAnchorY+(p.y-panAnchorY);
    applyTransform();
  } else if(ptrs.size>=2&&pinchActive){
    const{mx,my,d}=getPinchMid();
    const r=sc.getBoundingClientRect();
    const curMx=mx-r.left,curMy=my-r.top;
    const pinchDelta=Math.abs(d-pinch0d);
    const intent=Math.min(1,pinchDelta/PINCH_INTENT_PX);
    const ratio=1+(d/pinch0d-1)*PINCH_DAMPEN*intent;
    const nz=Math.min(C.maxZ,Math.max(C.minZ,pinch0z*ratio));
    const wx=(pinch0mx-pinchCam0x)/pinch0z,wy=(pinch0my-pinchCam0y)/pinch0z;
    const panDx=(curMx-pinch0mx)*PINCH_PAN_DAMPEN*intent;
    const panDy=(curMy-pinch0my)*PINCH_PAN_DAMPEN*intent;
    cam.z=nz;cam.x=pinch0mx-wx*nz+panDx;cam.y=pinch0my-wy*nz+panDy;
    applyTransform();
  }
});
sc.addEventListener('pointerup',endPtr);sc.addEventListener('pointercancel',endPtr);
function endPtr(e){
  // Clear any pending (inactive) hold-reparent on release — its own listeners
  // are on the node element and may not see the up if the finger drifted off.
  if(holdDrag&&!holdDrag.active&&holdDrag.pointerId===e.pointerId){
    clearTimeout(holdDrag.timer);holdDrag=null;
  }
  if(!ptrs.has(e.pointerId)) return;
  ptrs.delete(e.pointerId);
  if(ptrs.size===0){
    sc.classList.remove('dragging');pinchActive=false;
    suppressSceneClick=dragMoved;
    const vel=readVel();
    const idleFor=performance.now()-lastPanMoveAt;
    if(idleFor>MOMENTUM_RELEASE_IDLE_MS){
      vx=0;vy=0;stopMomentum();
    }else{
      vx=vel.x;vy=vel.y;
      if(Math.hypot(vx,vy)<MOMENTUM_RELEASE_MIN){vx=0;vy=0;stopMomentum();}
      else launchMomentum();
    }
    resetVelBuf();
    setTimeout(()=>{suppressSceneClick=false;},0);
  } else if(ptrs.size===1){pinchActive=false;resetVelBuf();snapshotPan();dragMoved=true;}
}
sc.addEventListener('click',e=>{
  if(suppressSceneClick) return;
  if(e.target.closest('.node-wrap')) return;
  if(renamingId!==null) return;
  const wasPickerOpen=symbolEditingId!==null;
  selId=null;
  symbolEditingId=null;
  updateSelection();
  if(wasPickerOpen) renderNodes();
  post({type:'select-node',id:null});
  if(wasPickerOpen) post({type:'picker-state',id:null});
});

/* Mouse wheel zoom */
const WHEEL_MOUSE_STEP=0.065, WHEEL_TP_SCALE=0.003, WHEEL_TP_MAX=0.12;
sc.addEventListener('wheel',e=>{
  e.preventDefault();stopMomentum();
  const r=sc.getBoundingClientRect(),mx=e.clientX-r.left,my=e.clientY-r.top;
  let zf;
  if(e.deltaMode===1){
    zf=e.deltaY>0?1-WHEEL_MOUSE_STEP:1+WHEEL_MOUSE_STEP;
  } else {
    const abs=Math.abs(e.deltaY);
    const isTrackpad=abs<60||e.deltaY%1!==0;
    if(isTrackpad){const t=Math.max(-WHEEL_TP_MAX,Math.min(WHEEL_TP_MAX,-e.deltaY*WHEEL_TP_SCALE));zf=Math.exp(t);}
    else{zf=e.deltaY>0?1-WHEEL_MOUSE_STEP:1+WHEEL_MOUSE_STEP;}
  }
  const oz=cam.z,nz=Math.min(C.maxZ,Math.max(C.minZ,oz*zf));
  const wx=(mx-cam.x)/oz,wy=(my-cam.y)/oz;
  cam.z=nz;cam.x=mx-wx*nz;cam.y=my-wy*nz;applyTransform();
},{passive:false});

})(); // end IIFE
`;
}
