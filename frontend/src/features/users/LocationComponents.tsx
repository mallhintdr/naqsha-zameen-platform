// Admin location modals (legacy components/Map/LocationComponents.js), opened from the statistics page.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Globe2, MapPin } from 'lucide-react';
import { api } from '@/shared/api/client';
import { Alert, Badge, Button, Modal, Spinner, cn } from '@/shared/ui';
import { fmtDateTime } from '@/shared/lib/format';
import { PROFILE_HEADER_STYLE } from './ChangeMouzasModal';
import { L, defaultMarkerIcon, useHeatLayer, useLeafletMap } from './leaflet';

const HEADER_STYLE = { ...PROFILE_HEADER_STYLE, padding: '10px 15px' };
const esc = (s: any) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const latOf = (l: any) => l.latitude || l.lat;
const lngOf = (l: any) => l.longitude || l.lng || l.lon;

const Box = ({ title, children, className, bodyClassName }: { title: ReactNode; children: ReactNode; className?: string; bodyClassName?: string }) => (
  <section className={cn('overflow-hidden rounded-md bg-white shadow-[0_.125rem_.25rem_rgba(0,0,0,.075)]', className)}>
    <header className="border-b border-[#dee2e6] bg-[#f8f9fa] px-3 py-2 text-[0.875rem] font-bold">{title}</header>
    <div className={bodyClassName}>{children}</div>
  </section>
);
const darkHead = '[&_thead_th]:bg-[#212529] [&_thead_th]:text-white [&_thead_th]:px-1.5 [&_thead_th]:py-1 [&_thead_th]:text-left [&_td]:px-1.5 [&_td]:py-1 [&_td]:border-b [&_td]:border-[#dee2e6] [&_tbody_tr:nth-child(odd)]:bg-[rgba(0,0,0,0.03)] [&_tbody_tr:hover]:bg-[rgba(0,0,0,0.06)]';

