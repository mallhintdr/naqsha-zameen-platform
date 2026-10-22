import { useRef } from 'react';
import TourRunner, { q, type TourStep } from './TourRunner';
import { leaflet } from './tourActions';

/** Legacy leaflet-draw selectors first, then Geoman equivalents (the rebuilt map uses Geoman). */
const TOOL: Record<string, string[]> = {
  polyline: ['a.leaflet-draw-draw-polyline', '.leaflet-draw-draw-polyline', '.leaflet-pm-icon-polyline', 'a[title*="polyline" i]'],
  polygon: ['a.leaflet-draw-draw-polygon', '.leaflet-draw-draw-polygon', '.leaflet-pm-icon-polygon', 'a[title*="polygon" i]'],
  rectangle: ['a.leaflet-draw-draw-rectangle', '.leaflet-draw-draw-rectangle', '.leaflet-pm-icon-rectangle', 'a[title*="rectangle" i]'],
  circle: ['a.leaflet-draw-draw-circle', '.leaflet-draw-draw-circle', '.leaflet-pm-icon-circle', 'a[title*="circle" i]'],
  marker: ['a.leaflet-draw-draw-marker', '.leaflet-draw-draw-marker', '.leaflet-pm-icon-marker', 'a[title*="marker" i]'],
  edit: ['a.leaflet-draw-edit-edit', '.leaflet-draw-edit-edit', '.leaflet-pm-icon-edit', 'a[title*="edit" i]'],
  remove: ['a.leaflet-draw-edit-remove', '.leaflet-draw-edit-remove', '.leaflet-pm-icon-delete', 'a[title*="delete" i]', 'a[title*="remove" i]'],
};
const toolbar = () => q('.leaflet-draw-toolbar', '.leaflet-pm-toolbar', '.leaflet-control-container');
const tool = (t: string) => () => q(...TOOL[t]) || toolbar();
const saveBtn = () => q('.leaflet-draw-actions a[title="Save changes."]', '.leaflet-draw-actions a:first-child', '.leaflet-draw-actions a') || tool('edit')();

const BADGE =
  'background: rgba(11, 14, 40, 0.9); color: #00ffff; border: 1px solid #00ffff; border-radius: 4px; padding: 2px 6px; font-size: 10px; font-weight: 700; white-space: nowrap; box-shadow: 0 2px 6px rgba(0,0,0,0.4);';

