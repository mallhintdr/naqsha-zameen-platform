// Port of components/Admin/LandAllotmentTool.js (/admin/land-allotments). Map uses plain Leaflet.
import { useCallback, useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { FileDown, MapPinned, X } from 'lucide-react';
import { api } from '@/shared/api/client';
import { Alert, Badge, Spinner } from '@/shared/ui';
import './LandAllotmentPage.css';

const URDU_RE = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;
const ur = (v: any) => (URDU_RE.test(String(v ?? '')) ? <span className="urdu-text" dir="rtl">{v}</span> : v);

const COLUMNS = [
  { key: 'cnicRaw', param: 'cnic', sortField: 'cnic', label: 'CNIC', placeholder: 'e.g. 31103-7042992-8' },
  { key: 'fullName', param: 'fullName', sortField: 'fullName', label: 'Name', placeholder: 'Filter name...' },
  { key: 'lotTehsil', param: 'lotTehsil', sortField: 'lotTehsil', label: 'Tehsil', placeholder: 'Filter tehsil...' },
  { key: 'lotMauza', param: 'lotMauza', sortField: 'lotMauza', label: 'Mouza', placeholder: 'Filter mouza...' },
  { key: 'applicantTehsil', param: 'applicantTehsil', sortField: 'applicantTehsil', label: 'Applicant Tehsil', placeholder: 'Filter...' },
  { key: 'lotNumber', param: 'lotNumber', sortField: 'lotNumber', label: 'Lot No', placeholder: 'Filter...' },
  { key: 'blockNo', param: 'blockNo', sortField: 'blockNo', label: 'Block No', placeholder: 'Filter...' },
  { key: 'murabbaNo', param: 'murabbaNo', sortField: 'murabbaNo', label: 'Murabba No', placeholder: 'Filter...' },
  { key: 'killaNos', param: 'killaNo', sortField: null, label: 'Killa No(s)', placeholder: 'Filter...' },
];
const EMPTY_FILTERS: Record<string, string> = COLUMNS.reduce((a, c) => ({ ...a, [c.param]: '' }), {});
const PAGE_SIZE_OPTIONS = [25, 50, 100, 200];

const ringCentroid = (ring: number[][]) => {
  const pts = ring.slice(0, -1);
  const sum = pts.reduce((a, [lon, lat]) => [a[0] + lon, a[1] + lat], [0, 0]);
  return [sum[0] / pts.length, sum[1] / pts.length];
};
const insetCornerLatLng = (ring: number[][], fraction = 0.22): [number, number] => {
  const corner = ring[0];
  const c = ringCentroid(ring);
  return [corner[1] + (c[1] - corner[1]) * fraction, corner[0] + (c[0] - corner[0]) * fraction];
};
const escapeHtml = (s: any) => String(s ?? '').replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
const murabbaLabelIcon = (text: any) =>
  L.divIcon({
    className: 'land-allotment-murabba-label',
    html: `<div style="color:#ff0000;font-weight:700;font-size:16.5px;text-shadow:1px 1px 2px #ffffff,-1px -1px 2px #ffffff,1px -1px 2px #ffffff,-1px 1px 2px #ffffff,0 0 4px #ffffff;white-space:nowrap;">${escapeHtml(text)}</div>`,
    iconSize: [0, 0],
    iconAnchor: [-4, 8],
  });

function AllotmentMap({ geometry, murabbaNo }: { geometry: any; murabbaNo: any }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current || !geometry?.murabbaFeature) return;
    const bounds = L.latLngBounds(geometry.murabbaFeature.geometry.coordinates[0].map(([lon, lat]: number[]) => [lat, lon]));
    const map = L.map(ref.current, { attributionControl: true }).fitBounds(bounds);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Tiles &copy; Esri',
    }).addTo(map);
    L.geoJSON(geometry.murabbaFeature, { style: { color: '#FFD700', weight: 3, fillOpacity: 0 } }).addTo(map);
    L.geoJSON(geometry, {
      style: { color: '#FFFF00', weight: 2, fillOpacity: 0, dashArray: '5,5' },
      onEachFeature: (feature: any, layer) => {
        const k = feature.properties?.Killa;
        if (k == null) return;
        layer.bindTooltip(String(k), { permanent: true, direction: 'center', className: 'killa-tooltip land-allotment-killa-tooltip', interactive: false });
      },
    }).addTo(map);
    const first = geometry.features?.[0];
    if (first) L.marker(insetCornerLatLng(first.geometry.coordinates[0]), { icon: murabbaLabelIcon(murabbaNo), interactive: false }).addTo(map);
    return () => {
      map.remove();
    };
  }, [geometry, murabbaNo]);
  return <div ref={ref} className="h-[420px] w-full overflow-hidden rounded-lg max-sm:h-[340px]" />;
}