function LocationHeatmap({ locations, center = [30.0444, 71.5312], zoom = 6 }: { locations: any[]; center?: [number, number]; zoom?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const map = useLeafletMap(ref, center, zoom);
  const pts = useMemo(() => locations.map((l) => [latOf(l), lngOf(l), l.intensity || 1] as [number, number, number]).filter((p) => p[0] && p[1]), [locations]);
  useHeatLayer(map, pts);
  return <div ref={ref} className="h-[400px] w-full max-sm:h-[320px]" />;
}

function LocationMap({ locations, onLocationSelect }: { locations: any[]; onLocationSelect?: (l: any) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const center: [number, number] = locations.length
    ? [locations.reduce((s, l) => s + latOf(l), 0) / locations.length, locations.reduce((s, l) => s + lngOf(l), 0) / locations.length]
    : [30.0444, 71.5312];
  const map = useLeafletMap(ref, center, locations.length > 1 ? 8 : 10);
  const cb = useRef(onLocationSelect);
  cb.current = onLocationSelect;
  useEffect(() => {
    if (!map) return undefined;
    const g = L.layerGroup().addTo(map);
    locations.forEach((l) => {
      const lat = latOf(l);
      const lng = lngOf(l);
      if (!lat || !lng) return;
      L.marker([lat, lng], { icon: defaultMarkerIcon })
        .bindPopup(`<div><strong>${esc(l.city || 'Unknown City')}</strong><br/>${l.region ? `${esc(l.region)}, ` : ''}${esc(l.country)}<br/><small>IP: ${esc(l.ipAddress)}</small><br/>${l.sessionCount ? `<span class="badge badge-info">${l.sessionCount} sessions</span>` : ''}</div>`)
        .on('click', () => cb.current?.(l))
        .addTo(g);
    });
    return () => { g.remove(); };
  }, [map, locations]);
  return <div ref={ref} className="h-[300px] w-full" />;
}

export const UserLocationModal = ({ show, onHide, user }: { show: boolean; onHide: () => void; user: any }) => {
  const [locations, setLocations] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<any>(null);

  const load = useCallback(async () => {
    if (!user?.userId) return;
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get(`/user-locations/${user.userId}`);
      setLocations(data.locations || []);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load user locations');
    } finally {
      setLoading(false);
    }
  }, [user?.userId]);
  useEffect(() => { if (show && user?.userId) load(); }, [show, user?.userId, load]);

  const unique = Object.values(locations.reduce((acc: Record<string, any>, l) => {
    const k = `${l.city}-${l.country}`;
    if (!acc[k]) acc[k] = { ...l, count: 0 };
    acc[k].count++;
    return acc;
  }, {})) as any[];

  return (
    <Modal show={show} onHide={onHide} size="xl" headerVariant="custom" headerStyle={HEADER_STYLE} headerClassName="text-white"
      className="max-sm:inset-0 max-sm:top-[42px] max-sm:rounded-none"
      title={<span className="flex flex-wrap items-center gap-2 text-base font-semibold"><MapPin size={14} />Location Analysis: {user?.userName}<Badge bg="info" className="!text-[0.7rem]">{locations.length} Sessions</Badge></span>}
      footerClassName="!p-2" footer={<Button variant="secondary" size="sm" onClick={onHide}>Close</Button>}>
      {error && <Alert variant="danger" className="mb-2">{error}</Alert>}
      {loading ? (
        <div className="py-4 text-center"><Spinner /><p className="mt-2">Loading location data...</p></div>
      ) : (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-[2fr_1fr]">
          <Box title="Location Map" className="mb-2"><LocationMap locations={locations} onLocationSelect={setSelected} /></Box>
          <Box title="Location Summary" bodyClassName="overflow-x-auto">
            <table className={cn('w-full text-[0.75rem]', darkHead)}>
              <thead><tr><th>Location</th><th className="!text-center">Sessions</th></tr></thead>
              <tbody>
                {unique.map((l, i) => (
                  <tr key={i} onClick={() => setSelected(l)} className={cn('cursor-pointer', selected?.city === l.city && '!bg-[rgba(0,0,0,0.1)]')}>
                    <td><strong>{l.city}</strong><br /><small className="text-ink-2">{l.region}, {l.country}</small></td>
                    <td className="text-center"><Badge bg="secondary" pill>{l.count}</Badge></td>
                  </tr>
                ))}
                {unique.length === 0 && <tr><td colSpan={2} className="text-center text-ink-2">No location data available</td></tr>}
              </tbody>
            </table>
          </Box>
        </div>
      )}
      {locations.length > 0 && (
        <Box title="Detailed Session History" className="mt-2">
          <div className="max-h-[250px] overflow-auto">
            <table className={cn('w-full text-[0.75rem] [&_thead_th]:sticky [&_thead_th]:top-0', darkHead)}>
              <thead><tr><th>Time</th><th>IP</th><th>Location</th><th>Device</th><th className="!text-center">Acc</th></tr></thead>
              <tbody>
                {locations.map((l, i) => (
                  <tr key={i}>
                    <td className="whitespace-nowrap">{fmtDateTime(l.timestamp)}</td>
                    <td><code className="text-[#d63384]">{l.ipAddress}</code></td>
                    <td>{l.city}, {l.region}<br /><small className="text-ink-2">{l.country}</small></td>
                    <td>{l.deviceInfo?.browser || 'Unknown'}<br /><small className="text-ink-2">{l.deviceInfo?.os || 'Unknown OS'}</small></td>
                    <td className="text-center">{l.accuracy ? `±${l.accuracy}m` : 'N/A'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Box>
      )}
    </Modal>
  );
};

export const GlobalHeatmapModal = ({ show, onHide }: { show: boolean; onHide: () => void }) => {
  const [heatmapData, setHeatmapData] = useState<any>(null);
  const [locationStats, setLocationStats] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState({ subscriptionType: '', country: '', limit: 1000 });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [h, s] = await Promise.all([api.get('/location-heatmap', { params: filters }), api.get('/location-stats')]);
      setHeatmapData(h.data);
      setLocationStats(s.data);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load heatmap data');
    } finally {
      setLoading(false);
    }
  }, [filters]);
  useEffect(() => { if (show) load(); }, [show, load]);
  const setF = (k: string, v: any) => setFilters((p) => ({ ...p, [k]: v }));
  const lbl = 'mb-0 block text-[0.875rem] font-bold';

  return (
    <Modal show={show} onHide={onHide} size="xl" headerVariant="custom" headerStyle={HEADER_STYLE} headerClassName="text-white"
      title={<span className="flex flex-wrap items-center gap-2 text-base font-semibold"><Globe2 size={15} />Global Location Heatmap{heatmapData && <Badge bg="info" className="!text-[0.7rem]">{heatmapData.points?.length || 0} Points</Badge>}</span>}
      footer={<Button variant="secondary" onClick={onHide}>Close</Button>}>
      {error && <Alert variant="danger" className="mb-2">{error}</Alert>}
      <div className="mb-2 rounded-md bg-[#f8f9fa] p-2 shadow-[0_.125rem_.25rem_rgba(0,0,0,.075)]">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-[3fr_3fr_2fr_2fr]">
          <div>
            <label className={lbl}>Subscription</label>
            <select className="select select-sm" value={filters.subscriptionType} onChange={(e) => setF('subscriptionType', e.target.value)}>
              <option value="">All</option><option value="Trial">Trial</option><option value="Monthly">Monthly</option><option value="Quarterly">Quarterly</option><option value="Annual">Annual</option>
            </select>
          </div>
          <div>
            <label className={lbl}>Country</label>
            <input className="input input-sm" placeholder="e.g. Pakistan" value={filters.country} onChange={(e) => setF('country', e.target.value)} />
          </div>
          <div>
            <label className={lbl}>Limit</label>
            <select className="select select-sm" value={filters.limit} onChange={(e) => setF('limit', parseInt(e.target.value, 10))}>
              {[500, 1000, 2000, 5000].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div className="flex items-end">
            <Button size="sm" className="min-h-9 w-full" onClick={load} disabled={loading}>{loading ? '...' : 'Apply'}</Button>
          </div>
        </div>
      </div>
      {loading ? (
        <div className="py-12 text-center"><Spinner /><p className="mt-3">Loading global heatmap data...</p></div>
      ) : (
        <div className="grid grid-cols-1 gap-2 lg:grid-cols-[2fr_1fr]">
          <Box title="User Distribution"><LocationHeatmap locations={heatmapData?.points || []} center={[31.5497, 74.3436]} zoom={6} /></Box>
          <div>
            {locationStats && (
              <>
                <Box title="Top Countries" className="mb-2" bodyClassName="p-2">
                  <div className="max-h-[150px] overflow-y-auto text-[0.8rem]">
                    {locationStats.countriesStats?.map((c: any, i: number) => (
                      <div key={i} className="mb-1 flex justify-between border-b border-[#dee2e6] pb-1">
                        <span>{c.country || 'Unknown'}</span>
                        <div className="flex gap-1"><Badge bg="primary" className="!text-[0.65rem]">{c.uniqueUsers}u</Badge><Badge bg="secondary" className="!text-[0.65rem]">{c.sessionCount}s</Badge></div>
                      </div>
                    ))}
                  </div>
                </Box>
                <Box title="Top Cities" bodyClassName="p-2">
                  <div className="max-h-[200px] overflow-y-auto text-[0.8rem]">
                    {locationStats.topCities?.map((c: any, i: number) => (
                      <div key={i} className="mb-1 flex justify-between border-b border-[#dee2e6] pb-1">
                        <div><div className="font-bold">{c.city || 'Unknown'}</div><div className="text-sm text-ink-2">{c.country}</div></div>
                        <div className="flex flex-col items-end gap-1"><Badge bg="info" className="!text-[0.65rem]">{c.uniqueUsers} users</Badge><Badge bg="light" className="!text-[0.65rem]">{c.sessionCount} sess</Badge></div>
                      </div>
                    ))}
                  </div>
                </Box>
              </>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
};

export default { UserLocationModal, GlobalHeatmapModal };
