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
    intro('Map Drawing Tools Toolbar ✏️', 'These tools let you draw on the map to measure distances and areas. On a phone, a cross-hair appears in the middle of the map: move the map under it and tap + to add each point.', toolbar),
    intro('1. Polyline Tool 📐', 'Draw a line to measure distance, for example along a road or a field edge. Each section shows its length.', tool('polyline')),
    intro('2. Polygon Tool 🔷', 'Draw around a piece of land to get its area in acres, kanal and marla.', tool('polygon')),
    intro('3. Rectangle Tool 🟦', 'Draw a rectangle by dragging from one corner to the opposite corner. Its area and side lengths are shown.', tool('rectangle')),
    intro('4. Circle Tool ⭕', 'Tap the centre and drag outwards to draw a circle, for example the area around a well. Its radius and area are shown.', tool('circle')),
    intro('5. Pin Drop / Marker Tool 📍', 'Drop a pin on a place, such as a well, a gate or a corner. Tap its label to copy the coordinates.', tool('marker')),
    intro('6. Edit Shapes & Vertices ✏️', 'Move the corner points of anything you have drawn. Measurements update as you move them.', tool('edit')),
    intro('7. Delete Shapes Tool 🗑️', 'Tap a drawing to remove it from the map.', tool('remove')),
    demo('Polyline Creation & Length Badges 📏', 'Here is an example line. Each section shows its length; the unit button (Ft / Km / m) changes the units.', tool('polyline'), (L, map, g) => {
      map.flyTo(map.getCenter(), 18, { animate: true, duration: 1.2 });
      const c = map.getCenter();
      const pts = [L.latLng(c.lat + 0.0003, c.lng - 0.0004), L.latLng(c.lat + 0.0005, c.lng), L.latLng(c.lat + 0.0003, c.lng + 0.0004)];
      if (!r.current.polyline) r.current.polyline = L.polyline(pts, { color: '#00ffff', weight: 4, opacity: 0.9, dashArray: '6, 6' }).addTo(g);
      else r.current.polyline.setLatLngs(pts);
      drawLabels(pts);
      return 1200;
    }),
    demo('Edit Polyline & Vertex Recalculation 🔄', 'We moved one point of the line. The lengths updated straight away.', tool('edit'), (L, map) => {
      openEdit();
      const c = map.getCenter();
      const pts = [L.latLng(c.lat + 0.00045, c.lng - 0.0005), L.latLng(c.lat + 0.00065, c.lng + 0.0001), L.latLng(c.lat + 0.00035, c.lng + 0.00055)];
      if (r.current.polyline) {
        r.current.polyline.setLatLngs(pts);
        r.current.polyline.setStyle({ color: '#28a745', dashArray: null });
      }
      drawLabels(pts);
    }),
    demo('Save Polyline Edits & Close Menu 💾', 'Press Finish or Save to keep the change and leave edit mode.', saveBtn, () => saveAndClose()),
    demo('Polygon Boundary Creation 🔷', 'Here is an example area. The box shows its size in acres, kanal and marla, and each side shows its length.', tool('polygon'), (L, map, g) => {
      const c = map.getCenter();
      if (!r.current.polygon)
        r.current.polygon = L.polygon(
          [L.latLng(c.lat + 0.0001, c.lng + 0.0006), L.latLng(c.lat + 0.0004, c.lng + 0.0009), L.latLng(c.lat + 0.0001, c.lng + 0.0012), L.latLng(c.lat - 0.0002, c.lng + 0.0009)],
          { color: '#ffd700', fillColor: '#ffd700', fillOpacity: 0.35, weight: 3 },
        ).addTo(g);
    }),
    demo('Edit Polygon Vertex 📐', 'We moved one corner. The area updated straight away.', tool('edit'), (L, map) => {
      openEdit();
      const c = map.getCenter();
      r.current.polygon?.setLatLngs([L.latLng(c.lat + 0.0001, c.lng + 0.0006), L.latLng(c.lat + 0.00055, c.lng + 0.00105), L.latLng(c.lat + 0.0001, c.lng + 0.00135), L.latLng(c.lat - 0.0002, c.lng + 0.0009)]);
    }),
    demo('Save Polygon Edits & Close Menu 💾', 'Press Finish or Save to keep the change.', saveBtn, () => saveAndClose()),
    demo('Rectangle Parcel Creation 🟦', 'Here is an example rectangle with its area and side lengths.', tool('rectangle'), (L, map, g) => {
      const c = map.getCenter();
      if (!r.current.rectangle)
        r.current.rectangle = L.rectangle(L.latLngBounds(L.latLng(c.lat - 0.0005, c.lng - 0.0003), L.latLng(c.lat - 0.0002, c.lng + 0.0003)), {
          color: '#32cd32',
          fillColor: '#32cd32',
          fillOpacity: 0.35,
          weight: 3,
        }).addTo(g);
    }),
    demo('Edit Rectangle Bounds 📐', 'Drag its corner points to resize it.', tool('edit'), () => openEdit()),
    demo('Save Rectangle Edits & Close Menu 💾', 'Press Finish or Save to keep the change.', saveBtn, () => saveAndClose()),
    demo('Circle Buffer Creation ⭕', 'Here is an example circle with its radius and area.', tool('circle'), (L, map, g) => {
      const c = map.getCenter();
      if (!r.current.circle)
        r.current.circle = L.circle(L.latLng(c.lat - 0.0003, c.lng - 0.0007), { radius: 35, color: '#00ffff', fillColor: '#00ffff', fillOpacity: 0.35, weight: 3 }).addTo(g);
    }),
    demo('Pin Drop / Marker Placement 📍', 'Here is an example pin. Tap its coordinates label to copy them and share on WhatsApp.', tool('marker'), (L, map, g) => {
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
    demo('Delete Shapes Tool 🗑️', 'Finally the delete tool removes the example drawings. To keep your own drawings for later, use Save Layer in the menu.', tool('remove'), () => removeTourLayers()),
  ];
  return <TourRunner steps={steps} sideOnDesktop onEnd={onEnd} onStop={removeTourLayers} />;
}
