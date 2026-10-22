// User detail tabs that use /api/users/:id/login-history: Login History, Location Map, Heatmap.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Clock, Flame, Globe, MapPin, Map as MapIcon, Monitor } from 'lucide-react';
import { api } from '@/shared/api/client';
import { Alert, Badge, Spinner, cn } from '@/shared/ui';
import { fmtDateTime } from '@/shared/lib/format';
import { calculateTotalDistance, formatDistance, detectSuspiciousTravel, calculateCentroid, getLocationBounds } from '@/shared/lib/locationUtils';
import { EmptyState, H4, MetricCard, Panel, tableCls } from './UserDetailTabs';
import { L, useHeatLayer, useLeafletMap } from './leaflet';

const pad = 'responsive-padding p-8 max-lg:p-6 max-md:p-4 max-sm:p-3';
const esc = (s: any) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

function useLoginHistory(userId: string, days?: string) {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.get(`/api/users/${userId}/login-history`, days ? { params: { days } } : undefined)
      .then((r) => alive && setData(Array.isArray(r.data) ? r.data : []))
      .catch(() => alive && setData([]))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [userId, days]);
  return { data, loading };
}

const parseUA = (ua?: string) => {
  if (!ua) return { browser: 'Unknown', os: 'Unknown', device: 'Unknown' };
  const browser = ua.includes('Chrome') ? 'Chrome' : ua.includes('Firefox') ? 'Firefox' : ua.includes('Safari') ? 'Safari' : ua.includes('Edge') ? 'Edge' : 'Unknown';
  const os = ua.includes('Windows') ? 'Windows' : ua.includes('Mac') ? 'macOS' : ua.includes('Linux') ? 'Linux' : ua.includes('Android') ? 'Android' : ua.includes('iOS') ? 'iOS' : 'Unknown';
  const device = ua.includes('Mobile') ? 'Mobile' : ua.includes('Tablet') ? 'Tablet' : 'Desktop';
  return { browser, os, device };
};

