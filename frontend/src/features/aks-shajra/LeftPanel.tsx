// Ported from legacy src/components/AksShajra/LeftPanel.js
import { useState, type FormEvent } from 'react';
import { X, Plus, Trash2, Layers, Settings, MapPin, Stamp } from 'lucide-react';
import { PAPER_SIZES, SCALE_OPTIONS, PRESET_SYMBOLS, KARAM_FEET } from './shajraConstants';

/** One legend row. Label edits are kept locally and committed on blur (D7: no history entry per keystroke). */
const LegendRow = ({ item, onChangeColor, onCommitLabel, onDelete }: any) => {
  const [label, setLabel] = useState(item.label);
  const [prevLabel, setPrevLabel] = useState(item.label);
  if (prevLabel !== item.label) {
    // Re-sync after Undo/Open/New
    setPrevLabel(item.label);
    setLabel(item.label);
  }
  return (
    <div className="legend-row">
      <input type="color" className="legend-color-input" value={item.color} onChange={(e) => onChangeColor(e.target.value)} />
      <input
        type="text"
        className="legend-text-input"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onBlur={() => label !== item.label && onCommitLabel(label)}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <button className="legend-del-btn" onClick={onDelete} title="Delete">
        <Trash2 size={13} />
      </button>
    </div>
  );
};

