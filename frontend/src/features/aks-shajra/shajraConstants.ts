// Ported from legacy src/components/AksShajra/shajraConstants.js — values are byte-identical (saved drafts depend on them).

export const KARAM_FEET = 5.5; // 1 Karam = 5.5 ft
export const KARAMS_PER_MARLA = 9; // 3 x 3 karams = 9 sq karams = 1 Marla
export const MARLAS_PER_KANAL = 20; // 20 Marlas = 1 Kanal
export const KANALS_PER_ACRE = 8; // 8 Kanals = 1 Acre

export const PAPER_SIZES: Record<string, { name: string; widthMm: number; heightMm: number; pixelRatio: number }> = {
  A4: { name: 'A4', widthMm: 210, heightMm: 297, pixelRatio: 3.7795 },
  A3: { name: 'A3', widthMm: 297, heightMm: 420, pixelRatio: 3.7795 },
  A2: { name: 'A2', widthMm: 420, heightMm: 594, pixelRatio: 3.7795 },
  Legal: { name: 'Legal', widthMm: 216, heightMm: 356, pixelRatio: 3.7795 },
};

export const SCALE_OPTIONS = [
  { label: '1:250', value: 250 },
  { label: '1:500', value: 500 },
  { label: '1:1000', value: 1000 },
  { label: '1:1250', value: 1250 },
  { label: '1:2500', value: 2500 },
  { label: '1:5000', value: 5000 },
];

export const NORTH_ARROW_STYLES = [
  { id: 'standard', name: 'Standard Arrow' },
  { id: 'compass', name: 'Compass Rose' },
  { id: 'simple', name: 'Minimalist' },
  { id: 'traditional', name: 'Traditional Patwari' },
];

export const PRESET_SYMBOLS = [
  { id: 'well', name: 'Kuan / Well (چاہ / کنواں)', icon: '⭕', color: '#0284c7' },
  { id: 'tube_well', name: 'Tube-well (ٹیوب ویل)', icon: '⚙️', color: '#0369a1' },
  { id: 'tree', name: 'Tree (درخت)', icon: '🌳', color: '#15803d' },
  { id: 'mosque', name: 'Mosque (مسجد)', icon: '🕌', color: '#047857' },
  { id: 'graveyard', name: 'Graveyard (قبرستان)', icon: '⚰️', color: '#64748b' },
  { id: 'house', name: 'Dera / House (ڈیرہ / مکان)', icon: '🏠', color: '#b45309' },
  { id: 'culvert', name: 'Pulia / Culvert (پلیہ)', icon: '═', color: '#334155' },
];

export const DEFAULT_LEGEND = [
  { id: 'l1', color: '#e8f5e9', stroke: '#15803d', label: 'Agriculture Land (اراضی زرعی)' },
  { id: 'l2', color: '#e0f2fe', stroke: '#0284c7', label: 'Watercourse / Khal (کھال / نالہ)' },
  { id: 'l3', color: '#f1f5f9', stroke: '#475569', label: 'Rasta / Pathway (راستہ عام)' },
  { id: 'l4', color: '#fef3c7', stroke: '#d97706', label: 'Abadi Deh (آبادی دہ)' },
];

export const INITIAL_PROJECT_STATE: any = {
  metadata: {
    title: 'Aks Shajra Parcha (اکس شجرہ پارچہ)',
    village: '',
    mauza: '',
    hadbastNo: '',
    murabba: '',       // Murabba / Mutateel Number
    tehsil: '',
    district: '',
    date: new Date().toISOString().split('T')[0],
    preparedBy: '',
    checkedBy: '',
    scale: '1:1000',
    paperSize: 'A3',
    orientation: 'portrait',
  },
  grid: {
    rows: 8,
    cols: 8,
    cellWidthKarams: 5,
    cellHeightKarams: 4,
    pixelsPerKaram: 16,
  },
  cells: {},
  legend: DEFAULT_LEGEND,
  northArrowStyle: 'standard',
};

// Calculation helpers
export const karamsToFeet = (karams: number) => karams * KARAM_FEET;
export const feetToKarams = (feet: number) => feet / KARAM_FEET;

export const formatKaramToArea = (sqKarams: number) => {
  const marlas = sqKarams / KARAMS_PER_MARLA;
  if (marlas < 20) {
    return `${marlas.toFixed(1)} Marlas`;
  }
  const kanals = Math.floor(marlas / MARLAS_PER_KANAL);
  const remMarlas = (marlas % MARLAS_PER_KANAL).toFixed(1);
  return `${kanals}K ${remMarlas}M`;
};

// Format a linear length in Karams for segment labels
export const formatLinearKaram = (karams: number) => {
  if (karams < 0.05) return '';
  const r = Math.round(karams * 10) / 10;
  return `${r.toFixed(1)}K`;
};


// Cell Editor coordinate space (baked into every saved project — never change).
export const EDITOR_ZOOM = 3.5;
export const EDITOR_PAD = 45;
