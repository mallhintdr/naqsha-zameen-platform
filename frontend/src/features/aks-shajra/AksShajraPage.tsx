// Ported from legacy src/components/AksShajra/AksShajraPage.js
import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { Stage, Layer, Rect, Line, Text as KonvaText, Circle, Group } from 'react-konva';
import { ArrowLeft } from 'lucide-react';
import { useDialog } from '@/shared/ui';
import TopToolbar from './TopToolbar';
import LeftPanel from './LeftPanel';
import CellEditorModal from './CellEditorModal';
import MapMetadataModal from './MapMetadataModal';
import ExportModal from './ExportModal';
import {
  INITIAL_PROJECT_STATE,
  EDITOR_ZOOM,
  EDITOR_PAD,
  formatLinearKaram,
} from './shajraConstants';
import {
  calculateCentroid,
  getClosestSnapPoint,
} from './geometryUtils';
import { exportProjectJSON } from './exportUtils';
import './AksShajra.css';

const DRAFT_KEY = 'aks_shajra_draft';

/** D7 fix: a project must at least carry metadata / grid / cells before we commit it. */
const isValidProject = (p: any) =>
  !!p && typeof p === 'object' &&
  !!p.metadata && typeof p.metadata === 'object' &&
  !!p.grid && typeof p.grid === 'object' &&
  Number(p.grid.rows) > 0 && Number(p.grid.cols) > 0 &&
  Number(p.grid.cellWidthKarams) > 0 && Number(p.grid.cellHeightKarams) > 0 &&
  !!p.cells && typeof p.cells === 'object';

const withDefaults = (p: any) => ({
  ...p,
  legend: Array.isArray(p.legend) ? p.legend : INITIAL_PROJECT_STATE.legend,
  northArrowStyle: p.northArrowStyle || 'standard',
});

type Updater = any | ((s: any) => any);