export default function LandAllotmentPage() {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [debouncedFilters, setDebouncedFilters] = useState(EMPTY_FILTERS);
  const debounceTimer = useRef<any>(null);
  const mapCardRef = useRef<HTMLDivElement>(null);

  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [sortKey, setSortKey] = useState('fullName');
  const [sortDir, setSortDir] = useState('asc');
  const [results, setResults] = useState<any[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, pages: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<any>(null);
  const [geometry, setGeometry] = useState<any>(null);
  const [loadingGeom, setLoadingGeom] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [geomError, setGeomError] = useState<string | null>(null);

  const handleFilterChange = (param: string, value: string) => {
    setFilters((p) => ({ ...p, [param]: value }));
    clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      setPage(1);
      setDebouncedFilters((p) => ({ ...p, [param]: value }));
    }, 400);
  };
  const clearFilters = () => {
    clearTimeout(debounceTimer.current);
    setFilters(EMPTY_FILTERS);
    setDebouncedFilters(EMPTY_FILTERS);
    setPage(1);
  };
  const handleSort = (key: string) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir('asc');
    }
    setPage(1);
  };

  const fetchList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, any> = { page, limit, sortKey, sortDir };
      Object.entries(debouncedFilters).forEach(([k, v]) => {
        if (v && v.trim()) params[k] = v.trim();
      });
      const { data } = await api.get('/api/admin/land-allotments', { params });
      setResults(data.results || []);
      setPagination(data.pagination || { page: 1, limit, total: 0, pages: 0 });
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load allotment records.');
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [page, limit, sortKey, sortDir, debouncedFilters]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);
  useEffect(() => () => clearTimeout(debounceTimer.current), []);

  const handleSelect = async (record: any) => {
    setSelected(record);
    setTimeout(() => mapCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
    setGeometry(null);
    setGeomError(null);
    setLoadingGeom(true);
    try {
      const { data } = await api.get(`/api/admin/land-allotments/${record._id}/geometry`);
      setGeometry(data);
    } catch (err: any) {
      setGeomError(err.response?.data?.message || 'Geometry not available for this estate yet.');
    } finally {
      setLoadingGeom(false);
    }
  };

  const handleExport = async () => {
    if (!selected) return;
    setExporting(true);
    try {
      const res = await api.get(`/api/admin/land-allotments/${selected._id}/export.kmz`, { responseType: 'blob' });
      const blob = new Blob([res.data], { type: 'application/vnd.google-earth.kmz' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const sanitize = (s: any) => String(s || '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      link.download = `${sanitize(selected.lotMauza)}_${sanitize(selected.fullName || 'allottee')}_${sanitize(selected.cnicRaw || selected.cnic)}.kmz`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => window.URL.revokeObjectURL(url), 5000);
    } catch (err: any) {
      setGeomError(err.response?.data?.message || 'Failed to generate KMZ export.');
    } finally {
      setExporting(false);
    }
  };

  const activeFilterCount = Object.values(filters).filter((v) => v && v.trim()).length;
  const total = pagination.pages || 1;
  const cur = pagination.page || 1;
  const win: number[] = [];
  for (let p = Math.max(1, cur - 2); p <= Math.min(total, cur + 2); p++) win.push(p);
  const pb = 'btn btn-sm btn-outline-primary min-w-[2rem] min-h-[34px]';
  const cell = 'px-2 py-1 text-[0.8rem]';

  return (
    <div className="mx-auto w-full max-w-[1400px] px-3 py-6 max-sm:px-1">
      <h4 className="mb-3 flex items-center gap-2 text-xl font-medium text-teal-ink">
        <MapPinned className="text-[#198754]" size={22} />
        Cholistan AKAR Alottment
      </h4>
      <p className="mb-4 text-[0.9rem] text-ink-2">
        Browse all allotment records below — filter by any column, click a row to preview its allotted killa(s) on the map and export a
        KMZ file for use in Google Earth.
      </p>

      <div className="card-plain mb-6">
        <div className="p-4 max-sm:p-2">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="text-[0.85rem] text-ink-2">
              {loading ? 'Loading…' : `${pagination.total.toLocaleString()} record(s)`}
              {activeFilterCount > 0 && !loading && ' — filtered'}
            </div>
            <div className="flex items-center gap-2">
              {activeFilterCount > 0 && (
                <button className="btn btn-sm btn-outline-secondary" onClick={clearFilters}>
                  <X size={14} /> Clear Filters
                </button>
              )}
              <select className="select select-sm w-auto" value={limit} onChange={(e) => { setLimit(Number(e.target.value)); setPage(1); }}>
                {PAGE_SIZE_OPTIONS.map((n) => <option key={n} value={n}>{n} / page</option>)}
              </select>
            </div>
          </div>

          {error && <Alert variant="warning" className="mb-2">{error}</Alert>}

          <div className="table-wrap" style={{ maxHeight: 'calc(100vh - 300px)' }}>
            <table className="table">
              <thead>
                <tr>
                  {COLUMNS.map((col, i) => (
                    <th key={col.param} className={i === 0 ? 'freeze' : undefined} style={{ verticalAlign: 'top' }}>
                      <div
                        onClick={col.sortField ? () => handleSort(col.sortField!) : undefined}
                        style={{ cursor: col.sortField ? 'pointer' : 'default' }}
                        title={col.sortField ? 'Click to sort' : undefined}
                      >
                        {col.label}
                        {sortKey === col.sortField ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                      </div>
                      <input
                        className="land-allotment-filter"
                        placeholder={col.placeholder}
                        value={filters[col.param]}
                        onChange={(e) => handleFilterChange(col.param, e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </th>
                  ))}
                  <th style={{ verticalAlign: 'top' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={COLUMNS.length + 1} className="py-6 text-center"><Spinner size="sm" /></td></tr>
                )}
                {!loading && results.length === 0 && (
                  <tr><td colSpan={COLUMNS.length + 1} className="py-6 text-center text-ink-2">No matching records.</td></tr>
                )}
                {!loading &&
                  results.map((r) => {
                    const sel = selected?._id === r._id;
                    const bg = sel ? { background: '#cfe2ff' } : undefined;
                    return (
                      <tr key={r._id} onClick={() => handleSelect(r)} className="cursor-pointer" title="Click to view on the map">
                        <td className={`freeze ${cell} font-bold text-[#002366]`} style={bg}>{r.cnicRaw || r.cnic}</td>
                        <td className={`${cell} font-bold`} style={bg}>{ur(r.fullName)}</td>
                        <td className={cell} style={bg}>{ur(r.lotTehsil)}</td>
                        <td className={cell} style={bg}>{ur(r.lotMauza)}</td>
                        <td className={cell} style={bg}>{ur(r.applicantTehsil)}</td>
                        <td className={cell} style={bg}>{r.lotNumber}</td>
                        <td className={cell} style={bg}>{r.blockNo}</td>
                        <td className={`${cell} font-bold`} style={bg}>{r.murabbaNo}</td>
                        <td className={cell} style={bg}>{(r.killaNos || []).join(', ')}</td>
                        <td className={`${cell} text-center`} style={bg}>
                          <button
                            className="rounded border border-[#0f2027] bg-[#0f2027] px-2 py-0.5 text-[0.7rem] font-semibold text-white"
                            onClick={(e) => { e.stopPropagation(); handleSelect(r); }}
                          >
                            View
                          </button>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>

          {pagination.pages > 1 && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <div className="text-[0.8rem] text-ink-2">Page {pagination.page} of {pagination.pages}</div>
              <div className="flex flex-wrap gap-1">
                <button className={pb} disabled={page <= 1} onClick={() => setPage(1)}>«</button>
                <button className={pb} disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>‹</button>
                {win[0] > 1 && <span className="px-1 text-ink-2">…</span>}
                {win.map((p) => (
                  <button key={p} className={p === pagination.page ? 'btn btn-sm btn-primary min-w-[2rem] min-h-[34px]' : pb} onClick={() => setPage(p)}>{p}</button>
                ))}
                {win[win.length - 1] < pagination.pages && <span className="px-1 text-ink-2">…</span>}
                <button className={pb} disabled={page >= pagination.pages} onClick={() => setPage((p) => Math.min(pagination.pages, p + 1))}>›</button>
                <button className={pb} disabled={page >= pagination.pages} onClick={() => setPage(pagination.pages)}>»</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {selected && (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-12">
          <div className="card-plain h-full md:col-span-5">
            <div className="p-4">
              <div className="mb-2 text-base font-semibold text-[#033748]">Allotment Details</div>
              <table className="w-full text-[0.9rem]">
                <tbody className="[&_td]:px-1 [&_td]:py-1 [&_td:first-child]:text-ink-2">
                  <tr><td>Allottee</td><td className="font-bold">{ur(selected.fullName)}</td></tr>
                  <tr><td>CNIC</td><td className="font-bold">{selected.cnicRaw || selected.cnic}</td></tr>
                  <tr><td>Mouza</td><td className="font-bold">{ur(selected.lotMauza)}</td></tr>
                  <tr><td>Tehsil</td><td>{ur(selected.lotTehsil)}</td></tr>
                  <tr><td>Murabba No</td><td className="font-bold">{selected.murabbaNo}</td></tr>
                  <tr>
                    <td>Killa No(s)</td>
                    <td className="flex flex-wrap gap-1">
                      {(selected.killaNos || []).map((k: any) => <Badge key={k} bg="warning">{k}</Badge>)}
                    </td>
                  </tr>
                </tbody>
              </table>
              {geomError && <Alert variant="warning" className="mt-2 text-[0.85rem]">{geomError}</Alert>}
              <button className="btn btn-success mt-3 w-full min-h-[40px]" disabled={!geometry || exporting} onClick={handleExport}>
                {exporting ? <Spinner size="sm" className="text-white" /> : <FileDown size={16} />}
                Export KMZ for Google Earth
              </button>
            </div>
          </div>
          <div ref={mapCardRef} className="card-plain h-full md:col-span-7" style={{ scrollMarginTop: 70 }}>
            <div className="p-4 max-sm:p-2">
              <div className="mb-2 text-base font-semibold text-[#033748]">Map Preview</div>
              {loadingGeom && <div className="py-10 text-center"><Spinner /></div>}
              {!loadingGeom && geometry?.murabbaFeature && <AllotmentMap key={selected._id} geometry={geometry} murabbaNo={selected.murabbaNo} />}
              {!loadingGeom && !geometry && !geomError && <div className="py-10 text-center text-ink-2">Select a row to preview its geometry.</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
