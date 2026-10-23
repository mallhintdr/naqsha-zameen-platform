// Admin location modals (legacy components/Map/LocationComponents.js), opened from the statistics page.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { MapPin } from 'lucide-react';
import { api } from '@/shared/api/client';
import { Alert, Badge, Button, Modal, Spinner, cn } from '@/shared/ui';
import { fmtDateTime } from '@/shared/lib/format';
import { PROFILE_HEADER_STYLE } from './ChangeMouzasModal';
import { L, defaultMarkerIcon, useLeafletMap } from './leaflet';

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

export default { UserLocationModal };
