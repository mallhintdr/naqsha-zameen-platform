# INV-05 — Aks Shajra page (`/aks-shajra`, admin only)

Source files (all under `D:\temp-repo\old-repo\src\components\AksShajra\`):

| File | Lines | Role |
|---|---|---|
| `AksShajraPage.js` | 983 | Page container, master Konva canvas, undo/redo, localStorage draft, keyboard shortcuts |
| `TopToolbar.js` | 312 | 48 px dark toolbar (file ops, undo/redo, tools, colours, snap, zoom, Metadata, Export) |
| `LeftPanel.js` | 332 | 320 px collapsible sidebar with 4 tabs: Grid / Cells / Symbols / Legend |
| `CellEditorModal.js` | 850 | Full-screen overlay editor for one grid cell at 3.5x zoom (precision drawing) |
| `MapMetadataModal.js` | 188 | react-bootstrap `Modal size="lg"` – title block fields + north arrow style |
| `ExportModal.js` | 143 | react-bootstrap `Modal size="md"` – PDF / PNG / "Vector" export |
| `exportUtils.js` | 258 | `exportStageToPNG`, `exportToPDF` (jsPDF), `exportProjectJSON` |
| `geometryUtils.js` | 131 | snap, shoelace area, centroid, Ramer-Douglas-Peucker (unused) |
| `shajraConstants.js` | 96 | units, paper sizes, scales, symbols, default legend, initial state, formatters |
| `AksShajra.css` | 1079 | all styling (dark slate theme) |

Wiring outside the folder:
- `src/App.js:49` `const AksShajraPage = lazy(() => import('./components/AksShajra/AksShajraPage'));`
- `src/App.js:524` `<Route path="/aks-shajra" element={<ProtectedRoute requiredRole="admin"><AksShajraPage /></ProtectedRoute>} />`
- `src/App/NavigationMenu.js:371-373` admin submenu item: `📐 Aks Shajra (Beta / Test)` → `go('/aks-shajra')`.
- **No backend / API calls at all.** Everything is client-side (localStorage + file downloads). `html2canvas` is in package.json but NOT used by this module. Libraries used: `react-konva`/`konva` (^9.3.22 / ^18.2.16), `jspdf` ^2.5.2, `react-bootstrap` (two modals only), `react-icons/fa`.

---

## 1. Domain purpose and full workflow

**What it is.** A digitiser for a Punjab (Pakistan) revenue "Aks Shajra Parcha" — the cadastral sketch of one *murabba* (square, nominally 25 acres, subdivided into *killas*). The master canvas is a rows x cols grid of cells (default 8 x 8); each cell is `cellWidthKarams x cellHeightKarams` *karams* (1 karam = 5.5 ft; default 5 x 4 karams). The patwari opens any cell in a zoomed Cell Editor, draws khasra polygons / boundary lines (khal, rasta) / rectangles / circles (wells) / text labels (khasra numbers) snapped to karam intersections, and the tool auto-labels polygon areas in Marlas/Kanals and edge lengths in karams. A title block (Mouza, Murabba No, Hadbast, Tehsil, District, Prepared By / Checked By, date, scale) and a north-arrow compass badge are rendered on the canvas itself. Output is PDF (jsPDF, A4/A3/A2/Legal) or PNG, and the project can be saved/loaded as JSON.

**Units:** `KARAM_FEET = 5.5`, `KARAMS_PER_MARLA = 9` (sq karams), `MARLAS_PER_KANAL = 20`, `KANALS_PER_ACRE = 8`.

**Workflow step by step**
1. Admin navigates via nav menu "📐 Aks Shajra (Beta / Test)" → `/aks-shajra` (ProtectedRoute requiredRole="admin"). Page is lazy-loaded; full-viewport (`100vw x 100vh`, overflow hidden) — the app chrome is replaced; an "Exit to GIS Dashboard" button (absolute top-left of canvas) does `navigate('/')`.
2. On mount, state loads from `localStorage['aks_shajra_draft']` (JSON) if present, else `INITIAL_PROJECT_STATE`. Every state change is written straight back to that key. History starts as `[projectState]`, index 0.
3. After 80 ms the canvas auto-fits (`fitToContainer`) to the container (zoom <= 1).
4. Left panel (open by default) → **Grid** tab: set Rows/Cols (1–30), Cell Width/Height in karams (>=1), Pixels per Karam slider (10–32 shown; clamped 8–40 on apply), press **Apply Grid Changes**. Paper size / orientation / cadastral scale change immediately (each commits to history).
5. Toolbar **Metadata** (purple) opens MapMetadataModal: title, mauza, murabba, hadbast, tehsil, district, preparedBy, checkedBy, date, north arrow style → **Save Metadata** commits.
6. Default tool is **Cell Edit** (`cellSelect`). Clicking a grid cell on the master canvas opens **CellEditorModal** for `r{row}c{col}`.
7. In the Cell Editor (default tool polygon): click vertices (snap to karam intersections, 18 px threshold in stage space), double-click or press **Close Polygon** (shown once >= 3 points) to finish; drag for Line/Rect/Well(circle); click for Label (text prompt: "Enter Khasra #, Area, or Label"); Erase tool deletes a shape by clicking it; local undo/redo; **Clear Cell** (confirm dialog) empties the cell; **Save Cell** writes `{label, objects}` into `cells[cellKey]` and commits to page history; **Cancel** discards.
8. Alternatively draw directly on the master canvas with Polygon (P)/Line (L)/Rect (R)/Circle tools — these objects get attached to the cell containing the start point (coords are stored in master-canvas space, see gotchas).
9. **Symbols** tab: click a card to stamp an emoji text object (fontSize 24) at the centre of the *hovered* cell (or first cell with data, or `r0c0`).
10. **Legend** tab: edit colour/label of legend rows, add (`#fef08a`/`#ca8a04`, "New Classification"), delete. (Legend is persisted but never rendered on canvas or in the PDF — only the "✓ Legend" text in the export modal claims so.)
11. **Cells** tab lists cells that have >= 1 object (`r0c0` tag, label, "N objects"); clicking opens the editor for that cell.
12. **Save** downloads `${mauza || 'aks_shajra'}.json` (full projectState, 2-space indented). **Open** loads a `.json` file (any parsed JSON is committed as-is; `alert('Invalid JSON file')` on parse error). **New** → `window.confirm('Start a new Shajra map project? Any unsaved changes will be reset.')` → commits `INITIAL_PROJECT_STATE`.
13. **Export Map** (blue gradient) → ExportModal → PDF (jsPDF layout with title block, scale bar, north badge) or PNG (2x/3x/4x pixelRatio + metadata footer strip) or "Vector / Web" (actually PNG at 3x). Download via anchor click.

---

## 2. Page layout, sizes, responsiveness, input

### Structure
```
.aks-shajra-root  (flex column, 100vh x 100vw, overflow hidden, bg #0f172a, font Inter/system-ui, user-select none)
├─ .shajra-toolbar (48px, horizontal scroll)
└─ .shajra-workspace (flex row, flex:1, overflow hidden, position relative)
   ├─ .shajra-panel-backdrop (only rendered when panel open; display:none > 900px)
   ├─ .shajra-left-panel .open|.closed (320px, bg #1e293b)
   │   ├─ .panel-header (48px, bg #0f172a) → .panel-tabs (4 .tab-btn) + .panel-close-btn
   │   └─ .panel-body (flex:1, overflow-y auto, padding 16px)
   └─ .shajra-canvas-container ref=containerRef (flex:1, overflow auto)
       ├─ button.shajra-exit-btn "← Exit to GIS Dashboard" (absolute top 16 left 16, z 40)
       └─ .shajra-stage-wrapper > <Stage>
CellEditorModal  → .cell-editor-overlay (fixed, z 9999) > .cell-editor-container
MapMetadataModal / ExportModal → react-bootstrap Modal.className="shajra-modal", centered
```

### Master Konva Stage
- `pixelsPerKaram = grid.pixelsPerKaram || 16`; `cellWidthPx = cellWidthKarams * ppk`; `cellHeightPx = cellHeightKarams * ppk`.
- `gridPadding = Math.max(80, Math.round(rows * cellHeightPx * 0.125))` (title bar ≈ 10 % of total height).
- `canvasWidth = cols*cellWidthPx + 2*gridPadding`; `canvasHeight = rows*cellHeightPx + 2*gridPadding`. Defaults: ppk 16 → cell 80x64 px, padding max(80, 64) = 80 → canvas 800 x 672.
- Stage props: `width = round(canvasWidth*zoom)`, `height = round(canvasHeight*zoom)`, `scaleX = scaleY = zoom` (no CSS transform). Events: onMouseMove / onMouseDown / onMouseUp / onDblClick (finish polygon). **No touch handlers** (`onTouchStart` etc. absent) — touch drawing only works insofar as the browser synthesises mouse events.
- Zoom: initial 1 then auto-fit; `fitToContainer` = `min((clientWidth-32)/canvasWidth, (clientHeight-32)/canvasHeight, 1)` to 3 decimals; runs 80 ms after mount / panel toggle and on `window.resize`. Zoom In: `min(3, z+0.1)`; Zoom Out: `max(0.15, z-0.1)` (2 decimals). Zoom indicator shows `Math.round(zoom*100)%`; clicking it = fit.
- Layers (3): (1) paper `Rect` white, stroke `#1e293b` 2px + title block + compass; (2) grid cells, karam dotted subdivisions, cell labels, column/row headers, drawn objects (clipped to cell), scale bar; (3) temp shapes, in-progress polygon, snap indicator.

**Title block (layer 1), all sizes derived from `gridPadding` (P):**
- header band `Rect x1 y1 w=canvasWidth-2 h=P-2 fill #f8fafc`; left accent `Rect x1 y1 w5 h=P-2 fill #0284c7`; bottom border `Line [1,P, canvasWidth-1,P] stroke #1e293b sw 1.5`.
- `titleFontSize = max(15, round(P*0.24))`, `metaFontSize = max(10, round(P*0.135))`, `prepFontSize = max(10, round(P*0.125))`, `titleY = round(P*0.09)`, `divY = round(P*0.44)`, `metaY = round(P*0.50)`, `prepY = round(P*0.74)`.
- `arrowZoneW = max(64, round(P*0.85))`; `R = max(14, min(round(P*0.30), floor((P-10)/2), floor((arrowZoneW-12)/2)))`; `compassCx = canvasWidth - arrowZoneW/2`, `compassCy = round(P/2)`; `textAreaWidth = canvasWidth - arrowZoneW - 24`.
- Title text x12 width textAreaWidth, `metadata.title || 'Aks Shajra Parcha (اکس شجرہ پارچہ)'`, Inter/Arial bold, fill `#0f172a`, align center.
- Divider `Line [canvasWidth*0.12, divY, canvasWidth-arrowZoneW-12, divY] stroke #cbd5e1 sw 0.8`.
- Meta row: `[Tehsil: …, Mouza: …, Murabba No: …, Hadbast: …].filter(Boolean).join('   │   ') || 'Tehsil · Mouza · Murabba No'`, fill `#334155`, center.
- Prepared row (only if preparedBy or checkedBy): `Prepared By: … │ Checked By: …` joined with `'     │     '`, bold, fill `#475569`.
- Compass badge Group at (compassCx, compassCy): `Circle r=R fill #fff stroke #cbd5e1 sw1.4 shadowColor rgba(15,23,42,0.25) blur 4 offsetY 1`; needle kites: `[0,-R*.72, R*.30,0, 0,0] fill #dc2626`; `[0,-R*.72, -R*.30,0, 0,0] fill #ef4444`; `[0,R*.55, R*.30,0, 0,0] fill #e2e8f0 stroke #94a3b8 sw .5`; `[0,R*.55, -R*.30,0, 0,0] fill #f1f5f9 stroke #94a3b8 sw .5`; "N" text x=-R*.32 y=-R+max(1,R*.06) width R*.64 fontSize max(9, round(R*.5)) bold fill #0f172a center.
- `northArrowStyle` (standard/compass/simple/traditional) is stored but **ignored by rendering**.

**Grid (layer 2):**
- Cell rect: fill `isHovered ? 'rgba(56, 189, 248, 0.08)' : '#ffffff'`, stroke `#0f172a`, sw 1.5.
- Karam subdivisions when `showGuide`: `Line stroke #e2e8f0 sw 0.8 dash [2,3]` every `pixelsPerKaram` inside the cell (cellWidthKarams-1 vertical, cellHeightKarams-1 horizontal).
- Cell label at (x+4, y+4): `${r+1}-${String.fromCharCode(65+c)}` (e.g. "1-A"), fontSize 9, fill `#94a3b8`.
- Column headers: letters A,B,C… at (x+cellW/2-8, P-18) fontSize 11 bold `#334155`; row headers numbers 1,2,3… at (P-24, y+cellH/2-6) same style. (Comments in code are swapped; actual: columns = letters, rows = numbers.)
- Objects group per cell clipped to cell rect (`clipX/Y/Width/Height`).
- Scale bar Group at (P, canvasHeight-32): `Rect 0,0 60x4 #0f172a`, `Rect 60,0 60x4 #94a3b8`, text "0" at (0,8) fs 8 `#64748b`, text "100 Karams" at (110,8) fs 8 `#64748b`. (Bar is a fixed 120 px regardless of ppk — not actually 100 karams.)

**Object rendering on master canvas (inverse of editor transform):** `EDITOR_ZOOM = 3.5`, `EDITOR_PAD = 45`, `toCell(v, origin) = origin + (v - 45)/3.5`.
- polygon: `Line points=toCellPts closed fill obj.fill stroke obj.stroke sw max(0.5, (obj.strokeWidth||2)/3.5)` + segment labels (H/V only): badge `Rect w=round(fs*3.6) h=round(fs*1.8) fill rgba(255,255,255,0.92) cornerRadius 2`, text fs `max(6, round(ppk*0.44))` bold fill `#1e40af` (polygon) / `#475569` (line), rotation 0 or 90, LABEL_OFFSET 5 px outward from centroid.
- line: same with `lineCap round`.
- rect: x/y via toCell, width/height / 3.5. circle: radius / 3.5. text: fontSize `max(7, round((fontSize||16)/3.5))`, bold.

**Overlay (layer 3):** temp rect/circle/line use current fill/stroke/strokeWidth with `dash [4,4]`; in-progress polygon `Line stroke #0284c7 sw 2 dash [4,4]` rubber-banded to cursor; vertex dots `Circle r4 fill #0284c7`; snap indicator `Circle r6 fill rgba(16,185,129,0.4) stroke #10b981 sw 2`.

### Cell Editor Stage
- `zoomFactor = 3.5` (fixed), `pixelsPerKaram = (grid.ppk||16)*3.5` (56 by default), `stagePadding = 45`, `stageWidth = cellWidthKarams*ppk + 90`, `stageHeight = cellHeightKarams*ppk + 90` (default 370 x 314).
- `fitScale`: `availW = innerWidth*0.95 - 56`, `availH = innerHeight*0.95 - headerH(measured, fallback 52) - 56`; `s = min(availW/stageWidth, availH/stageHeight, 1)`, clamped >= 0.15, 3 decimals; recomputed at mount, +60 ms, resize, orientationchange. Stage `width/height = round(stage*fitScale)`, `scaleX/Y = fitScale`. Pointer coords divided by fitScale.
- Layer 1: bg `Rect fill #f1f5f9`; cell `Rect at (45,45) fill #fff stroke #0f172a sw 2 shadowColor rgba(0,0,0,0.08) shadowBlur 10`; karam lines every ppk: border lines stroke `#0f172a` sw 2 no dash, inner `#cbd5e1` sw 1 dash `[4,4]`; column headers `K0..Kn` at (x-12, 45-24) fs 11 bold `#64748b`; row headers `K0..Kn` at (45-32, y-6).
- Layer 2 objects: polygon `fill obj.fill||#e8f5e9 stroke obj.stroke||#0f172a sw obj.strokeWidth||2`; area label at centroid when `areaSqKarams > 0.5`: text `formatKaramToArea` fs 11 bold `#047857` at (-25,-6) inside a `scale 1/fitScale` Group; SegLabel badges (rotated parallel to edge, offset 15 px outward): `Rect -22,-9 44x18 cornerRadius 4` fill `rgba(30,64,175,0.85)` (polygon) / `rgba(71,85,105,0.85)` (line) / `rgba(2,132,199,0.85)` (in-progress polygon), text fs 11 bold white centered. Live rubber-band length badge near cursor: `Rect -24,-11 48x22 fill rgba(2,132,199,0.95) cornerRadius 5`, text fs 12 white bold. Polygon vertex dots `Circle r5 fill #0284c7 stroke #fff sw 2`.
- Text objects: fs `obj.fontSize||16`, family `obj.fontFamily||'Inter, Arial'`, fill `obj.fill||#0f172a`, bold.
- Crosshair: dashed lines `rgba(56,189,248,0.45)`, sw `1/fitScale`, dash `[5/fs, 5/fs]`, listening false, spanning the cell only. Coordinate badge (scale-invariant Group): `BW=102, BH=46, GAP=10`; flips below if `spaceAbove < BH+GAP+12`, flips left if `spaceRight < BW+GAP+8`; bg `rgba(15,23,42,0.92)` stroke `rgba(56,189,248,0.55)` sw1, cornerRadius per quadrant (`[6,6,0,6]` default; `[6,0,6,6]` flipY; `[6,6,6,0]` flipX; `[0,6,6,6]` both); H bar 3x22 `#38bdf8`, V bar 3x24 `#34d399`; texts `H: ${karamX} K` / `V: ${karamY} K`, fs 12 bold `'Courier New', monospace`, colours `#38bdf8` / `#34d399`; karamX/Y = `round(max(0,(cursor-45)/ppk))`.
- Snap indicator: `Circle r=7/fitScale fill rgba(16,185,129,0.4) stroke #10b981 sw 2/fitScale`.
- Eraser: shapes carry `name="clickable-object"` and `id=obj.id`; mousedown on such a target with eraser active removes it (polygon Group, Line, Rect, Circle, Text all named).

### Keyboard shortcuts (page level; ignored when focus is in INPUT/TEXTAREA)
`Ctrl/Cmd+Z` undo, `Ctrl/Cmd+Shift+Z` redo, `Ctrl/Cmd+Y` redo, `V` select, `C` cellSelect, `P` polygon, `L` line, `R` rect, `E` eraser. (Tooltips also advertise `O` circle and `T` text, but those are **not** bound.) The Cell Editor has **no** keyboard shortcuts except Enter in the text prompt. Keys are bound while the editor is open too (page undo/redo still fire).

### Mouse gestures
- cellSelect: mousedown inside a cell → open editor.
- polygon: mousedown adds vertex; dblclick finishes (>= 3 vertices → object; otherwise discards).
- rect/circle/line: mousedown sets dragStart, mousemove builds tempShape, mouseup commits (rect from min/abs; circle centre=start radius=hypot; line two points).
- `select`, `text`, `eraser` tools on the master canvas do **nothing** (no handlers).
- Hover highlights cell (`hoveredCell`), also used as target for symbol stamping and as `activeCellKey` highlight in Cells tab.

### Responsive behaviour (CSS)
- `@media (pointer: coarse)`: `.toolbar-btn, .cell-tool-btn, .tab-btn, .panel-close-btn, .legend-del-btn { min-height: 40px; min-width: 40px }`; `.toolbar-select, .form-group input/select { min-height: 40px }`.
- `@media (max-width: 900px)`: left panel becomes fixed drawer `top 48px; bottom 0; left 0; width min(320px, 84vw); margin-left 0 !important; box-shadow 8px 0 32px rgba(0,0,0,0.5)`; `.closed { transform: translateX(-100%) }`; backdrop `display block; fixed; top 48px; bg rgba(0,0,0,0.5); z 49`; canvas container padding 8px; cell editor overlay padding 0, container `100vw x 100vh, radius 0`; header `height auto; flex-wrap; padding 8px 10px; gap 8px`; order: `.cell-header-left` 1, `.cell-header-actions` 2, `.cell-editor-tools` 3 (each `flex: 1 1 100%`); canvas wrapper padding 8px.
- `@media (max-width: 520px)`: toolbar 44px; `.toolbar-btn { padding 0 6px; font-size .76rem }`; `.cell-header-title .72rem`; `.cell-badge-large .75rem`; `.cell-tool-btn { font-size .72rem; padding 6px 7px }`; `.btn-cancel/.btn-apply-save/.btn-clear-cell { padding 6px 9px; font-size .76rem }`; `.symbols-grid` 1 column; `.text-prompt-modal { min-width 0; width calc(100vw - 32px) }`; `.shajra-exit-btn { top 8px; left 8px; padding 5px 9px; font-size .72rem }`.
- Toolbar never wraps: `overflow-x auto`, groups `flex-shrink 0`, 4 px scrollbar.

---

## 3. `shajraConstants.js` — every constant

```js
KARAM_FEET = 5.5; KARAMS_PER_MARLA = 9; MARLAS_PER_KANAL = 20; KANALS_PER_ACRE = 8;

PAPER_SIZES = {
  A4:    { name:'A4',    widthMm:210, heightMm:297, pixelRatio:3.7795 },
  A3:    { name:'A3',    widthMm:297, heightMm:420, pixelRatio:3.7795 },
  A2:    { name:'A2',    widthMm:420, heightMm:594, pixelRatio:3.7795 },
  Legal: { name:'Legal', widthMm:216, heightMm:356, pixelRatio:3.7795 },
};
SCALE_OPTIONS = [ {label:'1:250',value:250}, {label:'1:500',value:500}, {label:'1:1000',value:1000},
                  {label:'1:1250',value:1250}, {label:'1:2500',value:2500}, {label:'1:5000',value:5000} ];
NORTH_ARROW_STYLES = [ {id:'standard',name:'Standard Arrow'}, {id:'compass',name:'Compass Rose'},
                       {id:'simple',name:'Minimalist'}, {id:'traditional',name:'Traditional Patwari'} ];
PRESET_SYMBOLS = [
  { id:'well',      name:'Kuan / Well (چاہ / کنواں)',    icon:'⭕', color:'#0284c7' },
  { id:'tube_well', name:'Tube-well (ٹیوب ویل)',          icon:'⚙️', color:'#0369a1' },
  { id:'tree',      name:'Tree (درخت)',                   icon:'🌳', color:'#15803d' },
  { id:'mosque',    name:'Mosque (مسجد)',                 icon:'🕌', color:'#047857' },
  { id:'graveyard', name:'Graveyard (قبرستان)',           icon:'⚰️', color:'#64748b' },
  { id:'house',     name:'Dera / House (ڈیرہ / مکان)',    icon:'🏠', color:'#b45309' },
  { id:'culvert',   name:'Pulia / Culvert (پلیہ)',        icon:'═',  color:'#334155' },
];
DEFAULT_LEGEND = [
  { id:'l1', color:'#e8f5e9', stroke:'#15803d', label:'Agriculture Land (اراضی زرعی)' },
  { id:'l2', color:'#e0f2fe', stroke:'#0284c7', label:'Watercourse / Khal (کھال / نالہ)' },
  { id:'l3', color:'#f1f5f9', stroke:'#475569', label:'Rasta / Pathway (راستہ عام)' },
  { id:'l4', color:'#fef3c7', stroke:'#d97706', label:'Abadi Deh (آبادی دہ)' },
];
INITIAL_PROJECT_STATE = {
  metadata: { title:'Aks Shajra Parcha (اکس شجرہ پارچہ)', village:'', mauza:'', hadbastNo:'', murabba:'',
              tehsil:'', district:'', date: new Date().toISOString().split('T')[0], preparedBy:'', checkedBy:'',
              scale:'1:1000', paperSize:'A3', orientation:'portrait' },
  grid: { rows:8, cols:8, cellWidthKarams:5, cellHeightKarams:4, pixelsPerKaram:16 },
  cells: {},           // { 'r0c0': { label:'r0c0', objects:[...] } }
  legend: DEFAULT_LEGEND,
  northArrowStyle: 'standard',
};
karamsToFeet(k) = k*5.5; feetToKarams(f) = f/5.5;
formatKaramToArea(sqKarams): marlas = sqK/9; if marlas<20 → `${marlas.toFixed(1)} Marlas`
   else `${Math.floor(marlas/20)}K ${(marlas%20).toFixed(1)}M`
formatLinearKaram(k): k<0.05 → ''; else `${(Math.round(k*10)/10).toFixed(1)}K`
```
`village` key exists in metadata but has no UI. Note `DEFAULT_LEGEND` is shared by reference (legend edits mutate `updated[idx].color` in place → mutates the constant object).

---

## 4. Toolbar buttons and left-panel controls

### TopToolbar (`.shajra-toolbar`, left to right; groups separated by `.toolbar-divider`)
Labels (`.btn-label`) are hidden by CSS except on `.metadata-btn`, `.export-btn`, `.toolbar-btn--labeled` (the last class is never used). All buttons are `.toolbar-btn` unless noted.

| # | Button | Icon | Label (hidden) | Title tooltip | Active class | Action |
|---|---|---|---|---|---|---|
| 1 | Panels | `FaTh` | Panels | Toggle Grid / Layers Panel | `.active` when panel open | toggle `showLeftPanel` |
| 2 | New | `📄` (span) | New | New Project | – | confirm → reset state |
| 3 | Save | `FaSave` | Save | Save JSON Project | – | download JSON |
| 4 | Open | `FaFolderOpen` | Open | Open JSON Project | – | hidden `<input type=file accept=".json">` |
| — | divider | | | | | |
| 5 | Undo | `FaUndo` | – | Undo (Ctrl+Z) | disabled if `!canUndo` | |
| 6 | Redo | `FaRedo` | – | Redo (Ctrl+Y) | disabled if `!canRedo` | |
| — | divider | | | | | |
| 7 | Select | `FaMousePointer` | – | Select / Move Object (V) | `.active` tool=select | no-op tool |
| 8 | Cell Edit | bold `⊞` span | Cell Edit | Cell Select / Zoom Mode (C) - Click cell to edit | tool=cellSelect (default) | |
| 9 | Polygon | `FaDrawPolygon` | – | Draw Land Polygon (P) - Click points, double-click to finish | tool=polygon | |
| 10 | Line | `FaPencilAlt` | – | Draw Line / Boundary / Khal (L) | tool=line | |
| 11 | Rect | `FaVectorSquare` | – | Draw Rectangle Plot / Room (R) | tool=rect | |
| 12 | Circle | `FaCircle` | – | Draw Well / Roundabout / Tree (O) | tool=circle | |
| 13 | Text | `FaFont` | – | Add Khasra # / Name Text (T) | tool=text | no-op on master |
| 14 | Eraser | `FaEraser` | – | Eraser / Delete Object (E) | tool=eraser | no-op on master |
| — | divider | | | | | |
| 15 | Fill picker | `label.color-picker-wrapper` "Fill" + `<input type=color>` | | Fill Color | | value `fillColor==='transparent' ? '#ffffff' : fillColor` |
| 16 | Transparent toggle | `.mini-pill-btn` text `🚫` when transparent else `Fill` | | Toggle Transparent Fill | `.active` when transparent (red) | toggles between `'transparent'` and `'#e8f5e9'` |
| 17 | Line picker | `.color-picker-wrapper` "Line" + color input | | Stroke / Line Color | | |
| 18 | Width select | `.toolbar-select` | | Line Width | | options `1 px`, `2 px`, `3 px (Thick)`, `5 px (Boundary)` (values 1,2,3,5) |
| 19 | Dash select | `.toolbar-select` | | Line Dash Style | | `solid` "Solid ──", `dashed` "Dashed - -", `dotted` "Dotted · ·" — **dashStyle is never applied to any shape** |
| — | divider | | | | | |
| 20 | Snap | `FaMagnet` | Snap | Magnet Snap to Karam Intersections (ON/OFF) | `.active-accent` (green) | toggle `snapEnabled` (default true) |
| 21 | Karams | `📏` span (font-size .85rem) | Karams | Show Minor Karam Subdivisions (ON/OFF) | `.active-accent` | toggle `showGuide` (default true) |
| — | divider | | | | | |
| 22 | Zoom Out | `FaSearchMinus` | – | Zoom Out | | −0.1 (min 0.15) |
| 23 | `span.zoom-indicator` `${round(zoom*100)}%` | | | Reset Zoom | | click = fit |
| 24 | Zoom In | `FaSearchPlus` | – | Zoom In | | +0.1 (max 3) |
| 25 | Fit | `FaExpand` | – | Fit to Screen | | fit |
| — | `.toolbar-group.ms-auto` (right aligned) | | | | | |
| 26 | Metadata | `FaInfoCircle` | **Metadata** (visible) | Map Title, Village & Metadata | `.metadata-btn` purple | open MapMetadataModal |
| 27 | Export Map | `FaFileDownload` | **Export Map** (visible) | Export Map to PDF, PNG or SVG | `.export-btn` blue gradient | open ExportModal |

Page-level defaults: `activeTool='cellSelect'`, `strokeColor='#0f172a'`, `fillColor='#e8f5e9'`, `strokeWidth=2`, `dashStyle='solid'`, `snapEnabled=true`, `showGuide=true`.

### LeftPanel
Header `.panel-header`: tabs (`.tab-btn`, icon + text): `FaCog` **Grid** (title "Grid & Paper Setup"), `FaLayerGroup` **Cells** ("Drawn Layers / Cells"), `FaStamp` **Symbols** ("Patwari Symbols Library"), `FaMapMarkerAlt` **Legend** ("Map Legend"); right: `.panel-close-btn` `FaTimes` ("Close Panel"). Default tab `grid`.

**Grid tab**
- `h6.section-title` "📐 Master Grid Setup"; `<form onSubmit=handleApplyGrid>`:
  - `.form-row-2`: "Rows (سطریں)" number min1 max30; "Cols (کالم)" number min1 max30.
  - `.form-row-2`: "Cell Width (Karams)" number min1 + `.field-hint` `${(w*5.5).toFixed(1)} ft`; "Cell Height (Karams)" + hint.
  - "Display Density (Pixels per Karam)": `.range-with-val` range min10 max32 + `<span>{n}px</span>`.
  - `button.apply-btn[type=submit]` "Apply Grid Changes". Clamps on apply: rows/cols `max(1,min(30, parseInt||8))`, width `max(1, parseInt||5)`, height `max(1, parseInt||4)`, ppk `max(8,min(40, parseInt||16))`. Temp inputs are initialised once from props (not re-synced after Open/New/Undo).
- `.divider-hr`; `h6.section-title` "📄 Paper & Layout":
  - "Paper Size" select: options `${name} (${widthMm} × ${heightMm} mm)` for A4/A3/A2/Legal → commits `metadata.paperSize` immediately.
  - "Orientation": two `.toggle-pill` buttons "Portrait (عمودی)" / "Landscape (افقی)" (`.active`).
  - "Cadastral Scale" select of SCALE_OPTIONS labels (value = label string e.g. `'1:1000'`).

**Cells tab**: "📂 Grid Cells & Objects"; if no cells: `.empty-hint` "No drawn objects yet. Click any cell on the canvas to open the **Cell Editor** and draw khasras, lines, or labels!"; else for each cell with objCount>0: `.cell-layer-item` (`.active` when `activeCellKey===cellKey`, i.e. hovered cell) → `.cell-item-info`: `span.cell-tag` cellKey, `span.cell-label` `cell.label || Cell ${key}`, `span.cell-badge` `${n} objects`; click → open editor.

**Symbols tab**: "🏛️ Cadastral Symbols"; `.section-subtitle` "Click a symbol to place on active canvas / selected cell:"; `.symbols-grid` 2 cols of `.symbol-card` (title `Add ${name}`): `.symbol-icon` emoji (1.4rem) + `.symbol-name`. Click → `handleAddSymbol` (text obj at hovered cell centre, **stored in master-canvas coords**, fontSize 24, fill symbol.color, id `sym_${Date.now()}`).

**Legend tab**: header row `d-flex justify-content-between` "🏷️ Map Legend" + `button.btn-link-add` `FaPlus` "Add"; `.legend-items` rows `.legend-row`: `input[type=color].legend-color-input` (item.color), `input[type=text].legend-text-input` (item.label), `button.legend-del-btn` `FaTrash`. Every keystroke commits a history entry.

### CellEditorModal header controls (`.cell-editor-header`)
Left `.cell-header-left`: `span.cell-badge-large` `Cell: ${cellKey}`; `span.cell-header-title` `${w} × ${h} Karams (${w*5.5} × ${h*5.5} ft)` (1 decimal).
Tools `.cell-editor-tools` (`.cell-tool-btn`): `FaDrawPolygon` Polygon (title "Draw Polygon (Click vertices, click 'Finish' or double-click)"); conditional `button.finish-poly-btn` `FaCheck` "Close Polygon" when `currentPoints.length >= 6`; `FaPencilAlt` Line ("Draw Boundary Line (Drag start to end)"); `FaVectorSquare` Rect ("Rectangle Plot"); `FaCircle` Well ("Circle / Well"); `FaFont` Label ("Add Khasra # / Name Text"); `FaEraser` Erase ("Eraser (Click any drawn shape to delete)"); `.vert-sep`; `label.cell-color-btn` "Fill" color input; "Line" color input; `FaMagnet` Snap (`.active-accent`, title "Toggle Snap to Karam intersections"); `FaUndo` (disabled `historyIndex<=0`); `FaRedo` (disabled at end).
Actions `.cell-header-actions`: `button.btn-cancel` "Cancel"; `button.btn-clear-cell` `FaTrash` "Clear Cell" (title "Delete all shapes drawn in this cell (Kill)", `window.confirm('Clear all drawings in this cell? This cannot be undone.')` → `pushState([])` — actually undoable within the editor); `button.btn-apply-save` `FaCheck` "Save Cell".
Editor defaults: tool `polygon`, stroke `#1e293b`, fill `#e8f5e9`, strokeWidth 2 (no width selector in editor), snap on.
Text prompt `.text-prompt-modal`: `h6` "Enter Khasra #, Area, or Label"; input autoFocus placeholder "e.g. Khasra 1234 (4K 12M)", Enter saves; buttons "Cancel" and `.confirm-btn` "Place Label". Saved text: `{ id:'txt_…', type:'text', x,y, text, fontSize:16, fontFamily:'Inter, Arial', fill: strokeColor }` (empty/whitespace ignored).

---

## 5. Modals — fields, validation, buttons, outputs

### MapMetadataModal (react-bootstrap `Modal centered size="lg" className="shajra-modal"`)
Header `.modal-header-custom` with closeButton, title "📜 Aks Shajra Map Information & Title Block". Body `.modal-body-custom` `<Form>` with `Form.Label.field-title` and `Form.Control` (all `type="text"` unless noted, no validation, no required):
- Row: `Col md=12` Map Title (عنوان نقشہ) name=`title`, placeholder "Aks Shajra Parcha (اکس شجرہ پارچہ)".
- Row (3 x `md=4`): Mauza / Village (موضع / چک) `mauza` ph "e.g. Mauza Rustam"; Murabba / Mutateel No (مربع / متعالل نمبر) `murabba` ph "e.g. 12 / M-5"; Hadbast Number (نمبر حد بست) `hadbastNo` ph "e.g. 142".
- Row (2 x `md=6`): Tehsil (تحصیل) `tehsil` ph "e.g. Bahawalpur"; District (ضلع) `district` ph "e.g. Bahawalpur".
- Row: Prepared By (تیار کنندہ / پٹواری) `preparedBy` ph "e.g. Patwari Muhammad Ahmad"; Checked By (تصدیق کنندہ / گرداور / قانونگو) `checkedBy` ph "e.g. Qanungo / Naib Tehsildar".
- Row: Date (تاریخ) `type="date"` `date`; North Arrow Style `Form.Select` of NORTH_ARROW_STYLES.
Footer `.modal-footer-custom`: `Button variant="secondary"` Cancel (onClose), `Button variant="primary"` "Save Metadata" → `onSaveMetadata(formData)` then `onSaveNorthArrowStyle(selectedArrow)` (two separate history commits) then close. `formData` is initialised once (`useState({...metadata})`) — since the modal is always mounted, it does **not** refresh when metadata changes via Open/New/Undo (stale form).

### ExportModal (`Modal centered size="md" className="shajra-modal"`)
Title "📥 Export Cadastral Shajra Map". Body: `label.field-title` "Select Export Format"; `.d-flex.gap-2` of three `.format-card` (`.active`):
- PDF: `FaFilePdf.format-icon.text-danger`, `.format-title` "PDF Document", `.format-desc` "Official Print (Title, Scale, Legend)".
- PNG: `FaFileImage.text-primary`, "PNG Image", "High Resolution Image".
- SVG: `FaCode.text-success`, "Vector / Web", "Lossless Quality".
Default `pdf`. Conditional `.export-options-box.p-3.bg-light.rounded.border.mb-3` (Bootstrap light box inside dark modal):
- pdf: rows "Paper Format:" → `${PAPER_SIZES[paperSize]?.name||'A3'} (Portrait|Landscape)`; "Cadastral Scale:" → `scale||'1:1000'`; "Included Elements:" → `.text-success.small.fw-bold` "✓ Title Block ✓ Scale Bar ✓ North Arrow ✓ Legend".
- png: `Form.Label.field-title` "Image Quality / Resolution"; `Form.Select` pngDpi: `2` "Standard DPI (2x)", `3` "High Quality DPI (3x - Recommended)" (default), `4` "Ultra High DPI (4x - Large Print)".
Footer: `Button secondary` Cancel (disabled while exporting); `Button primary` → while exporting `Spinner border sm me-2` + "Generating File..." else `FaCheck me-1` + `Export ${FORMAT}`. Errors: `console.error` + `alert('Failed to generate export file. Please ensure canvas has finished rendering.')`.
Outputs: pdf → `${(mauza||'aks_shajra').replace(/\s+/g,'_').toLowerCase()}_shajra_map.pdf`; png → `${(mauza||'aks_shajra').replace(/\s+/g,'_')}_map.png` (case preserved) at pixelRatio `Number(pngDpi)`; svg → same PNG path at pixelRatio 3 (no SVG is produced).

### CellEditorModal — see section 4; output is `onSaveCell(cellKey, { label: cellData?.label || cellKey, objects })`.

**API calls: none.**

---

## 6. Geometry utilities and formulas to preserve

- `getClosestSnapPoint(point, candidates, threshold=12)`: Euclidean `Math.hypot`, strict `<` threshold, returns `{...closest, distance}` or null. Master canvas threshold 16 (stage units, pre-zoom), editor 18 (stage units, so visual threshold = 18*fitScale).
- Snap candidates: master = every grid-cell corner `(P + c*cellW, P + r*cellH)` for r in 0..rows, c in 0..cols; editor = every karam intersection `(45 + col*ppk, 45 + row*ppk)` with `karamX/karamY`.
- `calculatePolygonArea(flatPts)` shoelace `|Σ(x_i*y_{i+1} - x_{i+1}*y_i)|/2`, returns 0 if < 3 points. Area in sq karams = `px² / ppk²` (editor ppk = 3.5*grid ppk).
- `calculateCentroid` = arithmetic mean of vertices (not area-weighted).
- `simplifyPath` RDP (tolerance 2) — exported but **unused**.
- Editor→master affine: `master = cellOrigin + (editor − 45) / 3.5`; strokes `/3.5` (min 0.5); font `/3.5` (min 7). There is **no** inverse applied when objects are created on the master canvas (see gotchas).
- Segment label placement: midpoint + unit normal `(−dy, dx)/len` × offset (15 editor / 5 master), flipped away from centroid (dot product > 0 → flip); for open polylines flip so horizontal labels go above (`ny>0` → flip) and vertical go left (`nx>0` → flip). Editor rotation `atan2(dy,dx)` deg normalised to (−90, 90]; master only labels near-H/V segments (`HV_THRESH = ppk*0.10`) with rot 0/90.
- No georeferencing / real-world CRS anywhere; scale selection is cosmetic text.

---

## 7. Export pipeline

- **JSON**: `exportProjectJSON(state, name)` → `Blob application/json`, `JSON.stringify(_, null, 2)`, anchor download, `URL.revokeObjectURL`. Name `${metadata.mauza || 'aks_shajra'}.json` (spaces kept).
- **PNG** (`exportStageToPNG(stageRef, metadata, fileName, pixelRatio=3)`): `stage.toDataURL({ pixelRatio })` (captures at current zoom × pixelRatio, so output size depends on on-screen zoom), drawn into an offscreen canvas, then a footer strip: `stripH = round(H*0.04)`, font `max(12, round(stripH*0.45))px "Inter", Arial, sans-serif`, fill strip `rgba(15,23,42,0.82)`, text `#f8fafc`, baseline middle, x 14, y `H - stripH/2`; text = `[title, 'Tehsil: …', 'Mouza: …', 'Murabba: …', 'Hadbast: …', 'Scale: …', 'Prepared By: …', 'Checked By: …', 'Date: ' + (date||today)].filter(Boolean).join('   |   ')`. The strip overlays the bottom 4 % of the image (covers the scale bar area). Download via `canvas.toDataURL('image/png')`. Async (img.onload) — modal closes before it finishes.
- **PDF** (`exportToPDF`): `new jsPDF({ orientation, unit:'mm', format:[widthMm,heightMm] })`; `margin 10`; outer border lw 0.8 color (20,30,60); inner border lw 0.2 inset 1.5; header `headerHeight 34` fill (248,250,252), left accent 3 mm fill (2,132,199); title helvetica bold 17 color (15,23,42) centred at y margin+9; divider (203,213,225) lw 0.3 from 12 % to 88 % at y margin+16; info row helvetica 9 color (51,65,85): left `Mouza: | Murabba No: | Hadbast: | Tehsil: | District:` joined `'  |  '` (or '—') at (margin+7, margin+21), right `Scale: ${metadata.scale||scale}   Date: …` right-aligned at margin+contentWidth−5; prepared/checked line bold 12 at y margin+29.5 joined `'     |     '`. Map: `footerHeight 26`, `mapTop = margin+1.5+34+2`, `availH = contentHeight-34-26-7`, `availW = contentWidth-6`; image `stage.toDataURL({ pixelRatio: 2.5 })` aspect-fit, centred, border lw 0.3 (180,190,205). Footer line at `footerTop = margin+contentHeight-26-1.5` lw 0.4 (20,30,60); "Scale Bar:" bold 8 (30,41,59) at (margin+6, footerTop+7); bar: filled rect (30,41,59) 15x3 at margin+26, white 15x3 at margin+41, outline 30x3; labels "0" and "100 Karams (550 ft)" size 7 at footerTop+11. North badge: `naR = min(26/2−3, 8) = 8`, `naCx = margin+contentWidth−14−naR`, `naCy = footerTop+13`; circle fill white stroke (203,213,225) lw 0.3; triangles (220,38,38), (239,68,68), (226,232,240), (241,245,249) with `0.72/0.34/0.55` factors; "N" bold `max(6, naR*0.85)` (15,23,42) at naCy−naR*0.62; caption "NORTH (شمال)" size 7 (71,85,105) at footerTop+24 (Arabic will render as garbage in Helvetica). `doc.save(...)`. Legend param accepted but **never drawn**.
- No SVG, GeoJSON or KMZ export. html2canvas unused.

---

## 8. Exact styling (AksShajra.css + inline)

Palette (Tailwind slate/sky/emerald/red/purple): bg `#0f172a`, panel `#1e293b`, canvas backdrop `#334155`, text `#e2e8f0` / `#f1f5f9` / `#f8fafc`, muted `#94a3b8` / `#64748b` / `#cbd5e1`, accent `#38bdf8`, primary `#0284c7` → hover `#0369a1` → `#075985`, success `#10b981` / `#34d399` / `#059669`, danger `#ef4444` / `#f87171` / `#dc2626` / `#b91c1c`, purple `rgba(168,85,247,…)` / `#c084fc`.

Key rules (verbatim values):
- `.aks-shajra-root`: flex column; 100vh/100vw; overflow hidden; bg `#0f172a`; font `'Inter', system-ui, -apple-system, sans-serif`; `user-select: none`.
- `.shajra-toolbar`: h 48px; bg `linear-gradient(135deg, rgba(15,23,42,0.95), rgba(30,41,59,0.98))`; border-bottom `1px solid rgba(255,255,255,0.12)`; padding `0 8px`; gap 4px; shadow `0 4px 12px rgba(0,0,0,0.35)`; z 100; color `#e2e8f0`; overflow-x auto; scrollbar-width thin; scrollbar-color `rgba(255,255,255,0.2) transparent`; webkit scrollbar h 4px thumb `rgba(255,255,255,0.18)` radius 2px.
- `.toolbar-group` gap 3px flex-shrink 0. `.toolbar-divider` 1x22px `rgba(255,255,255,0.15)` margin `0 3px`.
- `.toolbar-btn`: bg `rgba(255,255,255,0.05)`; border `1px solid rgba(255,255,255,0.1)`; color `#e2e8f0`; h 30px; padding `0 8px`; radius 6px; font .82rem; gap 5px; transition `all 0.15s ease`; nowrap. Hover: bg `rgba(255,255,255,0.15)`, color `#38bdf8`, border `rgba(56,189,248,0.4)`. `.active`: bg `#0284c7`, color `#fff`, border `#38bdf8`, shadow `0 0 10px rgba(2,132,199,0.5)`. `.active-accent`: bg `rgba(16,185,129,0.2)`, color `#34d399`, border `#10b981`. `:disabled` opacity .4, cursor not-allowed.
- `.btn-label`: .72rem, 500, `display:none`; shown for `.metadata-btn`, `.export-btn`, `.toolbar-btn--labeled`.
- `.color-picker-wrapper`: gap 4px; bg `rgba(255,255,255,0.05)`; border `1px solid rgba(255,255,255,0.1)`; padding `2px 6px`; radius 6px; color input 20x20 no border. `.color-label` .75rem `#94a3b8`.
- `.mini-pill-btn`: bg `rgba(255,255,255,0.08)`; border `rgba(255,255,255,0.12)`; color `#94a3b8`; .72rem; padding `3px 6px`; radius 4px. `.active`: bg `rgba(239,68,68,0.2)`, color `#f87171`, border `#ef4444`.
- `.toolbar-select`: bg `#1e293b`; border `1px solid rgba(255,255,255,0.15)`; color `#f1f5f9`; h 32px; radius 6px; .78rem; padding `0 6px`.
- `.zoom-indicator`: .78rem; 600; `#38bdf8`; padding `0 4px`.
- `.metadata-btn`: bg `rgba(168,85,247,0.15)`; border `rgba(168,85,247,0.4)`; color `#c084fc`; hover bg `rgba(168,85,247,0.3) !important`, color `#fff !important`.
- `.export-btn`: bg `linear-gradient(135deg, #0284c7, #0369a1)`; border `#38bdf8`; color `#fff`; 600; shadow `0 2px 8px rgba(2,132,199,0.4)`; hover `linear-gradient(135deg, #0369a1, #075985) !important`.
- `.shajra-workspace`: flex; flex 1; overflow hidden; relative.
- `.shajra-canvas-container` — **defined twice; the second wins**: flex 1; overflow auto; flex centered (`align-items:center; justify-content:center`); bg `#334155`; `background-image: radial-gradient(rgba(255,255,255,0.08) 1px, transparent 0)`; `background-size: 20px 20px`; relative; **padding 40px** (first def had `#0f172a`, flex-start, 16px, `min-width:0` — min-width:0 still applies as it isn't overridden).
- `.shajra-stage-wrapper` — merged: `display:inline-block; line-height:0; border-radius:4px; background:#ffffff; box-shadow: 0 20px 50px rgba(0,0,0,0.5)` (second def overrides the first `0 8px 32px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.08)`); `transition: transform 0.1s ease-out`.
- `.shajra-left-panel`: w 320px; bg `#1e293b`; border-right `1px solid rgba(255,255,255,0.1)`; flex column; transition `transform 0.25s ease, margin-left 0.25s ease`; z 50; flex-shrink 0. `.closed { margin-left:-320px }`.
- `.panel-header`: h 48px; bg `#0f172a`; border-bottom `rgba(255,255,255,0.08)`; padding `0 8px`. `.panel-tabs` gap 2px.
- `.tab-btn`: no bg/border; color `#94a3b8`; .75rem; 600; padding `6px 8px`; radius 4px; gap 4px. hover color `#e2e8f0` bg `rgba(255,255,255,0.05)`. `.active` color `#38bdf8` bg `rgba(56,189,248,0.12)`.
- `.panel-close-btn`: color `#64748b`; .85rem; padding 6px; radius 4px; hover `#f87171`.
- `.panel-body`: flex 1; overflow-y auto; padding 16px; color `#e2e8f0`.
- `.section-title`: .82rem; 700; uppercase; letter-spacing .04em; `#38bdf8`; mb 12px. `.section-subtitle` .75rem `#94a3b8` mb 10px.
- `.form-row-2` flex gap 10px mb 10px. `.form-group` flex 1 mb 10px; label block .75rem `#94a3b8` mb 4px; input/select: w 100%; bg `#0f172a`; border `1px solid rgba(255,255,255,0.12)`; color `#f8fafc`; padding `6px 8px`; radius 6px; .82rem. `.field-hint` .7rem `#64748b` mt 2px. `.range-with-val` gap 8px; span .75rem `#38bdf8` 600 w 38px.
- `.apply-btn`: w 100%; bg `#0284c7`; white; padding 8px; radius 6px; .82rem; 600; mt 8px; hover `#0369a1`.
- `.divider-hr` 1px `rgba(255,255,255,0.08)` margin `16px 0`. `.orientation-btns` gap 6px. `.toggle-pill`: flex 1; bg `#0f172a`; border `rgba(255,255,255,0.12)`; `#94a3b8`; padding 6px; radius 6px; .75rem; `.active` bg `#0284c7` white border `#38bdf8`.
- `.cell-list` column gap 6px. `.cell-layer-item`: bg `#0f172a`; border `1px solid rgba(255,255,255,0.08)`; padding `8px 10px`; radius 6px; hover border `#38bdf8`; `.active` border `#38bdf8` bg `rgba(2,132,199,0.15)`. `.cell-tag` .72rem 700 bg `#334155` `#e2e8f0` padding `2px 6px` radius 4px. `.cell-label` .8rem 500. `.cell-badge` .7rem `#94a3b8`.
- `.empty-hint`: .8rem; `#94a3b8`; lh 1.4; bg `rgba(255,255,255,0.02)`; padding 12px; radius 6px; border `1px dashed rgba(255,255,255,0.1)`.
- `.symbols-grid` grid 2 cols gap 8px. `.symbol-card`: bg `#0f172a`; border `rgba(255,255,255,0.08)`; radius 6px; padding 8px; column centred gap 4px; hover border `#38bdf8` bg `rgba(56,189,248,0.1)` `translateY(-1px)`. `.symbol-icon` 1.4rem. `.symbol-name` .72rem center `#cbd5e1`.
- `.btn-link-add` no bg/border `#38bdf8` .75rem 600 gap 4px. `.legend-items` gap 8px. `.legend-row` gap 6px. `.legend-color-input` 24x24. `.legend-text-input`: flex 1; bg `#0f172a`; border `rgba(255,255,255,0.1)`; `#f8fafc`; padding `4px 6px`; radius 4px; .78rem. `.legend-del-btn` `#64748b` padding 4px hover `#ef4444`.
- `.cell-editor-overlay`: fixed inset 0; bg `rgba(15,23,42,0.85)`; `backdrop-filter: blur(8px)`; z 9999; flex centred; padding 24px.
- `.cell-editor-container`: bg `#1e293b`; border `1px solid rgba(255,255,255,0.15)`; radius 12px; shadow `0 25px 50px -12px rgba(0,0,0,0.6)`; flex column; max 95vw/95vh; overflow hidden.
- `.cell-editor-header`: h 52px; bg `#0f172a`; border-bottom `rgba(255,255,255,0.1)`; padding `0 16px`; gap 16px; flex-shrink 0.
- `.cell-badge-large`: bg `#0284c7`; white; 700; .82rem; padding `3px 8px`; radius 4px; mr 8px. `.cell-header-title` `#94a3b8` .85rem. `.cell-editor-tools` gap 6px.
- `.cell-tool-btn`: bg `rgba(255,255,255,0.08)`; border `rgba(255,255,255,0.12)`; `#cbd5e1`; padding `4px 8px`; radius 4px; .78rem; gap 4px; hover bg `rgba(255,255,255,0.18)` `#38bdf8`; `.active` bg `#0284c7` white border `#38bdf8`; `.active-accent` as toolbar.
- `.finish-poly-btn`: bg `#10b981`; white; padding `4px 10px`; radius 4px; .78rem; 600.
- `.cell-color-btn`: gap 4px; bg `rgba(255,255,255,0.05)`; border `rgba(255,255,255,0.1)`; padding `2px 6px`; radius 4px; .72rem; `#94a3b8`; color input 18x18. `.vert-sep` 1x20 `rgba(255,255,255,0.15)` margin `0 4px`. `.cell-header-actions` gap 8px.
- `.btn-cancel`: transparent; border `1px solid rgba(255,255,255,0.2)`; `#94a3b8`; padding `5px 12px`; radius 6px; .8rem; hover `#f1f5f9` border `rgba(255,255,255,0.4)`.
- `.btn-apply-save`: bg `#10b981`; white; padding `5px 14px`; radius 6px; .82rem; 600; gap 6px; hover `#059669`.
- `.btn-clear-cell`: bg `#dc2626`; white; padding `5px 12px`; radius 6px; .82rem; 600; gap 6px; hover `#b91c1c`.
- `.cell-canvas-wrapper`: overflow hidden; flex 1; padding 24px; centred; bg `#090d16`. `.cell-stage`: shadow `0 10px 30px rgba(0,0,0,0.5)`; radius 8px; line-height 0.
- `.text-prompt-modal`: absolute centre (`translate(-50%,-50%)`); bg `#1e293b`; border `1px solid #38bdf8`; padding 20px; radius 10px; shadow `0 20px 40px rgba(0,0,0,0.6)`; z 10000; min-width 320px. `h6` `#f8fafc` .9rem mb 12px. input: bg `#0f172a`; border `rgba(255,255,255,0.2)`; `#f8fafc`; padding `8px 10px`; radius 6px; .85rem; mb 14px. actions right-aligned gap 8px; buttons transparent border `rgba(255,255,255,0.2)` `#94a3b8` padding `5px 12px` radius 6px .8rem; `.confirm-btn` bg `#0284c7` white no border 600.
- `.shajra-modal .modal-content`: bg `#1e293b`; `#f1f5f9`; border `1px solid rgba(255,255,255,0.15)`; radius 12px. `.modal-header-custom`: bg `#0f172a`; border-bottom `rgba(255,255,255,0.1)`; color `#38bdf8`. `.modal-body-custom` padding 20px. `.modal-footer-custom` bg `#0f172a` border-top `rgba(255,255,255,0.1)`. `.field-title` .82rem 600 `#94a3b8`.
- `.format-card`: flex 1; bg `#0f172a`; border `rgba(255,255,255,0.1)`; padding 14px; radius 8px; center; hover border `#38bdf8`; `.active` border `#0284c7` bg `rgba(2,132,199,0.15)`. `.format-icon` 2rem mb 8px. `.format-title` 700 .9rem `#f8fafc`. `.format-desc` .72rem `#94a3b8` mt 4px.
- `.shajra-exit-btn`: absolute top/left 16px; z 40; bg `rgba(15,23,42,0.85)`; border `1px solid rgba(255,255,255,0.2)`; `#38bdf8`; padding `6px 12px`; radius 6px; .8rem; 600; gap 6px; `backdrop-filter: blur(4px)`.
- `.shajra-panel-backdrop` display none (desktop).
- Inline: `⊞` span `fontWeight:bold`; `📏` span `fontSize:'0.85rem'`; modal title emoji spans `marginRight:'8px'`; hidden file input `display:none`.
- Bootstrap utility classes used: `d-flex justify-content-between align-items-center mb-2 mb-0 ms-auto gap-2 mb-4 p-3 bg-light rounded border mb-3 text-muted text-dark text-success small fw-bold me-2 me-1 text-danger text-primary`.

Konva colours are listed in section 2.

---

## 9. Storage keys

- `localStorage['aks_shajra_draft']` — full `projectState` JSON, written on every change (useEffect on projectState), read once at mount (silently ignores parse errors). No versioning/migration. No sessionStorage. No other keys.

---

## Gotchas / fragile behaviours

1. **Coordinate-space mismatch on master canvas drawing.** Objects drawn directly on the master canvas (polygon/rect/circle/line tools, and stamped symbols) are stored in *master* pixel coords, but all objects are rendered through the editor inverse transform `(v − 45)/3.5 + cellOrigin`, so they appear shrunk/misplaced and are clipped to the cell; the same objects then appear wrongly inside the Cell Editor. Only Cell-Editor-drawn objects round-trip correctly. A faithful rebuild must either replicate this or (better) convert; flag to the user.
2. `EDITOR_ZOOM 3.5` / `EDITOR_PAD 45` are baked into saved JSON/localStorage data — changing them breaks every saved project. Saved coordinates also depend on `grid.pixelsPerKaram` at the time of drawing; changing ppk later rescales nothing (shapes keep pixel coords → wrong karam sizes). Changing rows/cols keeps `cells` keyed `r{r}c{c}` (cells outside the new grid are just not rendered but still listed in Cells tab).
3. `dashStyle`, `northArrowStyle`, `legend`, `metadata.village`, `metadata.scale/paperSize` (except PDF) have no visual effect on the canvas. The "✓ Legend" claim in the export modal is false. "Vector / Web" export produces a PNG.
4. Toolbar tools `select`, `text`, `eraser` do nothing on the master canvas; tooltips advertise `O`/`T` hotkeys that are not bound. Keyboard shortcuts stay active while the Cell Editor is open (page undo/redo fires underneath). Shortcut handler's effect deps are `[historyIndex, history]` so it rebinds on every commit.
5. Undo/redo history is unbounded and holds full deep copies of state; legend text inputs commit a history entry per keystroke; legend edits mutate objects in place (shared with `DEFAULT_LEGEND` and with history snapshots), so undo of legend edits doesn't visually revert.
6. `MapMetadataModal` is always mounted; its `formData` initialises once, so after Open/New/Undo the form shows stale values and Save will overwrite with them. `LeftPanel` grid temp inputs likewise never re-sync from props.
7. `CellEditorModal` is remounted per open (`{activeCellForEdit && …}`) — good — but `ExportModal`/`MapMetadataModal` are not.
8. PNG export captures the stage **at current on-screen zoom** (`toDataURL({pixelRatio})` multiplies the already-scaled stage), so "3x" output size varies with zoom/fit; PDF uses pixelRatio 2.5 likewise. PNG export is async (image onload) and the modal closes immediately; errors in onload are not caught by the try/catch.
9. The PNG footer strip overlays the bottom 4 % of the image, hiding the on-canvas scale bar. PDF "NORTH (شمال)" uses Helvetica → Urdu glyphs render as garbage; the on-canvas Urdu title relies on browser font fallback (Inter has no Arabic glyphs).
10. Duplicate CSS definitions: `.shajra-canvas-container` (bg `#334155` dotted, padding 40px, centred — second wins) and `.shajra-stage-wrapper` (white bg, `0 20px 50px` shadow — second wins). `fitToContainer` subtracts 32 px assuming 16 px padding, while the effective padding is 40 px, so the fitted canvas slightly overflows and the container scrolls; `.shajra-exit-btn` overlays the canvas's top-left corner.
11. Scale bar on canvas is a fixed 120 px labelled "100 Karams" (not tied to ppk); PDF scale bar is a fixed 30 mm labelled "100 Karams (550 ft)".
12. Canvas `onDblClick` to finish a polygon also fires two `mousedown`s first, so the final polygon gets a duplicated vertex at the double-click point (two identical points → zero-length segment skipped by labels).
13. Symbol stamping targets the **hovered** cell at the moment of click — since the click is on the sidebar, `hoveredCell` is whatever was last hovered on the canvas (often null → falls back to first cell with data or `r0c0`).
14. Cell label on canvas is `${row+1}-${colLetter}` ("1-A") while state keys/panel use `r0c0`; column headers are letters and row headers are numbers (code comments say the opposite).
15. `Open` accepts any JSON without schema validation; a malformed file will crash rendering (e.g. missing `grid`). `localStorage` draft likewise.
16. Eraser in the editor relies on Konva `e.target.name() === 'clickable-object'`; for polygons the name is on the Group so clicking the segment-label badges also deletes the polygon. Clicking an object with any other tool starts drawing on top of it (no selection/move exists anywhere).
17. Snap thresholds are in stage units (master 16 / editor 18), so the visual snap radius shrinks when zoomed out.
18. The `ms-auto` right group relies on Bootstrap being globally loaded; `Modal` components need react-bootstrap CSS; `.bg-light` box inside the dark modal is intentionally light with `.text-dark`/`.text-muted`.
19. `window.confirm`/`alert` native dialogs are used for New, Clear Cell, invalid JSON and export failure.
20. Toolbar height 48 px / panel header 48 px / editor header 52 px (auto on mobile) are hard-coded and referenced by the mobile drawer `top: 48px`.
