// Ported from legacy src/components/AksShajra/TopToolbar.js
import { useRef, type ChangeEvent, type ReactNode } from 'react';
import {
  MousePointer2, Pencil, Pentagon, Type, Square, Circle, Eraser, Undo2, Redo2, Magnet,
  ZoomIn, ZoomOut, Expand, FileDown, Save, FolderOpen, LayoutGrid, Info,
} from 'lucide-react';
import { useDialog } from '@/shared/ui';

const I = 14;

const TopToolbar = ({
  activeTool,
  setActiveTool,
  strokeColor,
  setStrokeColor,
  fillColor,
  setFillColor,
  strokeWidth,
  setStrokeWidth,
  dashStyle,
  setDashStyle,
  snapEnabled,
  setSnapEnabled,
  showGuide,
  setShowGuide,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  zoom,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onNewProject,
  onSaveJSON,
  onLoadJSON,
  onOpenExportModal,
  onToggleLeftPanel,
  showLeftPanel,
  onToggleMetadataModal,
}: any) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dialog = useDialog();

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      let data: any;
      try {
        data = JSON.parse(String(event.target?.result));
      } catch {
        dialog.alert('Invalid JSON file', { variant: 'danger', title: 'Open Project' });
        return;
      }
      onLoadJSON(data);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const toolBtn = (tool: string, title: string, children: ReactNode) => (
    <button
      className={`toolbar-btn ${activeTool === tool ? 'active' : ''}`}
      onClick={() => setActiveTool(tool)}
      title={title}
    >
      {children}
    </button>
  );

  return (
    <div className="shajra-toolbar">
      {/* File Operations */}
      <div className="toolbar-group">
        <button
          className={`toolbar-btn ${showLeftPanel ? 'active' : ''}`}
          onClick={onToggleLeftPanel}
          title="Toggle Grid / Layers Panel"
        >
          <LayoutGrid size={I} />
          <span className="btn-label">Panels</span>
        </button>
        <button className="toolbar-btn" onClick={onNewProject} title="New Project">
          <span>📄</span>
          <span className="btn-label">New</span>
        </button>
        <button className="toolbar-btn" onClick={onSaveJSON} title="Save JSON Project">
          <Save size={I} />
          <span className="btn-label">Save</span>
        </button>
        <button className="toolbar-btn" onClick={() => fileInputRef.current?.click()} title="Open JSON Project">
          <FolderOpen size={I} />
          <span className="btn-label">Open</span>
        </button>
        <input type="file" ref={fileInputRef} style={{ display: 'none' }} accept=".json" onChange={handleFileChange} />
      </div>

      <div className="toolbar-divider" />

      {/* Undo / Redo */}
      <div className="toolbar-group">
        <button className="toolbar-btn" onClick={onUndo} disabled={!canUndo} title="Undo (Ctrl+Z)">
          <Undo2 size={I} />
        </button>
        <button className="toolbar-btn" onClick={onRedo} disabled={!canRedo} title="Redo (Ctrl+Y)">
          <Redo2 size={I} />
        </button>
      </div>

      <div className="toolbar-divider" />

      {/* Drawing Tools */}
      <div className="toolbar-group tools-selector">
        {toolBtn('select', 'Select / Move Object (V)', <MousePointer2 size={I} />)}
        {toolBtn('cellSelect', 'Cell Select / Zoom Mode (C) - Click cell to edit', (
          <>
            <span style={{ fontWeight: 'bold' }}>⊞</span>
            <span className="btn-label">Cell Edit</span>
          </>
        ))}
        {toolBtn('polygon', 'Draw Land Polygon (P) - Click points, double-click to finish', <Pentagon size={I} />)}
        {toolBtn('line', 'Draw Line / Boundary / Khal (L)', <Pencil size={I} />)}
        {toolBtn('rect', 'Draw Rectangle Plot / Room (R)', <Square size={I} />)}
        {toolBtn('circle', 'Draw Well / Roundabout / Tree (O)', <Circle size={I} />)}
        {toolBtn('text', 'Add Khasra # / Name Text (T)', <Type size={I} />)}
        {toolBtn('eraser', 'Eraser / Delete Object (E)', <Eraser size={I} />)}
      </div>

      <div className="toolbar-divider" />

      {/* Colors and Styles */}
      <div className="toolbar-group styles-group">
        <label className="color-picker-wrapper" title="Fill Color">
          <span className="color-label">Fill</span>
          <input
            type="color"
            value={fillColor === 'transparent' ? '#ffffff' : fillColor}
            onChange={(e) => setFillColor(e.target.value)}
          />
        </label>
        <button
          className={`mini-pill-btn ${fillColor === 'transparent' ? 'active' : ''}`}
          onClick={() => setFillColor(fillColor === 'transparent' ? '#e8f5e9' : 'transparent')}
          title="Toggle Transparent Fill"
        >
          {fillColor === 'transparent' ? '🚫' : 'Fill'}
        </button>

        <label className="color-picker-wrapper" title="Stroke / Line Color">
          <span className="color-label">Line</span>
          <input type="color" value={strokeColor} onChange={(e) => setStrokeColor(e.target.value)} />
        </label>

        <select
          className="toolbar-select"
          value={strokeWidth}
          onChange={(e) => setStrokeWidth(Number(e.target.value))}
          title="Line Width"
        >
          <option value="1">1 px</option>
          <option value="2">2 px</option>
          <option value="3">3 px (Thick)</option>
          <option value="5">5 px (Boundary)</option>
        </select>

        <select
          className="toolbar-select"
          value={dashStyle}
          onChange={(e) => setDashStyle(e.target.value)}
          title="Line Dash Style"
        >
          <option value="solid">Solid ──</option>
          <option value="dashed">Dashed - -</option>
          <option value="dotted">Dotted · ·</option>
        </select>
      </div>

      <div className="toolbar-divider" />

      {/* Snapping & Guides */}
      <div className="toolbar-group">
        <button
          className={`toolbar-btn ${snapEnabled ? 'active-accent' : ''}`}
          onClick={() => setSnapEnabled(!snapEnabled)}
          title={`Magnet Snap to Karam Intersections (${snapEnabled ? 'ON' : 'OFF'})`}
        >
          <Magnet size={I} />
          <span className="btn-label">Snap</span>
        </button>
        <button
          className={`toolbar-btn ${showGuide ? 'active-accent' : ''}`}
          onClick={() => setShowGuide(!showGuide)}
          title={`Show Minor Karam Subdivisions (${showGuide ? 'ON' : 'OFF'})`}
        >
          <span style={{ fontSize: '0.85rem' }}>📏</span>
          <span className="btn-label">Karams</span>
        </button>
      </div>

      <div className="toolbar-divider" />

      {/* Zoom Controls */}
      <div className="toolbar-group">
        <button className="toolbar-btn" onClick={onZoomOut} title="Zoom Out">
          <ZoomOut size={I} />
        </button>
        <span className="zoom-indicator" onClick={onResetZoom} title="Reset Zoom" role="button">
          {Math.round(zoom * 100)}%
        </span>
        <button className="toolbar-btn" onClick={onZoomIn} title="Zoom In">
          <ZoomIn size={I} />
        </button>
        <button className="toolbar-btn" onClick={onResetZoom} title="Fit to Screen">
          <Expand size={I} />
        </button>
      </div>

      {/* Right side Action Buttons */}
      <div className="toolbar-group ms-auto">
        <button className="toolbar-btn metadata-btn" onClick={onToggleMetadataModal} title="Map Title, Village & Metadata">
          <Info size={I} />
          <span className="btn-label">Metadata</span>
        </button>
        <button className="toolbar-btn export-btn" onClick={onOpenExportModal} title="Export Map to PDF or PNG">
          <FileDown size={I} />
          <span className="btn-label">Export Map</span>
        </button>
      </div>
    </div>
  );
};

export default TopToolbar;