const AksShajraPage = () => {
  const navigate = useNavigate();
  const dialog = useDialog();
  const stageRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null); // Canvas container – used for auto-fit zoom

  // Project state + Undo / Redo history (single state so sequential commits compose)
  const [hist, setHist] = useState<{ list: any[]; index: number }>(() => {
    let initial = INITIAL_PROJECT_STATE;
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (isValidProject(parsed)) initial = withDefaults(parsed);
      }
    } catch {}
    return { list: [initial], index: 0 };
  });
  const history = hist.list;
  const historyIndex = hist.index;
  const projectState = history[historyIndex];

  // Save to localStorage automatically
  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(projectState));
    } catch {}
  }, [projectState]);

  const commitProjectState = useCallback((next: Updater) => {
    setHist((h) => {
      const cur = h.list[h.index];
      const newState = typeof next === 'function' ? next(cur) : next;
      const list = h.list.slice(0, h.index + 1);
      list.push(newState);
      return { list, index: list.length - 1 };
    });
  }, []);

  const handleUndo = useCallback(() => {
    setHist((h) => (h.index > 0 ? { ...h, index: h.index - 1 } : h));
  }, []);

  const handleRedo = useCallback(() => {
    setHist((h) => (h.index < h.list.length - 1 ? { ...h, index: h.index + 1 } : h));
  }, []);

  // UI state
  const [showLeftPanel, setShowLeftPanel] = useState(true);
  const [showMetadataModal, setShowMetadataModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [activeCellForEdit, setActiveCellForEdit] = useState<string | null>(null); // 'r0c0'
  const [hoveredCell, setHoveredCell] = useState<string | null>(null);

  // Active tools & styling
  const [activeTool, setActiveTool] = useState('cellSelect'); // 'select' | 'cellSelect' | 'polygon' | 'line' | 'rect' | 'circle' | 'text' | 'eraser'
  const [strokeColor, setStrokeColor] = useState('#0f172a');
  const [fillColor, setFillColor] = useState('#e8f5e9');
  const [strokeWidth, setStrokeWidth] = useState(2);
  const [dashStyle, setDashStyle] = useState('solid');
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [showGuide, setShowGuide] = useState(true);
  const [zoom, setZoom] = useState(1); // Will be replaced by auto-fit on mount

  // Canvas Grid Dimensions
  const { grid, cells, metadata, legend, northArrowStyle } = projectState;
  const pixelsPerKaram = grid.pixelsPerKaram || 16;
  const cellWidthPx = grid.cellWidthKarams * pixelsPerKaram;
  const cellHeightPx = grid.cellHeightKarams * pixelsPerKaram;
  // Title bar ≈ 10% of total canvas height.
  // Total height = rows*cellH + 2*gridPadding → gridPadding = rows*cellH * 0.125
  const gridPadding = Math.max(80, Math.round(grid.rows * cellHeightPx * 0.125));

  // The CellEditorModal renders at zoomFactor=3.5 with stagePadding=45.
  // Coordinates saved by the editor are in that zoomed space.
  // To render correctly on the main canvas we must invert that transform:
  //   canvasCoord = cellOrigin + (editorCoord - EDITOR_PAD) / EDITOR_ZOOM
  const toCell = (v: number, origin: number) => origin + (v - EDITOR_PAD) / EDITOR_ZOOM;
  const toCellPts = (pts: number[], cx: number, cy: number) => pts.map((v, i) => toCell(v, i % 2 === 0 ? cx : cy));
  // D7 fix: inverse of toCell - objects drawn on the master canvas are stored in editor space
  // so they render where drawn and round-trip through the Cell Editor.
  const toEditor = (v: number, origin: number) => EDITOR_PAD + (v - origin) * EDITOR_ZOOM;
  const toEditorPts = (pts: number[], cx: number, cy: number) => pts.map((v, i) => toEditor(v, i % 2 === 0 ? cx : cy));
  const cellAt = (px: number, py: number) => {
    const col = Math.max(0, Math.floor((px - gridPadding) / cellWidthPx));
    const row = Math.max(0, Math.floor((py - gridPadding) / cellHeightPx));
    return { key: `r${row}c${col}`, ox: gridPadding + col * cellWidthPx, oy: gridPadding + row * cellHeightPx };
  };
  const masterShapeToEditor = (shape: any, ox: number, oy: number) => {
    if (shape.type === 'rect') {
      return { ...shape, x: toEditor(shape.x, ox), y: toEditor(shape.y, oy), width: shape.width * EDITOR_ZOOM, height: shape.height * EDITOR_ZOOM };
    }
    if (shape.type === 'circle') {
      return { ...shape, x: toEditor(shape.x, ox), y: toEditor(shape.y, oy), radius: shape.radius * EDITOR_ZOOM };
    }
    if (shape.points) return { ...shape, points: toEditorPts(shape.points, ox, oy) };
    return shape;
  };

  // Build segment-length label data – horizontal and vertical segments only.
  // Traditional cadastral/plat style: label sits just OUTSIDE the boundary,
  // parallel to its edge (matches the same convention used in CellEditorModal).
  const buildSegLabels = (pts: number[], closed: boolean, centroid?: any) => {
    const lbls: any[] = [];
    const HV_THRESH = pixelsPerKaram * 0.10; // within 0.1 karam of perfectly H or V
    const LABEL_OFFSET = 5; // px in the (already zoomed-out) master-canvas space

    const tryAddSeg = (x1: number, y1: number, x2: number, y2: number) => {
      const dx = x2 - x1;
      const dy = y2 - y1;
      const adx = Math.abs(dx);
      const ady = Math.abs(dy);
      // Skip diagonal segments on the overview canvas (kept simple/uncluttered)
      if (ady > HV_THRESH && adx > HV_THRESH) return;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < 1e-6) return;
      const txt = formatLinearKaram(len / pixelsPerKaram);
      if (!txt) return;

      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;
      let nx = -dy / len;
      let ny = dx / len;
      if (centroid) {
        const toCentX = centroid.x - mx;
        const toCentY = centroid.y - my;
        if (nx * toCentX + ny * toCentY > 0) { nx = -nx; ny = -ny; }
      } else {
        if (ady < 0.01 && ny > 0) { nx = -nx; ny = -ny; }
        else if (adx < 0.01 && nx > 0) { nx = -nx; ny = -ny; }
      }
      const rot = adx >= ady ? 0 : 90; // horizontal edge → upright text; vertical edge → reads top-to-bottom

      lbls.push({ x: mx + nx * LABEL_OFFSET, y: my + ny * LABEL_OFFSET, text: txt, rot });
    };

    for (let i = 0; i + 3 < pts.length; i += 2) {
      tryAddSeg(pts[i], pts[i + 1], pts[i + 2], pts[i + 3]);
    }
    if (closed && pts.length >= 6) {
      const n = pts.length;
      tryAddSeg(pts[n - 2], pts[n - 1], pts[0], pts[1]);
    }
    return lbls;
  };

  const canvasWidth = grid.cols * cellWidthPx + gridPadding * 2;
  const canvasHeight = grid.rows * cellHeightPx + gridPadding * 2;

  // ── Auto-fit: scale canvas to fill the available container on mount & resize
  const fitToContainer = useCallback(() => {
    if (!containerRef.current) return;
    const cw = containerRef.current.clientWidth - 32;   // 16px inset each side
    const ch = containerRef.current.clientHeight - 32;
    if (cw <= 0 || ch <= 0) return;
    const s = Math.min(cw / canvasWidth, ch / canvasHeight, 1); // never scale above 100%
    setZoom(parseFloat(s.toFixed(3)));
  }, [canvasWidth, canvasHeight]);

  useEffect(() => {
    // Delay so the DOM layout (including left-panel transition) has settled
    const t = setTimeout(fitToContainer, 80);
    window.addEventListener('resize', fitToContainer);
    return () => {
      clearTimeout(t);
      window.removeEventListener('resize', fitToContainer);
    };
  }, [fitToContainer, showLeftPanel]);

  // Snapping points calculation for Master Canvas
  const masterSnapPoints = useRef<any[]>([]);
  useEffect(() => {
    const pts: any[] = [];
    for (let r = 0; r <= grid.rows; r++) {
      for (let c = 0; c <= grid.cols; c++) {
        pts.push({
          x: gridPadding + c * cellWidthPx,
          y: gridPadding + r * cellHeightPx,
        });
      }
    }
    masterSnapPoints.current = pts;
  }, [grid, cellWidthPx, cellHeightPx, gridPadding]);

  // Master Canvas Drawing / Interaction state
  const [currentPoints, setCurrentPoints] = useState<number[]>([]);
  const [cursorPos, setCursorPos] = useState<any>(null);
  const [snapIndicator, setSnapIndicator] = useState<any>(null);
  const [dragStart, setDragStart] = useState<any>(null);
  const [tempShape, setTempShape] = useState<any>(null);

  // Keyboard shortcuts
  useEffect(() => {
    // D7 fix: page shortcuts are suspended while the Cell Editor is open
    if (activeCellForEdit) return undefined;
    const handleKeyDown = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA' || t?.tagName === 'SELECT' || t?.isContentEditable) return;
      if (!(e.ctrlKey || e.metaKey) && !e.altKey) {
        const k = e.key.toLowerCase();
        const map: Record<string, string> = { v: 'select', c: 'cellSelect', p: 'polygon', l: 'line', r: 'rect', o: 'circle', t: 'text', e: 'eraser' };
        if (map[k]) setActiveTool(map[k]);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeCellForEdit, handleUndo, handleRedo]);

  // Save updated cell from editor modal
  const handleSaveCellData = (cellKey: string, updatedData: any) => {
    const newCells = {
      ...cells,
      [cellKey]: updatedData,
    };
    commitProjectState({
      ...projectState,
      cells: newCells,
    });
  };

  // Stamp symbol onto cell or center
  const handleAddSymbol = (symbol: any) => {
    const targetCellKey = hoveredCell || Object.keys(cells)[0] || 'r0c0';
    const currentCell = cells[targetCellKey] || { label: targetCellKey, objects: [] };

    // Place at center of that cell
    const [rStr, cStr] = targetCellKey.replace('r', '').split('c');
    const row = parseInt(rStr, 10) || 0;
    const col = parseInt(cStr, 10) || 0;
    const centerX = gridPadding + col * cellWidthPx + cellWidthPx / 2;
    const centerY = gridPadding + row * cellHeightPx + cellHeightPx / 2;

    // D7 fix: stored in editor space (fontSize scaled so it still shows at 24 px on the master canvas)
    const originX = gridPadding + col * cellWidthPx;
    const originY = gridPadding + row * cellHeightPx;
    const newSymbolObj = {
      id: `sym_${Date.now()}`,
      type: 'text',
      x: toEditor(centerX - 12, originX),
      y: toEditor(centerY - 12, originY),
      text: symbol.icon,
      fontSize: 24 * EDITOR_ZOOM,
      fill: symbol.color,
    };

    const newCells = {
      ...cells,
      [targetCellKey]: {
        ...currentCell,
        objects: [...(currentCell.objects || []), newSymbolObj],
      },
    };

    commitProjectState({
      ...projectState,
      cells: newCells,
    });
  };

  // Master Canvas Mouse events
  const resolveCoord = (pos: any) => {
    if (!snapEnabled) return pos;
    const snap = getClosestSnapPoint(pos, masterSnapPoints.current, 16);
    if (snap) {
      setSnapIndicator({ x: snap.x, y: snap.y });
      return { x: snap.x, y: snap.y };
    }
    setSnapIndicator(null);
    return pos;
  };

  const handleMouseMove = (e: any) => {
    const stage = e.target.getStage();
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    // Adjust for zoom
    const unscaled = {
      x: pointer.x / zoom,
      y: pointer.y / zoom,
    };
    const resolved = resolveCoord(unscaled);
    setCursorPos(resolved);

    // Identify hovered cell
    const colIdx = Math.floor((unscaled.x - gridPadding) / cellWidthPx);
    const rowIdx = Math.floor((unscaled.y - gridPadding) / cellHeightPx);
    if (colIdx >= 0 && colIdx < grid.cols && rowIdx >= 0 && rowIdx < grid.rows) {
      setHoveredCell(`r${rowIdx}c${colIdx}`);
    } else {
      setHoveredCell(null);
    }

    if (dragStart && (activeTool === 'rect' || activeTool === 'circle' || activeTool === 'line')) {
      if (activeTool === 'rect') {
        const x = Math.min(dragStart.x, resolved.x);
        const y = Math.min(dragStart.y, resolved.y);
        const width = Math.abs(resolved.x - dragStart.x);
        const height = Math.abs(resolved.y - dragStart.y);
        setTempShape({ type: 'rect', x, y, width, height });
      } else if (activeTool === 'circle') {
        const radius = Math.hypot(resolved.x - dragStart.x, resolved.y - dragStart.y);
        setTempShape({ type: 'circle', x: dragStart.x, y: dragStart.y, radius });
      } else if (activeTool === 'line') {
        setTempShape({ type: 'line', points: [dragStart.x, dragStart.y, resolved.x, resolved.y] });
      }
    }
  };

  const handleMouseDown = (e: any) => {
    const stage = e.target.getStage();
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    const unscaled = { x: pointer.x / zoom, y: pointer.y / zoom };
    const resolved = resolveCoord(unscaled);

    if (activeTool === 'cellSelect') {
      const colIdx = Math.floor((unscaled.x - gridPadding) / cellWidthPx);
      const rowIdx = Math.floor((unscaled.y - gridPadding) / cellHeightPx);
      if (colIdx >= 0 && colIdx < grid.cols && rowIdx >= 0 && rowIdx < grid.rows) {
        const cellKey = `r${rowIdx}c${colIdx}`;
        setActiveCellForEdit(cellKey);
      }
      return;
    }

    if (activeTool === 'polygon') {
      setCurrentPoints((prev) => [...prev, resolved.x, resolved.y]);
    } else if (activeTool === 'rect' || activeTool === 'circle' || activeTool === 'line') {
      setDragStart(resolved);
    }
  };

  const handleMouseUp = () => {
    if (dragStart && tempShape) {
      const { key: cellKey, ox, oy } = cellAt(dragStart.x, dragStart.y);
      const currentCell = cells[cellKey] || { label: cellKey, objects: [] };

      const newObj = {
        id: `obj_${Date.now()}`,
        ...masterShapeToEditor(tempShape, ox, oy),
        stroke: strokeColor,
        strokeWidth,
        fill: fillColor,
      };

      commitProjectState({
        ...projectState,
        cells: {
          ...cells,
          [cellKey]: {
            ...currentCell,
            objects: [...(currentCell.objects || []), newObj],
          },
        },
      });
    }
    setDragStart(null);
    setTempShape(null);
  };

  const handleFinishPolygon = () => {
    if (currentPoints.length >= 6) {
      const firstX = currentPoints[0];
      const firstY = currentPoints[1];
      const { key: cellKey, ox, oy } = cellAt(firstX, firstY);
      const currentCell = cells[cellKey] || { label: cellKey, objects: [] };

      const newPoly = {
        id: `poly_${Date.now()}`,
        type: 'polygon',
        points: toEditorPts(currentPoints, ox, oy),
        stroke: strokeColor,
        strokeWidth,
        fill: fillColor,
        closed: true,
      };

      commitProjectState({
        ...projectState,
        cells: {
          ...cells,
          [cellKey]: {
            ...currentCell,
            objects: [...(currentCell.objects || []), newPoly],
          },
        },
      });
    }
    setCurrentPoints([]);
  };

  return (
    <div className="aks-shajra-root">
      {/* Top Navbar Toolbar */}
      <TopToolbar
        activeTool={activeTool}
        setActiveTool={setActiveTool}
        strokeColor={strokeColor}
        setStrokeColor={setStrokeColor}
        fillColor={fillColor}
        setFillColor={setFillColor}
        strokeWidth={strokeWidth}
        setStrokeWidth={setStrokeWidth}
        dashStyle={dashStyle}
        setDashStyle={setDashStyle}
        snapEnabled={snapEnabled}
        setSnapEnabled={setSnapEnabled}
        showGuide={showGuide}
        setShowGuide={setShowGuide}
        canUndo={historyIndex > 0}
        canRedo={historyIndex < history.length - 1}
        onUndo={handleUndo}
        onRedo={handleRedo}
        zoom={zoom}
        onZoomIn={() => setZoom((z) => Math.min(3, parseFloat((z + 0.1).toFixed(2))))}
        onZoomOut={() => setZoom((z) => Math.max(0.15, parseFloat((z - 0.1).toFixed(2))))}
        onResetZoom={fitToContainer}
        onNewProject={async () => {
          if (await dialog.confirm('Start a new Shajra map project? Any unsaved changes will be reset.', { variant: 'danger', okLabel: 'New Project' })) {
            commitProjectState(INITIAL_PROJECT_STATE);
          }
        }}
        onSaveJSON={() => exportProjectJSON(projectState, `${metadata.mauza || 'aks_shajra'}.json`)}
        onLoadJSON={(loaded: any) => {
          if (!isValidProject(loaded)) {
            dialog.alert('Invalid Aks Shajra project file: it must contain metadata, grid and cells.', { variant: 'danger', title: 'Open Project' });
            return;
          }
          commitProjectState(withDefaults(loaded));
        }}
        onOpenExportModal={() => setShowExportModal(true)}
        onToggleLeftPanel={() => setShowLeftPanel(!showLeftPanel)}
        showLeftPanel={showLeftPanel}
        onToggleMetadataModal={() => setShowMetadataModal(true)}
      />

      {/* Main Workspace Area */}
      <div className="shajra-workspace">
        {/* Mobile-only backdrop: tapping outside the drawer closes it (see CSS @media) */}
        {showLeftPanel && (
          <div className="shajra-panel-backdrop" onClick={() => setShowLeftPanel(false)} />
        )}

        {/* Left Settings Sidebar */}
        <LeftPanel
          isOpen={showLeftPanel}
          onClose={() => setShowLeftPanel(false)}
          gridConfig={grid}
          onUpdateGridConfig={(newGrid: any) => commitProjectState({ ...projectState, grid: newGrid })}
          paperConfig={{
            paperSize: metadata.paperSize,
            orientation: metadata.orientation,
            scale: metadata.scale,
          }}
          onUpdatePaperConfig={(newPaper: any) =>
            commitProjectState({
              ...projectState,
              metadata: { ...projectState.metadata, ...newPaper },
            })
          }
          cellsData={cells}
          activeCellKey={hoveredCell}
          onSelectCell={(key: string) => setActiveCellForEdit(key)}
          onAddSymbol={handleAddSymbol}
          legendList={legend}
          onUpdateLegend={(newLegend: any) => commitProjectState({ ...projectState, legend: newLegend })}
        />

        {/* Master Canvas Container */}
        <div className="shajra-canvas-container" ref={containerRef}>
          {/* Back to GIS Dashboard Button */}
          <button
            className="shajra-exit-btn"
            onClick={() => navigate('/')}
          >
            <ArrowLeft size={14} /> Exit to GIS Dashboard
          </button>

          {/* Stage scales via Konva's own scaleX/scaleY – DOM footprint = visible size */}
          <div className="shajra-stage-wrapper">
            <Stage
              ref={stageRef}
              width={Math.round(canvasWidth * zoom)}
              height={Math.round(canvasHeight * zoom)}
              scaleX={zoom}
              scaleY={zoom}
              onPointerMove={handleMouseMove}
              onPointerDown={handleMouseDown}
              onPointerUp={handleMouseUp}
              onDblClick={handleFinishPolygon}
              onDblTap={handleFinishPolygon}
            >
              {/* 1. Paper / Background Layer */}
              <Layer>
                <Rect
                  x={0}
                  y={0}
                  width={canvasWidth}
                  height={canvasHeight}
                  fill="#ffffff"
                  stroke="#1e293b"
                  strokeWidth={2}
                />

                {/* ── Official Aks Shajra Title Block (proportional to gridPadding) ── */}
                {(() => {
                  const hasPrepared = Boolean(metadata.preparedBy || metadata.checkedBy);
                  const titleFontSize = Math.max(15, Math.round(gridPadding * 0.24));
                  const metaFontSize  = Math.max(10, Math.round(gridPadding * 0.135));
                  const prepFontSize  = Math.max(10, Math.round(gridPadding * 0.125));
                  const titleY = Math.round(gridPadding * 0.09);
                  const divY   = Math.round(gridPadding * 0.44);
                  const metaY  = Math.round(gridPadding * 0.50);
                  const prepY  = Math.round(gridPadding * 0.74);

                  // North arrow: a modern, self-contained circular compass badge.
                  // Sizing the whole thing off ONE radius (R), clamped to fit inside
                  // both the header's height and its reserved width zone, guarantees
                  // every part of the badge renders inside the visible page \u2014 the old
                  // version placed the "N" label using a fixed offset from the arrow
                  // tip, which went negative (i.e. above the page) on smaller grids.
                  const arrowZoneW = Math.max(64, Math.round(gridPadding * 0.85));
                  const R = Math.max(14, Math.min(
                    Math.round(gridPadding * 0.30),
                    Math.floor((gridPadding - 10) / 2),
                    Math.floor((arrowZoneW - 12) / 2),
                  ));
                  const compassCx = canvasWidth - arrowZoneW / 2;
                  const compassCy = Math.round(gridPadding / 2);
                  const textAreaWidth = canvasWidth - arrowZoneW - 24;

                  return (
                    <>
                      {/* Header background band */}
                      <Rect x={1} y={1} width={canvasWidth - 2} height={gridPadding - 2} fill="#f8fafc" />
                      {/* Left accent bar */}
                      <Rect x={1} y={1} width={5} height={gridPadding - 2} fill="#0284c7" />
                      {/* Bottom border */}
                      <Line points={[1, gridPadding, canvasWidth - 1, gridPadding]} stroke="#1e293b" strokeWidth={1.5} />

                      {/* Main Title */}
                      <KonvaText
                        x={12} y={titleY}
                        width={textAreaWidth}
                        text={metadata.title || 'Aks Shajra Parcha (\u0627\u06a9\u0633 \u0634\u062c\u0631\u06c1 \u067e\u0627\u0631\u0686\u06c1)'}
                        fontSize={titleFontSize}
                        fontFamily="Inter, Arial"
                        fontStyle="bold"
                        fill="#0f172a"
                        align="center"
                      />

                      {/* Thin divider under title */}
                      <Line
                        points={[canvasWidth * 0.12, divY, canvasWidth - arrowZoneW - 12, divY]}
                        stroke="#cbd5e1" strokeWidth={0.8}
                      />

                      {/* Metadata row: Tehsil | Mouza | Murabba No */}
                      <KonvaText
                        x={12} y={metaY}
                        width={textAreaWidth}
                        text={[
                          metadata.tehsil    && `Tehsil: ${metadata.tehsil}`,
                          metadata.mauza     && `Mouza: ${metadata.mauza}`,
                          metadata.murabba   && `Murabba No: ${metadata.murabba}`,
                          metadata.hadbastNo && `Hadbast: ${metadata.hadbastNo}`,
                        ].filter(Boolean).join('   \u2502   ') || 'Tehsil \u00b7 Mouza \u00b7 Murabba No'}
                        fontSize={metaFontSize}
                        fontFamily="Inter, Arial"
                        fill="#334155"
                        align="center"
                      />

                      {/* Prepared By / Checked By \u2014 previously missing from the on-canvas
                          map entirely (only shown, tiny, in the separate PDF export) */}
                      {hasPrepared && (
                        <KonvaText
                          x={12} y={prepY}
                          width={textAreaWidth}
                          text={[
                            metadata.preparedBy && `Prepared By: ${metadata.preparedBy}`,
                            metadata.checkedBy  && `Checked By: ${metadata.checkedBy}`,
                          ].filter(Boolean).join('     \u2502     ')}
                          fontSize={prepFontSize}
                          fontFamily="Inter, Arial"
                          fontStyle="bold"
                          fill="#475569"
                          align="center"
                        />
                      )}

                      {/* North Arrow \u2014 modern circular compass badge. Everything is drawn
                          relative to radius R, which is itself clamped to fit inside both
                          the header height and its reserved width zone, so no part of the
                          badge can ever render outside the visible page. */}
                      <Group x={compassCx} y={compassCy}>
                        {/* Badge circle */}
                        <Circle
                          radius={R}
                          fill="#ffffff"
                          stroke="#cbd5e1"
                          strokeWidth={1.4}
                          shadowColor="rgba(15,23,42,0.25)"
                          shadowBlur={4}
                          shadowOffsetY={1}
                        />
                        {/* Compass needle (kite): red half points North, slate half points South */}
                        <Line points={[0, -R * 0.72, R * 0.30, 0, 0, 0]} closed fill="#dc2626" />
                        <Line points={[0, -R * 0.72, -R * 0.30, 0, 0, 0]} closed fill="#ef4444" />
                        <Line points={[0, R * 0.55, R * 0.30, 0, 0, 0]} closed fill="#e2e8f0" stroke="#94a3b8" strokeWidth={0.5} />
                        <Line points={[0, R * 0.55, -R * 0.30, 0, 0, 0]} closed fill="#f1f5f9" stroke="#94a3b8" strokeWidth={0.5} />
                        {/* "N" \u2014 sits inside the top of the circle, never outside it */}
                        <KonvaText
                          x={-R * 0.32}
                          y={-R + Math.max(1, R * 0.06)}
                          width={R * 0.64}
                          text="N"
                          fontSize={Math.max(9, Math.round(R * 0.5))}
                          fontStyle="bold"
                          fontFamily="Inter, Arial"
                          fill="#0f172a"
                          align="center"
                        />
                      </Group>
                    </>
                  );
                })()}
              </Layer>

              {/* 2. Master Grid & Cells Layer */}
              <Layer>
                {Array.from({ length: grid.rows }).map((_, r) =>
                  Array.from({ length: grid.cols }).map((_, c) => {
                    const cellKey = `r${r}c${c}`;
                    const x = gridPadding + c * cellWidthPx;
                    const y = gridPadding + r * cellHeightPx;
                    const isHovered = hoveredCell === cellKey;
                    const cell = cells[cellKey];

                    return (
                      <Group key={cellKey}>
                        {/* Cell Boundary Rect */}
                        <Rect
                          x={x}
                          y={y}
                          width={cellWidthPx}
                          height={cellHeightPx}
                          fill={isHovered ? 'rgba(56, 189, 248, 0.08)' : '#ffffff'}
                          stroke="#0f172a"
                          strokeWidth={1.5}
                        />

                        {/* Minor Karam Subdivisions (Dotted) */}
                        {showGuide && (
                          <>
                            {Array.from({ length: grid.cellWidthKarams - 1 }).map((_, kw) => {
                              const kx = x + (kw + 1) * pixelsPerKaram;
                              return (
                                <Line
                                  key={`kw_${kw}`}
                                  points={[kx, y, kx, y + cellHeightPx]}
                                  stroke="#e2e8f0"
                                  strokeWidth={0.8}
                                  dash={[2, 3]}
                                />
                              );
                            })}
                            {Array.from({ length: grid.cellHeightKarams - 1 }).map((_, kh) => {
                              const ky = y + (kh + 1) * pixelsPerKaram;
                              return (
                                <Line
                                  key={`kh_${kh}`}
                                  points={[x, ky, x + cellWidthPx, ky]}
                                  stroke="#e2e8f0"
                                  strokeWidth={0.8}
                                  dash={[2, 3]}
                                />
                              );
                            })}
                          </>
                        )}

                        {/* Cell Label (e.g. 1-A or R1C1) */}
                        <KonvaText
                          x={x + 4}
                          y={y + 4}
                          text={`${r + 1}-${String.fromCharCode(65 + c)}`}
                          fontSize={9}
                          fill="#94a3b8"
                        />

                        {/* Render Cell's internal drawn objects.
                             Apply inverse of editor transform:
                             editorCoord → (editorCoord - EDITOR_PAD) / EDITOR_ZOOM + cellOrigin */}
                        {(cell?.objects?.length || 0) > 0 && (
                          <Group
                            clipX={x}
                            clipY={y}
                            clipWidth={cellWidthPx}
                            clipHeight={cellHeightPx}
                          >
                            {cell.objects.map((obj: any) => {
                              if (obj.type === 'polygon') {
                                const pts = toCellPts(obj.points, x, y);
                                const centroid = calculateCentroid(pts);
                                const segLabels = buildSegLabels(pts, true, centroid);
                                return (
                                  <Group key={obj.id}>
                                    <Line
                                      points={pts}
                                      closed
                                      fill={obj.fill}
                                      stroke={obj.stroke}
                                      strokeWidth={Math.max(0.5, (obj.strokeWidth || 2) / EDITOR_ZOOM)}
                                    />
                                    {segLabels.map((lbl, li) => {
                                      const fs = Math.max(6, Math.round(pixelsPerKaram * 0.44));
                                      const bw = Math.round(fs * 3.6);
                                      const bh = Math.round(fs * 1.8);
                                      return (
                                        <Group key={li} x={lbl.x} y={lbl.y} rotation={lbl.rot}>
                                          <Rect x={-bw / 2} y={-bh / 2} width={bw} height={bh} fill="rgba(255,255,255,0.92)" cornerRadius={2} />
                                          <KonvaText x={-bw / 2} y={-bh / 2 + 1} text={lbl.text} fontSize={fs} fill="#1e40af" fontStyle="bold" width={bw} align="center" />
                                        </Group>
                                      );
                                    })}
                                  </Group>
                                );
                              }
                              if (obj.type === 'line') {
                                const pts = toCellPts(obj.points, x, y);
                                const segLabels = buildSegLabels(pts, false);
                                return (
                                  <Group key={obj.id}>
                                    <Line
                                      points={pts}
                                      stroke={obj.stroke}
                                      strokeWidth={Math.max(0.5, (obj.strokeWidth || 2) / EDITOR_ZOOM)}
                                      lineCap="round"
                                    />
                                    {segLabels.map((lbl, li) => {
                                      const fs = Math.max(6, Math.round(pixelsPerKaram * 0.44));
                                      const bw = Math.round(fs * 3.6);
                                      const bh = Math.round(fs * 1.8);
                                      return (
                                        <Group key={li} x={lbl.x} y={lbl.y} rotation={lbl.rot}>
                                          <Rect x={-bw / 2} y={-bh / 2} width={bw} height={bh} fill="rgba(255,255,255,0.92)" cornerRadius={2} />
                                          <KonvaText x={-bw / 2} y={-bh / 2 + 1} text={lbl.text} fontSize={fs} fill="#475569" fontStyle="bold" width={bw} align="center" />
                                        </Group>
                                      );
                                    })}
                                  </Group>
                                );
                              }
                              if (obj.type === 'rect') {
                                return (
                                  <Rect
                                    key={obj.id}
                                    x={toCell(obj.x, x)}
                                    y={toCell(obj.y, y)}
                                    width={obj.width / EDITOR_ZOOM}
                                    height={obj.height / EDITOR_ZOOM}
                                    fill={obj.fill}
                                    stroke={obj.stroke}
                                    strokeWidth={Math.max(0.5, (obj.strokeWidth || 2) / EDITOR_ZOOM)}
                                  />
                                );
                              }
                              if (obj.type === 'circle') {
                                return (
                                  <Circle
                                    key={obj.id}
                                    x={toCell(obj.x, x)}
                                    y={toCell(obj.y, y)}
                                    radius={obj.radius / EDITOR_ZOOM}
                                    fill={obj.fill}
                                    stroke={obj.stroke}
                                    strokeWidth={Math.max(0.5, (obj.strokeWidth || 2) / EDITOR_ZOOM)}
                                  />
                                );
                              }
                              if (obj.type === 'text') {
                                return (
                                  <KonvaText
                                    key={obj.id}
                                    x={toCell(obj.x, x)}
                                    y={toCell(obj.y, y)}
                                    text={obj.text}
                                    fontSize={Math.max(7, Math.round((obj.fontSize || 16) / EDITOR_ZOOM))}
                                    fill={obj.fill}
                                    fontStyle="bold"
                                  />
                                );
                              }
                              return null;
                            })}
                          </Group>
                        )}
                      </Group>
                    );
                  })
                )}

                {/* Grid Column Headers (1, 2, 3...) */}
                {Array.from({ length: grid.cols }).map((_, c) => {
                  const x = gridPadding + c * cellWidthPx + cellWidthPx / 2;
                  return (
                    <KonvaText
                      key={`col_hdr_${c}`}
                      x={x - 8}
                      y={gridPadding - 18}
                      text={String.fromCharCode(65 + c)}
                      fontSize={11}
                      fontStyle="bold"
                      fill="#334155"
                    />
                  );
                })}

                {/* Grid Row Headers (A, B, C...) */}
                {Array.from({ length: grid.rows }).map((_, r) => {
                  const y = gridPadding + r * cellHeightPx + cellHeightPx / 2;
                  return (
                    <KonvaText
                      key={`row_hdr_${r}`}
                      x={gridPadding - 24}
                      y={y - 6}
                      text={String(r + 1)}
                      fontSize={11}
                      fontStyle="bold"
                      fill="#334155"
                    />
                  );
                })}

                {/* Scale Bar at bottom */}
                <Group x={gridPadding} y={canvasHeight - 32}>
                  <Rect x={0} y={0} width={60} height={4} fill="#0f172a" />
                  <Rect x={60} y={0} width={60} height={4} fill="#94a3b8" />
                  <KonvaText x={0} y={8} text="0" fontSize={8} fill="#64748b" />
                  <KonvaText x={110} y={8} text="100 Karams" fontSize={8} fill="#64748b" />
                </Group>
              </Layer>

              {/* 3. Interactive Drawing & Snapping Overlay */}
              <Layer>
                {/* Temp shape while dragging */}
                {tempShape?.type === 'rect' && (
                  <Rect
                    x={tempShape.x}
                    y={tempShape.y}
                    width={tempShape.width}
                    height={tempShape.height}
                    fill={fillColor}
                    stroke={strokeColor}
                    strokeWidth={strokeWidth}
                    dash={[4, 4]}
                  />
                )}
                {tempShape?.type === 'circle' && (
                  <Circle
                    x={tempShape.x}
                    y={tempShape.y}
                    radius={tempShape.radius}
                    fill={fillColor}
                    stroke={strokeColor}
                    strokeWidth={strokeWidth}
                    dash={[4, 4]}
                  />
                )}
                {tempShape?.type === 'line' && (
                  <Line
                    points={tempShape.points}
                    stroke={strokeColor}
                    strokeWidth={strokeWidth}
                    dash={[4, 4]}
                  />
                )}

                {/* Active Polygon points */}
                {currentPoints.length > 0 && (
                  <Line
                    points={
                      cursorPos
                        ? [...currentPoints, cursorPos.x, cursorPos.y]
                        : currentPoints
                    }
                    stroke="#0284c7"
                    strokeWidth={2}
                    dash={[4, 4]}
                  />
                )}
                {currentPoints.map((_val, idx) => {
                  if (idx % 2 !== 0) return null;
                  return (
                    <Circle
                      key={`poly_pt_${idx}`}
                      x={currentPoints[idx]}
                      y={currentPoints[idx + 1]}
                      radius={4}
                      fill="#0284c7"
                    />
                  );
                })}

                {/* Snap glowing green dot indicator */}
                {snapIndicator && (
                  <Circle
                    x={snapIndicator.x}
                    y={snapIndicator.y}
                    radius={6}
                    fill="rgba(16, 185, 129, 0.4)"
                    stroke="#10b981"
                    strokeWidth={2}
                  />
                )}
              </Layer>
            </Stage>
          </div>
        </div>
      </div>

      {/* Cell Editor Modal (Zoomed precision editing) */}
      {activeCellForEdit && (
        <CellEditorModal
          show={Boolean(activeCellForEdit)}
          cellKey={activeCellForEdit}
          cellData={cells[activeCellForEdit]}
          gridConfig={grid}
          onSaveCell={handleSaveCellData}
          onClose={() => setActiveCellForEdit(null)}
        />
      )}

      {/* Metadata & Title Block Modal */}
      <MapMetadataModal
        show={showMetadataModal}
        onClose={() => setShowMetadataModal(false)}
        metadata={metadata}
        onSaveMetadata={(newMeta: any) =>
          commitProjectState((ps: any) => ({ ...ps, metadata: newMeta }))
        }
        northArrowStyle={northArrowStyle}
        onSaveNorthArrowStyle={(newStyle: string) =>
          commitProjectState((ps: any) => ({ ...ps, northArrowStyle: newStyle }))
        }
      />

      {/* Export Modal (PDF, PNG, SVG) */}
      <ExportModal
        show={showExportModal}
        onClose={() => setShowExportModal(false)}
        stageRef={stageRef}
        metadata={metadata}
        legend={legend}
        paperConfig={{
          paperSize: metadata.paperSize,
          orientation: metadata.orientation,
          scale: metadata.scale,
        }}
      />
    </div>
  );
};

export default AksShajraPage;