export default function DrawingTour({ onEnd }: { onEnd: () => void }) {
  const r = useRef<Record<string, any>>({});
  const labels = useRef<any[]>([]);

  const clearLabels = () => {
    const { map } = leaflet();
    labels.current.forEach((l) => l && map?.removeLayer(l));
    labels.current = [];
  };
  const drawLabels = (pts: any[]) => {
    clearLabels();
    const { L, map } = leaflet();
    if (!L || !map || pts.length < 2) return;
    for (let i = 0; i < pts.length - 1; i++) {
      const ft = Math.round(map.distance(pts[i], pts[i + 1]) * 3.28084);
      const m = L.marker([(pts[i].lat + pts[i + 1].lat) / 2, (pts[i].lng + pts[i + 1].lng) / 2], {
        icon: L.divIcon({ className: 'segment-length-badge', html: `<div style="${BADGE}">${ft} ft</div>`, iconSize: [60, 20], iconAnchor: [30, 10] }),
        interactive: false,
      }).addTo(map);
      labels.current.push(m);
    }
  };
  const removeTourLayers = () => {
    clearLabels();
    const g = leaflet().map?.drawnItems;
    if (g) Object.values(r.current).forEach((l) => l && g.removeLayer(l));
    r.current = {};
  };
  const openEdit = () => {
    try {
      const b = q(...TOOL.edit) as HTMLElement | null;
      if (b && !document.querySelector('.leaflet-draw-actions')) b.click();
    } catch {
      /* ignore */
    }
  };
  const saveAndClose = () => {
    const { map } = leaflet();
    try {
      const h = map?._toolbars?.edit?._modes?.edit?.handler;
      if (h && typeof h.save === 'function') {
        h.save();
        h.disable?.();
        return;
      }
    } catch {
      /* fall through */
    }
    const a = document.querySelector('.leaflet-draw-actions') as HTMLElement | null;
    if (a) a.style.display = 'none';
  };
  /** Wrap map actions: legacy bails out (no lock) when the map isn't ready. */
  const withMap = (fn: (L: any, map: any, g: any) => number | void) => () => {
    const { L, map } = leaflet();
    if (!L || !map) return 0;
    const g = map.drawnItems || new L.FeatureGroup().addTo(map);
    return fn(L, map, g) ?? 1000;
  };
  const shapesBottom = () => {
    let bottom = 0;
    const g = leaflet().map?.drawnItems;
    g?.eachLayer?.((l: any) => {
      const el = l._path || l._icon;
      if (el) {
        const b = el.getBoundingClientRect().bottom;
        if (b > bottom && b < window.innerHeight) bottom = b;
      }
    });
    return bottom > 0 && bottom + 200 <= window.innerHeight ? bottom + 16 : Math.max(12, window.innerHeight - 220);
  };

  const intro = (title: string, text: string, target: () => Element | null): TourStep => ({ title, text, target, action: withMap(() => 800) });
  const demo = (title: string, text: string, target: () => Element | null, fn: (L: any, map: any, g: any) => number | void): TourStep => ({
    title,
    text,
    target,
    action: withMap(fn),
    placeTop: shapesBottom,
  });

  const steps: TourStep[] = [
    intro('Map Drawing Tools Toolbar ✏️', 'Welcome to the Map Drawing Tools Tour! This toolbar houses vector shape drawing, vertex editing, and deletion controls.', toolbar),
    intro('1. Polyline Tool 📐', 'Draw connected line segments on the map. Displays real-time segment distance badges along line paths.', tool('polyline')),
    intro('2. Polygon Tool 🔷', 'Draw multi-sided custom boundary shapes. Automatically calculates total enclosed land parcel area.', tool('polygon')),
    intro('3. Rectangle Tool 🟦', 'Click and drag to draw rectangular bounding boxes for survey zones and Murabba sub-divisions.', tool('rectangle')),
    intro('4. Circle Tool ⭕', 'Click center point and drag to draw circular buffers, radius zones, or radial boundary coverage.', tool('circle')),
    intro('5. Pin Drop / Marker Tool 📍', 'Drop point location markers onto specific landmarks or field coordinates.', tool('marker')),
    intro('6. Edit Shapes & Vertices ✏️', 'Modify drawn spatial shapes by dragging boundary node vertices in real-time.', tool('edit')),
    intro('7. Delete Shapes Tool 🗑️', 'Remove unwanted vector shapes or markers from the map canvas.', tool('remove')),
    demo('Polyline Creation & Length Badges 📏', 'Map zoomed to Level 18! A Polyline has been drawn, displaying real-time segment distance measurements.', tool('polyline'), (L, map, g) => {
      map.flyTo(map.getCenter(), 18, { animate: true, duration: 1.2 });
      const c = map.getCenter();
      const pts = [L.latLng(c.lat + 0.0003, c.lng - 0.0004), L.latLng(c.lat + 0.0005, c.lng), L.latLng(c.lat + 0.0003, c.lng + 0.0004)];
      if (!r.current.polyline) r.current.polyline = L.polyline(pts, { color: '#00ffff', weight: 4, opacity: 0.9, dashArray: '6, 6' }).addTo(g);
      else r.current.polyline.setLatLngs(pts);
      drawLabels(pts);
      return 1200;
    }),
    demo('Edit Polyline & Vertex Recalculation 🔄', 'Polyline vertex adjusted in real-time! Segment distance badges recalculate dynamically as node positions shift.', tool('edit'), (L, map) => {
      openEdit();
      const c = map.getCenter();
      const pts = [L.latLng(c.lat + 0.00045, c.lng - 0.0005), L.latLng(c.lat + 0.00065, c.lng + 0.0001), L.latLng(c.lat + 0.00035, c.lng + 0.00055)];
      if (r.current.polyline) {
        r.current.polyline.setLatLngs(pts);
        r.current.polyline.setStyle({ color: '#28a745', dashArray: null });
      }
      drawLabels(pts);
    }),
    demo('Save Polyline Edits & Close Menu 💾', 'Highlighting Save option! Saves Polyline changes to the drawing layer group and closes the edit menu.', saveBtn, () => saveAndClose()),
    demo('Polygon Boundary Creation 🔷', 'A multi-sided Polygon shape has been drawn at a non-overlapping position, displaying total land area calculations.', tool('polygon'), (L, map, g) => {
      const c = map.getCenter();
      if (!r.current.polygon)
        r.current.polygon = L.polygon(
          [L.latLng(c.lat + 0.0001, c.lng + 0.0006), L.latLng(c.lat + 0.0004, c.lng + 0.0009), L.latLng(c.lat + 0.0001, c.lng + 0.0012), L.latLng(c.lat - 0.0002, c.lng + 0.0009)],
          { color: '#ffd700', fillColor: '#ffd700', fillOpacity: 0.35, weight: 3 },
        ).addTo(g);
    }),
    demo('Edit Polygon Vertex 📐', 'Polygon vertex modified in real-time! Boundary shifts automatically update enclosed land area metrics.', tool('edit'), (L, map) => {
      openEdit();
      const c = map.getCenter();
      r.current.polygon?.setLatLngs([L.latLng(c.lat + 0.0001, c.lng + 0.0006), L.latLng(c.lat + 0.00055, c.lng + 0.00105), L.latLng(c.lat + 0.0001, c.lng + 0.00135), L.latLng(c.lat - 0.0002, c.lng + 0.0009)]);
    }),
    demo('Save Polygon Edits & Close Menu 💾', 'Highlighting Save option! Saves Polygon changes to the layer group and closes the edit menu.', saveBtn, () => saveAndClose()),
    demo('Rectangle Parcel Creation 🟦', 'A distinct rectangular survey parcel shape has been drawn at a non-overlapping position.', tool('rectangle'), (L, map, g) => {
      const c = map.getCenter();
      if (!r.current.rectangle)
        r.current.rectangle = L.rectangle(L.latLngBounds(L.latLng(c.lat - 0.0005, c.lng - 0.0003), L.latLng(c.lat - 0.0002, c.lng + 0.0003)), {
          color: '#32cd32',
          fillColor: '#32cd32',
          fillOpacity: 0.35,
          weight: 3,
        }).addTo(g);
    }),
    demo('Edit Rectangle Bounds 📐', 'Modifying rectangle boundary handles in real-time with Edit controls displayed.', tool('edit'), () => openEdit()),
    demo('Save Rectangle Edits & Close Menu 💾', 'Highlighting Save option! Saves Rectangle changes to the layer group and closes the edit menu.', saveBtn, () => saveAndClose()),
    demo('Circle Buffer Creation ⭕', 'A circular radial buffer zone shape has been drawn at a non-overlapping position.', tool('circle'), (L, map, g) => {
      const c = map.getCenter();
      if (!r.current.circle)
        r.current.circle = L.circle(L.latLng(c.lat - 0.0003, c.lng - 0.0007), { radius: 35, color: '#00ffff', fillColor: '#00ffff', fillOpacity: 0.35, weight: 3 }).addTo(g);
    }),
    demo('Pin Drop / Marker Placement 📍', 'A location pin marker has been dropped to mark a specific point coordinate feature. Tap its coordinates tooltip to copy them!', tool('marker'), (L, map, g) => {
      const c = map.getCenter();
      const pos = L.latLng(c.lat + 0.0001, c.lng - 0.0008);
      if (!r.current.marker) {
        r.current.marker = L.marker(pos).addTo(g);
        const text = `${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}`;
        const label = L.marker(pos, {
          icon: L.divIcon({ className: 'marker-label-container', html: `<div class="marker-label" style="cursor: pointer; pointer-events: auto;">${text}</div>`, iconSize: [120, 20], iconAnchor: [60, -15] }),
          interactive: true,
        }).addTo(map);
        label.on('click', (e: any) => {
          e?.originalEvent?.stopPropagation();
          navigator.clipboard
            .writeText(text)
            .then(() => {
              const n = document.createElement('div');
              n.textContent = 'Coordinates copied to clipboard!';
              n.className = 'copy-notification';
              document.body.appendChild(n);
              setTimeout(() => n.remove(), 2000);
            })
            .catch(() => {});
        });
        labels.current.push(label);
      }
    }),
    demo('Delete Shapes Tool 🗑️', 'Activating the Delete tool to clean up drawn vector shapes and restore the map canvas.', tool('remove'), () => removeTourLayers()),
  ];
  return <TourRunner steps={steps} sideOnDesktop onEnd={onEnd} onStop={removeTourLayers} />;
}
