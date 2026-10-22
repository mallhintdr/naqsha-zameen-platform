// Ported from legacy src/components/AksShajra/CellEditorModal.js
import { useState, useRef, useEffect, useCallback } from 'react';
import { Stage, Layer, Rect, Line, Text as KonvaText, Circle, Group } from 'react-konva';
import { Check, Undo2, Redo2, Pentagon, Pencil, Square, Circle as CircleIcon, Type, Eraser, Magnet, Trash2 } from 'lucide-react';
import { useDialog } from '@/shared/ui';
import { KARAM_FEET, EDITOR_ZOOM, EDITOR_PAD, formatKaramToArea, formatLinearKaram } from './shajraConstants';
import { getClosestSnapPoint, calculatePolygonArea, calculateCentroid } from './geometryUtils';

const I = 13;

const CellEditorModal = ({
  show,
  cellKey,
  cellData,
  gridConfig,
  onSaveCell,
  onClose,
}: any) => {
  const dialog = useDialog();
  // Zoomed cell display parameters
  const zoomFactor = EDITOR_ZOOM; // Coordinate space for precision editing (must stay fixed for saved-coord compatibility)
  const pixelsPerKaram = (gridConfig.pixelsPerKaram || 16) * zoomFactor;

  const cellWidthPx = gridConfig.cellWidthKarams * pixelsPerKaram;
  const cellHeightPx = gridConfig.cellHeightKarams * pixelsPerKaram;
  const stagePadding = EDITOR_PAD; // Margin around cell for ruler & labels
  const stageWidth = cellWidthPx + stagePadding * 2;
  const stageHeight = cellHeightPx + stagePadding * 2;

  // ── Auto-fit: shrink Stage to fit inside the modal canvas area ────────────
  // Available space = 95vh/vw modal minus the header's ACTUAL rendered height
  // (measured via ref, not hardcoded) and the canvas wrapper's own padding.
  // On narrow/mobile screens the header wraps onto multiple rows (see CSS),
  // so a fixed 52px assumption would overflow the stage past the visible area.
  const headerRef = useRef<HTMLDivElement>(null);
  const [fitScale, setFitScale] = useState(1);
  useEffect(() => {
    const computeFit = () => {
      const headerH = headerRef.current?.offsetHeight || 52;
      const wrapperPad = 56; // .cell-canvas-wrapper padding (24px * 2) + a small safety margin
      const availW = window.innerWidth * 0.95 - wrapperPad;
      const availH = window.innerHeight * 0.95 - headerH - wrapperPad;
      if (availW <= 0 || availH <= 0) return;
      const s = Math.min(availW / stageWidth, availH / stageHeight, 1);
      setFitScale(parseFloat(Math.max(0.15, s).toFixed(3)));
    };
    computeFit();
    // Re-measure after layout settles (header wrap can change height post-mount)
    const t = setTimeout(computeFit, 60);
    window.addEventListener('resize', computeFit);
    window.addEventListener('orientationchange', computeFit);
    return () => {
      clearTimeout(t);
      window.removeEventListener('resize', computeFit);
      window.removeEventListener('orientationchange', computeFit);
    };
  }, [stageWidth, stageHeight]);

  // Tools & properties
  const [activeTool, setActiveTool] = useState('polygon'); // 'polygon' | 'line' | 'rect' | 'circle' | 'text' | 'eraser'
  const [strokeColor, setStrokeColor] = useState('#1e293b');
  const [fillColor, setFillColor] = useState('#e8f5e9');
  const [strokeWidth] = useState(2);
  const [snapEnabled, setSnapEnabled] = useState(true);

  // Cell elements
  const [objects, setObjects] = useState<any[]>(cellData?.objects ? JSON.parse(JSON.stringify(cellData.objects)) : []);
  const [history, setHistory] = useState<any[][]>([cellData?.objects ? JSON.parse(JSON.stringify(cellData.objects)) : []]);
  const [historyIndex, setHistoryIndex] = useState(0);

  // Drawing temp state
  const [currentPoints, setCurrentPoints] = useState<number[]>([]);
  const [cursorPos, setCursorPos] = useState<any>(null);
  const [snapIndicator, setSnapIndicator] = useState<any>(null);
  const [dragStart, setDragStart] = useState<any>(null);
  const [tempShape, setTempShape] = useState<any>(null);

  // Text prompt modal
  const [textInputOpen, setTextInputOpen] = useState(false);
  const [textVal, setTextVal] = useState('');
  const [textPlacementPos, setTextPlacementPos] = useState<any>(null);

  // Generate snap points (All karam intersections + cell boundary)
  const snapPoints = useRef<any[]>([]);
  useEffect(() => {
    const pts: any[] = [];
    for (let col = 0; col <= gridConfig.cellWidthKarams; col++) {
      for (let row = 0; row <= gridConfig.cellHeightKarams; row++) {
        pts.push({
          x: stagePadding + col * pixelsPerKaram,
          y: stagePadding + row * pixelsPerKaram,
          karamX: col,
          karamY: row,
        });
      }
    }
    snapPoints.current = pts;
  }, [gridConfig, pixelsPerKaram, stagePadding]);

  // History push
  const pushState = useCallback((newObjs: any[]) => {
    const updated = history.slice(0, historyIndex + 1);
    updated.push(newObjs);
    setHistory(updated);
    setHistoryIndex(updated.length - 1);
    setObjects(newObjs);
  }, [history, historyIndex]);

  const handleUndo = () => {
    if (historyIndex > 0) {
      const newIdx = historyIndex - 1;
      setHistoryIndex(newIdx);
      setObjects(history[newIdx]);
    }
  };

  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      const newIdx = historyIndex + 1;
      setHistoryIndex(newIdx);
      setObjects(history[newIdx]);
    }
  };

  // Convert raw stage pos to snap pos
  const resolveCoord = (pos: any) => {
    if (!snapEnabled) return pos;
    const snap = getClosestSnapPoint(pos, snapPoints.current, 18);
    if (snap) {
      setSnapIndicator({ x: snap.x, y: snap.y });
      return { x: snap.x, y: snap.y };
    }
    setSnapIndicator(null);
    return pos;
  };

  // Stage Mouse Events
  const handleStageMouseMove = (e: any) => {
    const stage = e.target.getStage();
    const raw = stage.getPointerPosition();
    if (!raw) return;
    // Divide by fitScale to convert from visual (scaled) pixels → stage-space pixels
    const pointerPos = { x: raw.x / fitScale, y: raw.y / fitScale };

    const resolved = resolveCoord(pointerPos);
    setCursorPos(resolved);

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

  const handleStageMouseDown = (e: any) => {
    if (e.target.name() === 'clickable-object' && activeTool === 'eraser') {
      const objId = e.target.id();
      const updated = objects.filter((o) => o.id !== objId);
      pushState(updated);
      return;
    }

    const stage = e.target.getStage();
    const raw = stage.getPointerPosition();
    if (!raw) return;
    // Divide by fitScale to convert from visual (scaled) pixels → stage-space pixels
    const pointerPos = { x: raw.x / fitScale, y: raw.y / fitScale };
    const resolved = resolveCoord(pointerPos);

    if (activeTool === 'polygon') {
      // Add vertex to polygon
      setCurrentPoints((prev) => [...prev, resolved.x, resolved.y]);
    } else if (activeTool === 'text') {
      setTextPlacementPos(resolved);
      setTextVal('');
      setTextInputOpen(true);
    } else if (activeTool === 'rect' || activeTool === 'circle' || activeTool === 'line') {
      setDragStart(resolved);
    }
  };

  const handleStageMouseUp = () => {
    if (dragStart && tempShape) {
      const newObj = {
        id: `obj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        ...tempShape,
        stroke: strokeColor,
        strokeWidth,
        fill: fillColor,
      };
      pushState([...objects, newObj]);
    }
    setDragStart(null);
    setTempShape(null);
  };

  const handleFinishPolygon = () => {
    if (currentPoints.length >= 6) {
      const newPoly = {
        id: `poly_${Date.now()}`,
        type: 'polygon',
        points: currentPoints,
        stroke: strokeColor,
        strokeWidth,
        fill: fillColor,
        closed: true,
      };
      pushState([...objects, newPoly]);
    }
    setCurrentPoints([]);
  };

  const handleSaveText = () => {
    if (textVal.trim() && textPlacementPos) {
      const newText = {
        id: `txt_${Date.now()}`,
        type: 'text',
        x: textPlacementPos.x,
        y: textPlacementPos.y,
        text: textVal,
        fontSize: 16,
        fontFamily: 'Inter, Arial',
        fill: strokeColor,
      };
      pushState([...objects, newText]);
    }
    setTextInputOpen(false);
    setTextPlacementPos(null);
    setTextVal('');
  };

  const handleSave = () => {
    onSaveCell(cellKey, {
      label: cellData?.label || cellKey,
      objects,
    });
    onClose();
  };

  // ── Segment-length label helpers ─────────────────────────────────────────
  // Traditional cadastral/plat convention: each edge's length is written
  // just OUTSIDE the boundary, running parallel to that edge (horizontal
  // sides get upright horizontal text; vertical sides get text rotated to
  // read up/down alongside the edge) — not stamped on top of the line.
  const segLenK = (x1: number, y1: number, x2: number, y2: number) =>
    Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2) / pixelsPerKaram;

  const LABEL_OFFSET = 15; // px (stage-space) gap between the edge and its label

  const buildSegLabels = (pts: number[], closed: boolean, centroid?: any) => {
    const lbls: any[] = [];

    const addSeg = (x1: number, y1: number, x2: number, y2: number) => {
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < 1e-6) return;
      const txt = formatLinearKaram(len / pixelsPerKaram);
      if (!txt) return;

      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;

      // Unit normal (perpendicular to the edge)
      let nx = -dy / len;
      let ny = dx / len;

      if (centroid) {
        // Push the label to the OUTSIDE of the shape: if the normal points
        // toward the centroid, flip it.
        const toCentX = centroid.x - mx;
        const toCentY = centroid.y - my;
        if (nx * toCentX + ny * toCentY > 0) {
          nx = -nx;
          ny = -ny;
        }
      } else {
        // Open polylines have no "outside" — default to above for horizontal
        // edges and to the left for vertical edges (standard plat placement).
        if (Math.abs(dy) < 0.01 && ny > 0) { nx = -nx; ny = -ny; }
        else if (Math.abs(dx) < 0.01 && nx > 0) { nx = -nx; ny = -ny; }
      }

      // Orient the text parallel to its edge, kept upright (never upside-down)
      let rot = Math.atan2(dy, dx) * 180 / Math.PI;
      if (rot > 90) rot -= 180;
      if (rot < -90) rot += 180;

      lbls.push({
        x: mx + nx * LABEL_OFFSET,
        y: my + ny * LABEL_OFFSET,
        txt,
        rot,
      });
    };

    for (let i = 0; i + 3 < pts.length; i += 2) {
      addSeg(pts[i], pts[i + 1], pts[i + 2], pts[i + 3]);
    }
    if (closed && pts.length >= 6) {
      const n = pts.length;
      addSeg(pts[n - 2], pts[n - 1], pts[0], pts[1]);
    }
    return lbls;
  };

  // Renders one length-label badge, rotated to run alongside its edge and
  // kept a constant visual size regardless of the stage's fitScale.
  const segLabel = (lbl: any, fill: string, key: string | number) => (
    <Group key={key} x={lbl.x} y={lbl.y} rotation={lbl.rot} scaleX={1 / fitScale} scaleY={1 / fitScale}>
      <Rect x={-22} y={-9} width={44} height={18} fill={fill} cornerRadius={4} />
      <KonvaText x={-22} y={-5} text={lbl.txt} fontSize={11} fill="#ffffff" fontStyle="bold" width={44} align="center" />
    </Group>
  );

  if (!show) return null;

  return (
    <div className="cell-editor-overlay">
      <div className="cell-editor-container">
        {/* Editor Modal Header */}
        <div className="cell-editor-header" ref={headerRef}>
          <div className="cell-header-left">
            <span className="cell-badge-large">Cell: {cellKey}</span>
            <span className="cell-header-title">
              {gridConfig.cellWidthKarams} × {gridConfig.cellHeightKarams} Karams (
              {(gridConfig.cellWidthKarams * KARAM_FEET).toFixed(1)} ×{' '}
              {(gridConfig.cellHeightKarams * KARAM_FEET).toFixed(1)} ft)
            </span>
          </div>

          {/* Quick Sub-toolbar in Cell Editor */}
          <div className="cell-editor-tools">
            <button
              className={`cell-tool-btn ${activeTool === 'polygon' ? 'active' : ''}`}
              onClick={() => setActiveTool('polygon')}
              title="Draw Polygon (Click vertices, click 'Finish' or double-click)"
            >
              <Pentagon size={I} /> Polygon
            </button>
            {currentPoints.length >= 6 && (
              <button className="finish-poly-btn" onClick={handleFinishPolygon}>
                <Check size={I} /> Close Polygon
              </button>
            )}
            <button
              className={`cell-tool-btn ${activeTool === 'line' ? 'active' : ''}`}
              onClick={() => setActiveTool('line')}
              title="Draw Boundary Line (Drag start to end)"
            >
              <Pencil size={I} /> Line
            </button>
            <button
              className={`cell-tool-btn ${activeTool === 'rect' ? 'active' : ''}`}
              onClick={() => setActiveTool('rect')}
              title="Rectangle Plot"
            >
              <Square size={I} /> Rect
            </button>
            <button
              className={`cell-tool-btn ${activeTool === 'circle' ? 'active' : ''}`}
              onClick={() => setActiveTool('circle')}
              title="Circle / Well"
            >
              <CircleIcon size={I} /> Well
            </button>
            <button
              className={`cell-tool-btn ${activeTool === 'text' ? 'active' : ''}`}
              onClick={() => setActiveTool('text')}
              title="Add Khasra # / Name Text"
            >
              <Type size={I} /> Label
            </button>
            <button
              className={`cell-tool-btn ${activeTool === 'eraser' ? 'active' : ''}`}
              onClick={() => setActiveTool('eraser')}
              title="Eraser (Click any drawn shape to delete)"
            >
              <Eraser size={I} /> Erase
            </button>

            <div className="vert-sep" />

            <label className="cell-color-btn" title="Fill Color">
              <span>Fill</span>
              <input
                type="color"
                value={fillColor === 'transparent' ? '#ffffff' : fillColor}
                onChange={(e) => setFillColor(e.target.value)}
              />
            </label>
            <label className="cell-color-btn" title="Stroke Color">
              <span>Line</span>
              <input
                type="color"
                value={strokeColor}
                onChange={(e) => setStrokeColor(e.target.value)}
              />
            </label>

            <button
              className={`cell-tool-btn ${snapEnabled ? 'active-accent' : ''}`}
              onClick={() => setSnapEnabled(!snapEnabled)}
              title="Toggle Snap to Karam intersections"
            >
              <Magnet size={I} /> Snap
            </button>

            <button className="cell-tool-btn" onClick={handleUndo} disabled={historyIndex <= 0}>
              <Undo2 size={I} />
            </button>
            <button className="cell-tool-btn" onClick={handleRedo} disabled={historyIndex >= history.length - 1}>
              <Redo2 size={I} />
            </button>
          </div>

          <div className="cell-header-actions">
            <button className="btn-cancel" onClick={onClose}>
              Cancel
            </button>
            <button
              className="btn-clear-cell"
              title="Delete all shapes drawn in this cell (Kill)"
              onClick={async () => {
                if (await dialog.confirm('Clear all drawings in this cell? This cannot be undone.', { variant: 'danger', okLabel: 'Clear Cell' })) {
                  pushState([]);
                }
              }}
            >
              <Trash2 size={I} /> Clear Cell
            </button>
            <button className="btn-apply-save" onClick={handleSave}>
              <Check size={I} /> Save Cell
            </button>
          </div>
        </div>

        {/* Editor Body Canvas – Stage scaled by fitScale to fit modal */}
        <div className="cell-canvas-wrapper">
          <Stage
            width={Math.round(stageWidth * fitScale)}
            height={Math.round(stageHeight * fitScale)}
            scaleX={fitScale}
            scaleY={fitScale}
            onPointerMove={handleStageMouseMove}
            onPointerDown={handleStageMouseDown}
            onPointerUp={handleStageMouseUp}
            onDblClick={handleFinishPolygon}
            onDblTap={handleFinishPolygon}
            className="cell-stage"
          >
            {/* 1. Background and Karam Grid Layer */}
            <Layer>
              {/* Surrounding background */}
              <Rect x={0} y={0} width={stageWidth} height={stageHeight} fill="#f1f5f9" />

              {/* Cell Background */}
              <Rect
                x={stagePadding}
                y={stagePadding}
                width={cellWidthPx}
                height={cellHeightPx}
                fill="#ffffff"
                stroke="#0f172a"
                strokeWidth={2}
                shadowColor="rgba(0,0,0,0.08)"
                shadowBlur={10}
              />

              {/* Minor Karam Grid lines */}
              {Array.from({ length: gridConfig.cellWidthKarams + 1 }).map((_, c) => {
                const x = stagePadding + c * pixelsPerKaram;
                return (
                  <Group key={`col_${c}`}>
                    <Line
                      points={[x, stagePadding, x, stagePadding + cellHeightPx]}
                      stroke={c === 0 || c === gridConfig.cellWidthKarams ? '#0f172a' : '#cbd5e1'}
                      strokeWidth={c === 0 || c === gridConfig.cellWidthKarams ? 2 : 1}
                      dash={c === 0 || c === gridConfig.cellWidthKarams ? [] : [4, 4]}
                    />
                    {/* Column Header Karam Number */}
                    <KonvaText
                      x={x - 12}
                      y={stagePadding - 24}
                      text={`K${c}`}
                      fontSize={11}
                      fill="#64748b"
                      fontStyle="bold"
                    />
                  </Group>
                );
              })}

              {Array.from({ length: gridConfig.cellHeightKarams + 1 }).map((_, r) => {
                const y = stagePadding + r * pixelsPerKaram;
                return (
                  <Group key={`row_${r}`}>
                    <Line
                      points={[stagePadding, y, stagePadding + cellWidthPx, y]}
                      stroke={r === 0 || r === gridConfig.cellHeightKarams ? '#0f172a' : '#cbd5e1'}
                      strokeWidth={r === 0 || r === gridConfig.cellHeightKarams ? 2 : 1}
                      dash={r === 0 || r === gridConfig.cellHeightKarams ? [] : [4, 4]}
                    />
                    {/* Row Header Karam Number */}
                    <KonvaText
                      x={stagePadding - 32}
                      y={y - 6}
                      text={`K${r}`}
                      fontSize={11}
                      fill="#64748b"
                      fontStyle="bold"
                    />
                  </Group>
                );
              })}
            </Layer>

            {/* 2. Objects Layer (Polygons, Lines, Texts) */}
            <Layer>
              {objects.map((obj) => {
                if (obj.type === 'polygon') {
                  const areaSqKarams =
                    calculatePolygonArea(obj.points) / (pixelsPerKaram * pixelsPerKaram);
                  const centroid = calculateCentroid(obj.points);
                  const segLabels = buildSegLabels(obj.points, true, centroid);
                  return (
                    <Group key={obj.id} id={obj.id} name="clickable-object">
                      <Line
                        points={obj.points}
                        closed
                        fill={obj.fill || '#e8f5e9'}
                        stroke={obj.stroke || '#0f172a'}
                        strokeWidth={obj.strokeWidth || 2}
                      />
                      {areaSqKarams > 0.5 && (
                        <Group x={centroid.x} y={centroid.y} scaleX={1 / fitScale} scaleY={1 / fitScale}>
                          <KonvaText
                            x={-25}
                            y={-6}
                            text={formatKaramToArea(areaSqKarams)}
                            fontSize={11}
                            fontStyle="bold"
                            fill="#047857"
                          />
                        </Group>
                      )}
                      {/* Per-segment karam length labels — outside the boundary, parallel to each edge */}
                      {segLabels.map((lbl, li) => (
                        segLabel(lbl, 'rgba(30,64,175,0.85)', li)
                      ))}
                    </Group>
                  );
                }
                if (obj.type === 'line') {
                  const segLabels = buildSegLabels(obj.points, false);
                  return (
                    <Group key={obj.id}>
                      <Line
                        id={obj.id}
                        name="clickable-object"
                        points={obj.points}
                        stroke={obj.stroke || '#0f172a'}
                        strokeWidth={obj.strokeWidth || 2}
                        lineCap="round"
                      />
                      {/* Per-segment karam length labels — offset alongside each edge */}
                      {segLabels.map((lbl, li) => (
                        segLabel(lbl, 'rgba(71,85,105,0.85)', li)
                      ))}
                    </Group>
                  );
                }
                if (obj.type === 'rect') {
                  return (
                    <Rect
                      key={obj.id}
                      id={obj.id}
                      name="clickable-object"
                      x={obj.x}
                      y={obj.y}
                      width={obj.width}
                      height={obj.height}
                      fill={obj.fill}
                      stroke={obj.stroke}
                      strokeWidth={obj.strokeWidth}
                    />
                  );
                }
                if (obj.type === 'circle') {
                  return (
                    <Circle
                      key={obj.id}
                      id={obj.id}
                      name="clickable-object"
                      x={obj.x}
                      y={obj.y}
                      radius={obj.radius}
                      fill={obj.fill}
                      stroke={obj.stroke}
                      strokeWidth={obj.strokeWidth}
                    />
                  );
                }
                if (obj.type === 'text') {
                  return (
                    <KonvaText
                      key={obj.id}
                      id={obj.id}
                      name="clickable-object"
                      x={obj.x}
                      y={obj.y}
                      text={obj.text}
                      fontSize={obj.fontSize || 16}
                      fontFamily={obj.fontFamily || 'Inter, Arial'}
                      fill={obj.fill || '#0f172a'}
                      fontStyle="bold"
                    />
                  );
                }
                return null;
              })}

              {/* Temporary Drawing Shapes */}
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

              {/* Polygon current points (rubber-band preview) */}
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
              {/* Committed segment karam labels (in-progress polygon) */}
              {buildSegLabels(currentPoints, false).map((lbl, li) => (
                segLabel(lbl, 'rgba(2,132,199,0.85)', `cpl_${li}`)
              ))}
              {/* Live rubber-band segment length near cursor */}
              {currentPoints.length >= 2 && cursorPos && (() => {
                const lastX = currentPoints[currentPoints.length - 2];
                const lastY = currentPoints[currentPoints.length - 1];
                const k = segLenK(lastX, lastY, cursorPos.x, cursorPos.y);
                const txt = formatLinearKaram(k);
                if (!txt) return null;
                const mx = (lastX + cursorPos.x) / 2;
                const my = (lastY + cursorPos.y) / 2;
                return (
                  <Group x={mx} y={my} scaleX={1 / fitScale} scaleY={1 / fitScale}>
                    <Rect x={-24} y={-11} width={48} height={22} fill="rgba(2,132,199,0.95)" cornerRadius={5} />
                    <KonvaText x={-24} y={-6} text={txt} fontSize={12} fill="#ffffff" fontStyle="bold" width={48} align="center" />
                  </Group>
                );
              })()}
              {currentPoints.map((_val, idx) => {
                if (idx % 2 !== 0) return null;
                return (
                  <Circle
                    key={`pt_${idx}`}
                    x={currentPoints[idx]}
                    y={currentPoints[idx + 1]}
                    radius={5}
                    fill="#0284c7"
                    stroke="#ffffff"
                    strokeWidth={2}
                  />
                );
              })}

              {/* ── Real-time cursor crosshair + karam coordinate badge ────────── */}
              {cursorPos && (() => {
                // Integer karams (karam is a whole-unit measure)
                const karamX = Math.round(Math.max(0, (cursorPos.x - stagePadding) / pixelsPerKaram));
                const karamY = Math.round(Math.max(0, (cursorPos.y - stagePadding) / pixelsPerKaram));
                const iw = 1 / fitScale; // 1 visual px in stage-space units

                // Badge dimensions in visual pixels
                const BW = 102, BH = 46, GAP = 10;

                // Available space around cursor (in visual pixels)
                const spaceAbove = (cursorPos.y - stagePadding) * fitScale;
                const spaceRight = (stagePadding + cellWidthPx - cursorPos.x) * fitScale;

                // Flip badge below cursor when top space is tight
                const flipY = spaceAbove < BH + GAP + 12;
                // Flip badge left of cursor when right space is tight
                const flipX = spaceRight < BW + GAP + 8;

                // Badge anchor offset (in visual pixels, inside scale-invariant Group)
                const bx = flipX ? -(BW + GAP) : GAP;
                const by = flipY ? GAP : -(BH + GAP);

                // Adjust corner-radius based on which corner badge anchor sits
                const cr = flipX
                  ? (flipY ? [0, 6, 6, 6] : [6, 6, 6, 0])
                  : (flipY ? [6, 0, 6, 6] : [6, 6, 0, 6]);

                return (
                  <>
                    {/* Vertical crosshair */}
                    <Line
                      points={[cursorPos.x, stagePadding, cursorPos.x, stagePadding + cellHeightPx]}
                      stroke="rgba(56,189,248,0.45)"
                      strokeWidth={iw}
                      dash={[5 * iw, 5 * iw]}
                      listening={false}
                    />
                    {/* Horizontal crosshair */}
                    <Line
                      points={[stagePadding, cursorPos.y, stagePadding + cellWidthPx, cursorPos.y]}
                      stroke="rgba(56,189,248,0.45)"
                      strokeWidth={iw}
                      dash={[5 * iw, 5 * iw]}
                      listening={false}
                    />
                    {/* Scale-invariant coordinate badge — always stays inside cell */}
                    <Group x={cursorPos.x} y={cursorPos.y} scaleX={iw} scaleY={iw}>
                      {/* badge background */}
                      <Rect
                        x={bx} y={by}
                        width={BW} height={BH}
                        fill="rgba(15,23,42,0.92)"
                        cornerRadius={cr}
                        stroke="rgba(56,189,248,0.55)"
                        strokeWidth={1}
                      />
                      {/* H colour bar */}
                      <Rect x={bx} y={by} width={3} height={22}
                        fill="#38bdf8"
                        cornerRadius={flipX ? [0, 0, 0, 0] : [cr[0], 0, 0, 0]}
                      />
                      {/* V colour bar */}
                      <Rect x={bx} y={by + 22} width={3} height={24}
                        fill="#34d399"
                        cornerRadius={[0, 0, 0, 0]}
                      />
                      {/* H karam value */}
                      <KonvaText
                        x={bx + 8} y={by + 6}
                        text={`H: ${karamX} K`}
                        fontSize={12} fontStyle="bold"
                        fontFamily="'Courier New', monospace"
                        fill="#38bdf8"
                      />
                      {/* V karam value */}
                      <KonvaText
                        x={bx + 8} y={by + 26}
                        text={`V: ${karamY} K`}
                        fontSize={12} fontStyle="bold"
                        fontFamily="'Courier New', monospace"
                        fill="#34d399"
                      />
                    </Group>
                  </>
                );
              })()}

              {/* Snapping Cursor Indicator – scale-invariant ring */}
              {snapIndicator && (
                <Circle
                  x={snapIndicator.x}
                  y={snapIndicator.y}
                  radius={7 / fitScale}
                  fill="rgba(16, 185, 129, 0.4)"
                  stroke="#10b981"
                  strokeWidth={2 / fitScale}
                />
              )}
            </Layer>
          </Stage>
        </div>

        {/* Text Input Mini Prompt */}
        {textInputOpen && (
          <div className="text-prompt-modal">
            <h6>Enter Khasra #, Area, or Label</h6>
            <input
              type="text"
              autoFocus
              placeholder="e.g. Khasra 1234 (4K 12M)"
              value={textVal}
              onChange={(e) => setTextVal(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveText()}
            />
            <div className="text-prompt-actions">
              <button onClick={() => setTextInputOpen(false)}>Cancel</button>
              <button className="confirm-btn" onClick={handleSaveText}>
                Place Label
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CellEditorModal;