/* ---------------- Login history ---------------- */
export function LoginHistoryTab({ user }: { user: any }) {
  const [filterDays, setFilterDays] = useState('30');
  const { data: list } = useLoginHistory(user.userId, filterDays);
  const uniqueIPs = new Set(list.map((l) => l.ipAddress)).size;
  const uniqueLocations = new Set(list.filter((l) => l.location).map((l) => `${l.location.city}, ${l.location.country}`)).size;
  const recent = list.slice(0, 10);
  const groups = list.reduce((acc: Record<string, any[]>, l) => { (acc[l.ipAddress] = acc[l.ipAddress] || []).push(l); return acc; }, {});
  const ipStats = (Object.entries(groups) as [string, any[]][]).map(([ip, logins]) => ({
    ip,
    count: logins.length,
    firstSeen: logins.length ? new Date(Math.min(...logins.map((l) => new Date(l.loginTime).getTime()))) : null,
    lastSeen: logins.length ? new Date(Math.max(...logins.map((l) => new Date(l.loginTime).getTime()))) : null,
    location: logins[0]?.location,
    devices: new Set(logins.map((l) => l.userAgent)).size,
  })).sort((a, b) => b.count - a.count);

  return (
    <div className={pad}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h4 className="m-0 text-[1.35rem] font-medium max-sm:text-[1.15rem]">Login History</h4>
        <select className="select w-auto" value={filterDays} onChange={(e) => setFilterDays(e.target.value)}>
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
          <option value="365">Last year</option>
          <option value="all">All time</option>
        </select>
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricCard value={list.length} label="Total Logins" icon={<Clock size={32} className="text-[#0096c7]" />} />
        <MetricCard value={uniqueIPs} label="Unique IPs" icon={<Globe size={32} className="text-[#06b6d4]" />} />
        <MetricCard value={uniqueLocations} label="Locations" icon={<MapPin size={32} className="text-[#10b981]" />} />
        <MetricCard value={ipStats.length} label="Devices Used" icon={<Monitor size={32} className="text-[#f59e0b]" />} />
      </div>

      <Panel className="mb-4" title="Recent Login Activity" right={<Badge bg="primary">{recent.length} Recent</Badge>} bodyClassName="max-h-[400px] overflow-auto">
        {recent.length > 0 ? (
          <table className={tableCls}>
            <thead className="sticky top-0 z-[1] bg-[#f8f9fa]"><tr><th>Date &amp; Time</th><th>IP Address</th><th>Location</th><th>Device</th><th>Status</th></tr></thead>
            <tbody>
              {recent.map((l, i) => {
                const ua = parseUA(l.userAgent);
                return (
                  <tr key={i} className={i % 2 === 0 ? 'bg-[rgba(0,0,0,0.03)]' : ''}>
                    <td className="whitespace-nowrap">{fmtDateTime(l.loginTime, 'N/A')}</td>
                    <td><code className="text-[#d63384]">{l.ipAddress}</code></td>
                    <td className="whitespace-nowrap">{l.location ? <><MapPin size={12} className="mr-1 inline text-ink-2" />{l.location.city}, {l.location.country}</> : <span className="text-ink-2">Unknown</span>}</td>
                    <td className="text-[0.85rem]"><div className="whitespace-nowrap"><strong>{ua.browser}</strong> on {ua.os}</div><small className="text-ink-2">{ua.device}</small></td>
                    <td><Badge bg={l.success ? 'success' : 'danger'}>{l.success ? 'Success' : 'Failed'}</Badge></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : <EmptyState icon="🔐" text="No Login History" />}
      </Panel>

      <Panel title="IP Address Statistics" right={<Badge bg="secondary">{ipStats.length} IPs</Badge>} bodyClassName="max-h-[400px] overflow-auto">
        {ipStats.length > 0 ? (
          <table className={tableCls}>
            <thead className="sticky top-0 z-[1] bg-[#f8f9fa]"><tr><th>IP Address</th><th>Login Count</th><th>Location</th><th>First Seen</th><th>Last Seen</th><th>Devices</th></tr></thead>
            <tbody>
              {ipStats.map((s, i) => (
                <tr key={i} className={i % 2 === 0 ? 'bg-[rgba(0,0,0,0.03)]' : ''}>
                  <td><code className="text-[#d63384]">{s.ip}</code></td>
                  <td><Badge bg="info">{s.count}</Badge></td>
                  <td className="text-[0.85rem]">{s.location ? <><div>{s.location.city}</div><small className="text-ink-2">{s.location.country}</small></> : <span className="text-ink-2">Unknown</span>}</td>
                  <td className="whitespace-nowrap text-[0.85rem]">{fmtDateTime(s.firstSeen, 'N/A')}</td>
                  <td className="whitespace-nowrap text-[0.85rem]">{fmtDateTime(s.lastSeen, 'N/A')}</td>
                  <td><Badge bg="secondary">{s.devices}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <EmptyState icon="📊" text="No IP Data" />}
      </Panel>
    </div>
  );
}

/* ---------------- Location map ---------------- */
const numberedIcon = (n: number, selected: boolean) => {
  const size = selected ? 32 : 28;
  return L.divIcon({
    className: cn('ud-login-marker', selected && 'selected'),
    html: `<div class="pin"><span style="font-size:${selected ? 14 : 12}px">${n}</span></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
    popupAnchor: [0, -size],
  });
};

function LoginsMap({ locations, selected, onSelect }: { locations: any[]; selected: any; onSelect: (l: any) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const c = calculateCentroid(locations) || { lat: 30.3753, lng: 69.3451 };
  const map = useLeafletMap(ref, [c.lat, c.lng], locations.length > 1 ? 5 : 11);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!map) return undefined;
    const layer = L.layerGroup().addTo(map);
    locations.forEach((loc, i) => {
      const html = `<div style="min-width:200px">
        <h6 style="margin:0 0 8px;color:#667eea;font-weight:bold">${esc(loc.city)}, ${esc(loc.region)}</h6>
        <div style="font-size:.9rem;color:#666">
          <div style="margin-bottom:4px">🌐 ${esc(loc.country)}</div>
          <div style="margin-bottom:4px">📍 ${loc.latitude.toFixed(4)}, ${loc.longitude.toFixed(4)}</div>
          <div style="margin-bottom:8px">🕘 ${esc(fmtDateTime(loc.lastLogin, 'N/A'))}</div>
          <div style="border-top:1px solid #eee;padding-top:8px;margin-top:8px">
            <span class="badge badge-primary" style="margin-right:6px">${loc.count} logins</span>
            <span class="badge badge-secondary">${loc.ips.length} IP${loc.ips.length !== 1 ? 's' : ''}</span>
          </div></div></div>`;
      L.marker([loc.latitude, loc.longitude], { icon: numberedIcon(i + 1, selected === loc) })
        .bindPopup(html)
        .on('click', () => onSelectRef.current(loc))
        .addTo(layer);
    });
    return () => { layer.remove(); };
  }, [map, locations, selected]);

  useEffect(() => {
    if (!map || !locations.length) return;
    const b = getLocationBounds(locations);
    if (b) map.fitBounds([[b.south, b.west], [b.north, b.east]], { padding: [50, 50], maxZoom: 15 });
  }, [map, locations]);

  return <div ref={ref} className="relative z-[1] h-[500px] w-full rounded-lg max-sm:h-[360px]" />;
}

export function LocationMapTab({ user }: { user: any }) {
  const { data: raw, loading } = useLoginHistory(user.userId);
  const [selected, setSelected] = useState<any>(null);
  const loginData = useMemo(() => raw.filter((l) => l.location && l.location.latitude && l.location.longitude)
    .sort((a, b) => new Date(a.loginTime).getTime() - new Date(b.loginTime).getTime()), [raw]);
  const suspicious = useMemo(() => {
    const out: any[] = [];
    for (let i = 1; i < loginData.length; i++) {
      const a = detectSuspiciousTravel({ ...loginData[i - 1].location, timestamp: loginData[i - 1].loginTime }, { ...loginData[i].location, timestamp: loginData[i].loginTime });
      if (a && a.suspicious) out.push({ from: loginData[i - 1], to: loginData[i], ...a });
    }
    return out;
  }, [loginData]);
  const locations = useMemo(() => {
    const g = loginData.reduce((acc: Record<string, any>, l) => {
      const k = `${l.location.latitude.toFixed(4)},${l.location.longitude.toFixed(4)}`;
      if (!acc[k]) acc[k] = { location: l.location, logins: [] as any[], ips: new Set<string>() };
      acc[k].logins.push(l);
      acc[k].ips.add(l.ipAddress);
      return acc;
    }, {});
    return Object.values(g).map((x: any) => ({
      ...x.location,
      count: x.logins.length,
      ips: Array.from(x.ips),
      lastLogin: x.logins.length ? new Date(Math.max(...x.logins.map((l: any) => new Date(l.loginTime).getTime()))) : null,
    })).sort((a, b) => b.count - a.count);
  }, [loginData]);
  const totalDistance = useMemo(() => calculateTotalDistance(loginData.map((l) => l.location)), [loginData]);
  const countries = useMemo(() => new Set(loginData.map((l) => l.location.country)).size, [loginData]);
  const select = useCallback((l: any) => setSelected(l), []);

  if (loading) return <div className="py-12 text-center"><Spinner /><p className="mt-3 text-ink-2">Loading location data...</p></div>;

  return (
    <div className={pad}>
      <H4>Login Locations Map</H4>
      {locations.length === 0 ? (
        <Alert variant="info"><MapPin size={14} className="mr-2 inline" />No location data available for this user&apos;s logins.</Alert>
      ) : (
        <>
          {suspicious.length > 0 && (
            <Alert variant="warning" className="mb-4">
              <div className="flex items-start gap-3">
                <AlertTriangle size={20} className="mt-1 shrink-0" />
                <div>
                  <strong>Suspicious Travel Detected</strong>
                  <p className="mb-2">Found {suspicious.length} potentially suspicious login pattern(s):</p>
                  {suspicious.map((s, i) => (
                    <div key={i} className="mb-2 text-[0.9rem]">
                      • {s.from.location.city} → {s.to.location.city}: {formatDistance(s.distance)} in {Math.round(s.timeDiffMinutes)} minutes ({Math.round(s.speed)} km/h)
                      <br /><small className="ml-3 text-ink-2">{s.reason}</small>
                    </div>
                  ))}
                </div>
              </div>
            </Alert>
          )}
          <section className="card mb-4"><LoginsMap locations={locations} selected={selected} onSelect={select} /></section>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <MetricCard value={locations.length} label="Unique Locations" />
            <MetricCard value={loginData.length} label="Total Logins" />
            <MetricCard value={countries} label="Countries" />
            <MetricCard value={formatDistance(totalDistance)} label="Total Distance" />
          </div>
          <Panel title={<><MapPin size={14} className="mr-2 inline" />All Login Locations</>} bodyClassName="max-h-[400px] overflow-y-auto">
            {locations.map((loc, i) => {
              const active = selected === loc;
              return (
                <button key={i} type="button" onClick={() => setSelected(loc)}
                  className={cn('block w-full border-b border-[rgba(0,0,0,0.125)] px-4 py-3 text-left last:border-b-0 hover:bg-[#f8f9fa]', active && '!bg-[#0096c7] text-white')}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="mb-2 flex items-center"><MapPin size={14} className={cn('mr-2', active ? 'text-white' : 'text-[#ef4444]')} /><strong className="text-[1.05rem]">{loc.city}, {loc.region}</strong></div>
                      <div className={cn('ml-6 text-[0.9rem]', active ? 'text-white/85' : 'text-ink-2')}>
                        <div className="mb-1"><Globe size={12} className="mr-2 inline" />{loc.country}</div>
                        <div className="mb-1 break-all">📍 Lat: {loc.latitude}, Lng: {loc.longitude}</div>
                        <div><Clock size={12} className="mr-2 inline" />Last login: {fmtDateTime(loc.lastLogin, 'N/A')}</div>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <Badge bg="primary">{loc.count} logins</Badge>
                      <Badge bg="secondary">{loc.ips.length} IP{loc.ips.length !== 1 ? 's' : ''}</Badge>
                    </div>
                  </div>
                  {active && (
                    <div className="mt-3 border-t border-white/40 pt-3">
                      <strong className="mb-2 block">IP Addresses from this location:</strong>
                      <div className="flex flex-wrap gap-2">{loc.ips.map((ip: string) => <code key={ip} className="text-[0.85rem]">{ip}</code>)}</div>
                    </div>
                  )}
                </button>
              );
            })}
          </Panel>
        </>
      )}
    </div>
  );
}

/* ---------------- Heatmap ---------------- */
function HeatMapBox({ points }: { points: any[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const map = useLeafletMap(ref, points.length ? [points[0].lat, points[0].lng] : [30.0444, 71.5312], points.length > 1 ? 5 : 8);
  const heat = useMemo(() => points.map((p) => [p.lat, p.lng, p.intensity || 1] as [number, number, number]).filter((p) => p[0] && p[1]), [points]);
  useHeatLayer(map, heat);
  return <div ref={ref} className="relative z-[1] h-[400px] w-full rounded-lg max-sm:h-[320px]" />;
}

export function HeatmapTab({ user }: { user: any }) {
  const { data: loginData, loading } = useLoginHistory(user.userId);
  const simultaneous = useMemo(() => {
    const out: any[] = [];
    for (let i = 0; i < loginData.length; i++) {
      for (let j = i + 1; j < loginData.length; j++) {
        const a = loginData[i];
        const b = loginData[j];
        if (a.ipAddress === b.ipAddress) continue;
        const t1 = new Date(a.loginTime).getTime();
        const t2 = new Date(b.loginTime).getTime();
        if (Math.abs(t1 - t2) < 5 * 60 * 1000) out.push({ time: new Date(Math.min(t1, t2)), logins: [a, b], timeDiff: Math.abs(t1 - t2) / 1000 });
      }
    }
    return out.sort((x, y) => y.time - x.time);
  }, [loginData]);
  const points = useMemo(() => {
    const m: Record<string, any> = {};
    loginData.forEach((l) => {
      if (!l.location || !l.location.latitude) return;
      const k = `${Math.round(l.location.latitude * 10) / 10},${Math.round(l.location.longitude * 10) / 10}`;
      if (!m[k]) m[k] = { lat: l.location.latitude, lng: l.location.longitude, city: l.location.city, country: l.location.country, count: 0, ips: new Set() };
      m[k].count++;
      m[k].ips.add(l.ipAddress);
    });
    return Object.values(m).map((d: any) => ({ ...d, ips: Array.from(d.ips), intensity: d.count })).sort((a, b) => b.intensity - a.intensity);
  }, [loginData]);
  const maxI = points.length ? points[0].intensity : 1;
  const color = (i: number) => { const r = i / maxI; return r > 0.7 ? '#d32f2f' : r > 0.4 ? '#f57c00' : r > 0.2 ? '#fbc02d' : '#7cb342'; };

  if (loading) return <div className="py-12 text-center"><Spinner /><p className="mt-3 text-ink-2">Loading heatmap data...</p></div>;

  return (
    <div className={pad}>
      <H4>Login Activity Heatmap</H4>
      {loginData.length === 0 ? (
        <Alert variant="info"><MapIcon size={14} className="mr-2 inline" />No login data available to generate heatmap.</Alert>
      ) : (
        <>
          <section className="card mb-4"><HeatMapBox points={points} /></section>
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
            <MetricCard value={points.length} label="Heat Zones" icon={<MapIcon size={32} className="text-[#0096c7]" />} />
            <MetricCard value={loginData.length} label="Total Activities" icon={<Flame size={32} className="text-[#ef4444]" />} />
            <MetricCard value={simultaneous.length} label="Simultaneous Logins" icon={<AlertTriangle size={32} className="text-[#f59e0b]" />} />
          </div>
          <Panel className="mb-4" title={<><Flame size={14} className="mr-2 inline" />Activity Intensity by Location</>} bodyClassName="max-h-[400px] overflow-y-auto">
            {points.map((p, i) => (
              <div key={i} className="flex items-center justify-between gap-2 border-b border-[rgba(0,0,0,0.125)] px-4 py-3 last:border-b-0">
                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex items-center">
                    <span className="mr-3 size-3 shrink-0 rounded-full" style={{ backgroundColor: color(p.intensity), boxShadow: `0 0 10px ${color(p.intensity)}` }} />
                    <strong>{p.city}, {p.country}</strong>
                  </div>
                  <div className="ml-6 text-[0.9rem] text-ink-2">
                    <div>📍 Coordinates: {p.lat.toFixed(2)}, {p.lng.toFixed(2)}</div>
                    <div className="mt-1">
                      <strong>IPs from this location:</strong>
                      <div className="mt-1 flex flex-wrap gap-2">{p.ips.map((ip: string) => <code key={ip} className="text-[0.8rem] text-[#d63384]">{ip}</code>)}</div>
                    </div>
                  </div>
                </div>
                <span className="badge badge-light shrink-0 !border-l-4 !text-[0.95rem]" style={{ borderLeftColor: color(p.intensity) }}>{p.intensity} logins</span>
              </div>
            ))}
          </Panel>
          {simultaneous.length > 0 && (
            <Panel title={<><AlertTriangle size={14} className="mr-2 inline" />Suspicious Activity: Simultaneous Logins from Different IPs</>}
              headerClassName="!bg-[#ffc107] !text-[#212529] after:hidden" bodyClassName="max-h-[400px] overflow-y-auto">
              {simultaneous.map((s, i) => (
                <div key={i} className="border-b border-[#ffecb5] bg-[#fff3cd] px-4 py-3 text-[#664d03] last:border-b-0">
                  <div className="mb-2">
                    <Clock size={13} className="mr-2 inline" /><strong>{fmtDateTime(s.time)}</strong>
                    <Badge bg="danger" className="ml-2">{s.timeDiff < 60 ? `${Math.round(s.timeDiff)}s apart` : `${Math.round(s.timeDiff / 60)}m apart`}</Badge>
                  </div>
                  <div className="flex flex-wrap gap-4">
                    {s.logins.map((l: any, j: number) => (
                      <div key={j} className="min-w-[140px] flex-1">
                        <div className="text-sm"><strong>IP:</strong> <code className="text-[#d63384]">{l.ipAddress}</code></div>
                        <div className="text-sm text-ink-2">{l.location ? `${l.location.city}, ${l.location.country}` : 'Unknown location'}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </Panel>
          )}
        </>
      )}
    </div>
  );
}