const LeftPanel = ({
  isOpen,
  onClose,
  gridConfig,
  onUpdateGridConfig,
  paperConfig,
  onUpdatePaperConfig,
  cellsData,
  activeCellKey,
  onSelectCell,
  onAddSymbol,
  legendList,
  onUpdateLegend,
}: any) => {
  const [activeTab, setActiveTab] = useState('grid'); // 'grid' | 'layers' | 'symbols' | 'legend'

  // Local state for grid inputs before applying
  const [tempRows, setTempRows] = useState<any>(gridConfig.rows);
  const [tempCols, setTempCols] = useState<any>(gridConfig.cols);
  const [tempCellWidth, setTempCellWidth] = useState<any>(gridConfig.cellWidthKarams);
  const [tempCellHeight, setTempCellHeight] = useState<any>(gridConfig.cellHeightKarams);
  const [tempPixelsPerKaram, setTempPixelsPerKaram] = useState<any>(gridConfig.pixelsPerKaram || 16);

  // D7 fix: re-sync the temp inputs whenever the grid changes from outside (Open / New / Undo / Apply)
  const [prevGrid, setPrevGrid] = useState(gridConfig);
  if (prevGrid !== gridConfig) {
    setPrevGrid(gridConfig);
    setTempRows(gridConfig.rows);
    setTempCols(gridConfig.cols);
    setTempCellWidth(gridConfig.cellWidthKarams);
    setTempCellHeight(gridConfig.cellHeightKarams);
    setTempPixelsPerKaram(gridConfig.pixelsPerKaram || 16);
  }

  const handleApplyGrid = (e: FormEvent) => {
    e.preventDefault();
    onUpdateGridConfig({
      rows: Math.max(1, Math.min(30, parseInt(tempRows, 10) || 8)),
      cols: Math.max(1, Math.min(30, parseInt(tempCols, 10) || 8)),
      cellWidthKarams: Math.max(1, parseInt(tempCellWidth, 10) || 5),
      cellHeightKarams: Math.max(1, parseInt(tempCellHeight, 10) || 4),
      pixelsPerKaram: Math.max(8, Math.min(40, parseInt(tempPixelsPerKaram, 10) || 16)),
    });
  };

  // D7 fix: copy-on-write legend edits (never mutate DEFAULT_LEGEND or history snapshots)
  const patchLegend = (idx: number, patch: any) =>
    onUpdateLegend(legendList.map((it: any, i: number) => (i === idx ? { ...it, ...patch } : it)));

  const tab = (key: string, title: string, icon: any, text: string) => (
    <button className={`tab-btn ${activeTab === key ? 'active' : ''}`} onClick={() => setActiveTab(key)} title={title}>
      {icon} {text}
    </button>
  );

  return (
    <div className={`shajra-left-panel ${isOpen ? 'open' : 'closed'}`}>
      <div className="panel-header">
        <div className="panel-tabs">
          {tab('grid', 'Grid & Paper Setup', <Settings size={12} />, 'Grid')}
          {tab('layers', 'Drawn Layers / Cells', <Layers size={12} />, 'Cells')}
          {tab('symbols', 'Patwari Symbols Library', <Stamp size={12} />, 'Symbols')}
          {tab('legend', 'Map Legend', <MapPin size={12} />, 'Legend')}
        </div>
        <button className="panel-close-btn" onClick={onClose} title="Close Panel">
          <X size={14} />
        </button>
      </div>

      <div className="panel-body">
        {/* TAB 1: GRID & PAPER */}
        {activeTab === 'grid' && (
          <div className="tab-section">
            <h6 className="section-title">📐 Master Grid Setup</h6>
            <form onSubmit={handleApplyGrid} className="grid-form">
              <div className="form-row-2">
                <div className="form-group">
                  <label>Rows (سطریں)</label>
                  <input type="number" min="1" max="30" value={tempRows} onChange={(e) => setTempRows(e.target.value)} />
                </div>
                <div className="form-group">
                  <label>Cols (کالم)</label>
                  <input type="number" min="1" max="30" value={tempCols} onChange={(e) => setTempCols(e.target.value)} />
                </div>
              </div>

              <div className="form-row-2">
                <div className="form-group">
                  <label>Cell Width (Karams)</label>
                  <input type="number" min="1" value={tempCellWidth} onChange={(e) => setTempCellWidth(e.target.value)} />
                  <span className="field-hint">{(tempCellWidth * KARAM_FEET).toFixed(1)} ft</span>
                </div>
                <div className="form-group">
                  <label>Cell Height (Karams)</label>
                  <input type="number" min="1" value={tempCellHeight} onChange={(e) => setTempCellHeight(e.target.value)} />
                  <span className="field-hint">{(tempCellHeight * KARAM_FEET).toFixed(1)} ft</span>
                </div>
              </div>

              <div className="form-group">
                <label>Display Density (Pixels per Karam)</label>
                <div className="range-with-val">
                  <input
                    type="range"
                    min="10"
                    max="32"
                    value={tempPixelsPerKaram}
                    onChange={(e) => setTempPixelsPerKaram(e.target.value)}
                  />
                  <span>{tempPixelsPerKaram}px</span>
                </div>
              </div>

              <button type="submit" className="apply-btn">
                Apply Grid Changes
              </button>
            </form>

            <div className="divider-hr" />

            <h6 className="section-title">📄 Paper & Layout</h6>
            <div className="paper-form">
              <div className="form-group">
                <label>Paper Size</label>
                <select value={paperConfig.paperSize} onChange={(e) => onUpdatePaperConfig({ paperSize: e.target.value })}>
                  {Object.keys(PAPER_SIZES).map((key) => (
                    <option key={key} value={key}>
                      {PAPER_SIZES[key].name} ({PAPER_SIZES[key].widthMm} × {PAPER_SIZES[key].heightMm} mm)
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Orientation</label>
                <div className="orientation-btns">
                  <button
                    type="button"
                    className={`toggle-pill ${paperConfig.orientation === 'portrait' ? 'active' : ''}`}
                    onClick={() => onUpdatePaperConfig({ orientation: 'portrait' })}
                  >
                    Portrait (عمودی)
                  </button>
                  <button
                    type="button"
                    className={`toggle-pill ${paperConfig.orientation === 'landscape' ? 'active' : ''}`}
                    onClick={() => onUpdatePaperConfig({ orientation: 'landscape' })}
                  >
                    Landscape (افقی)
                  </button>
                </div>
              </div>

              <div className="form-group">
                <label>Cadastral Scale</label>
                <select value={paperConfig.scale} onChange={(e) => onUpdatePaperConfig({ scale: e.target.value })}>
                  {SCALE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.label}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: CELLS / LAYERS */}
        {activeTab === 'layers' && (
          <div className="tab-section">
            <h6 className="section-title">📂 Grid Cells & Objects</h6>
            <div className="cell-list">
              {Object.keys(cellsData).length === 0 ? (
                <div className="empty-hint">
                  No drawn objects yet. Click any cell on the canvas to open the <strong>Cell Editor</strong> and draw khasras, lines, or labels!
                </div>
              ) : (
                Object.keys(cellsData).map((cellKey) => {
                  const cell = cellsData[cellKey];
                  const objCount = cell?.objects?.length || 0;
                  if (objCount === 0) return null;
                  return (
                    <div
                      key={cellKey}
                      className={`cell-layer-item ${activeCellKey === cellKey ? 'active' : ''}`}
                      onClick={() => onSelectCell(cellKey)}
                    >
                      <div className="cell-item-info">
                        <span className="cell-tag">{cellKey}</span>
                        <span className="cell-label">{cell.label || `Cell ${cellKey}`}</span>
                        <span className="cell-badge">{objCount} objects</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* TAB 3: SYMBOLS LIBRARY */}
        {activeTab === 'symbols' && (
          <div className="tab-section">
            <h6 className="section-title">🏛️ Cadastral Symbols</h6>
            <p className="section-subtitle">Click a symbol to place on active canvas / selected cell:</p>
            <div className="symbols-grid">
              {PRESET_SYMBOLS.map((sym) => (
                <div key={sym.id} className="symbol-card" onClick={() => onAddSymbol(sym)} title={`Add ${sym.name}`}>
                  <span className="symbol-icon">{sym.icon}</span>
                  <span className="symbol-name">{sym.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 4: LEGEND */}
        {activeTab === 'legend' && (
          <div className="tab-section">
            <div className="flex items-center justify-between mb-2">
              <h6 className="section-title !mb-0">🏷️ Map Legend</h6>
              <button
                className="btn-link-add"
                onClick={() =>
                  onUpdateLegend([
                    ...legendList,
                    { id: `l_${Date.now()}`, color: '#fef08a', stroke: '#ca8a04', label: 'New Classification' },
                  ])
                }
              >
                <Plus size={12} /> Add
              </button>
            </div>
            <div className="legend-items">
              {legendList.map((item: any, idx: number) => (
                <LegendRow
                  key={item.id || idx}
                  item={item}
                  onChangeColor={(color: string) => patchLegend(idx, { color })}
                  onCommitLabel={(label: string) => patchLegend(idx, { label })}
                  onDelete={() => onUpdateLegend(legendList.filter((_: any, i: number) => i !== idx))}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default LeftPanel;
