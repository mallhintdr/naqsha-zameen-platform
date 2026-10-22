// One place that moves the map camera to a murabba / plot.
//
// Before this, a single click fired several competing moves (click handler flyTo,
// then one or two selection effects doing flyToBounds), each interrupting the last,
// while tiles were reloading. Now every murabba move goes through here:
//   - map.stop() + a request token, so the newest request always wins;
//   - the motion is chosen by distance: small pan for on-screen targets, a short
//     glide for neighbours, a single arc only for far jumps;
//   - heavy follow-up work runs once the camera has settled (afterMove).
import L from 'leaflet';

let requestSeq = 0;

const prefersReducedMotion = () => {
  try { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

/** Run fn once the current camera move has finished (or right away if nothing is moving). */
export function afterMove(map, fn, maxWaitMs = 2500) {
  if (!map || typeof fn !== 'function') return;
  let done = false;
  const run = () => { if (done) return; done = true; map.off('moveend', run); clearTimeout(t); fn(); };
  const t = setTimeout(run, maxWaitMs);
  if (map._murabbaCameraMoving) map.on('moveend', run);
  else setTimeout(run, 0);
}

function move(map, target, opts) {
  const token = ++requestSeq;
  map._murabbaCameraToken = token;
  const { padding = [40, 40], maxZoom = 18, minZoom = 0 } = opts;

  try { map.stop(); } catch { /* not animating */ }

  const size = map.getSize();
  const fromCenter = map.getCenter();
  const fromZoom = map.getZoom();

  let toCenter;
  let toZoom;
  if (target.bounds) {
    const p = L.point(padding[0], padding[1] ?? padding[0]);
    toZoom = Math.max(minZoom, Math.min(maxZoom, map.getBoundsZoom(target.bounds, false, p)));
    toCenter = target.bounds.getCenter();
  } else {
    toCenter = L.latLng(target.latlng);
    toZoom = Math.max(minZoom, Math.min(maxZoom, target.zoom ?? fromZoom));
  }

  const done = () => {
    map._murabbaCameraMoving = false;
    if (map._murabbaCameraToken === token && typeof opts.onSettled === 'function') opts.onSettled();
  };

  // Screen distance to the target, measured at the current zoom.
  const a = map.latLngToContainerPoint(fromCenter);
  const b = map.latLngToContainerPoint(toCenter);
  const distPx = a.distanceTo(b);
  const screen = Math.max(size.x, size.y) || 1;
  const zoomDelta = Math.abs(toZoom - fromZoom);

  if (prefersReducedMotion()) {
    map.setView(toCenter, toZoom, { animate: false });
    done();
    return token;
  }

  // Nothing (or almost nothing) to do.
  if (distPx < 4 && zoomDelta < 0.05) { done(); return token; }

  map._murabbaCameraMoving = true;
  map.once('moveend', done);

  // SMOOTH: 30% longer moves with softer easing (lower easeLinearity = gentler
  // start/stop). Change this one number to tune every murabba animation.
  const SMOOTH = 1.3;
  const soft = (e) => +(e / SMOOTH).toFixed(3);

  if (zoomDelta < 0.25 && distPx < screen * 0.9) {
    // Murabba to murabba at the same zoom. Uses flyTo (ease-in + ease-out, like the
    // zoom animations) instead of panTo, whose motion starts and stops abruptly.
    // Duration scales with distance so short hops stay quick but never jerky.
    const hop = Math.min(1, distPx / screen);
    map.flyTo(toCenter, toZoom, { duration: (0.55 + hop * 0.35) * SMOOTH, easeLinearity: soft(0.35) });
  } else if (distPx < screen * 1.5 && zoomDelta <= 2) {
    // Neighbouring murabba / modest zoom change: short glide (at this range flyTo's
    // arc is negligible, and it animates pan + zoom together, unlike setView).
    map.flyTo(toCenter, toZoom, { duration: (0.65 + zoomDelta * 0.1) * SMOOTH, easeLinearity: soft(0.35) });
  } else {
    // Far jump: a single smooth arc, duration grows with distance.
    const duration = Math.min(1.4, 0.7 + (distPx / screen) * 0.12 + zoomDelta * 0.08) * SMOOTH;
    map.flyTo(toCenter, toZoom, { duration, easeLinearity: soft(0.25) });
  }
  return token;
}

/** Frame a murabba / plot by its outline. */
export function focusBounds(map, bounds, opts = {}) {
  if (!map || !bounds || typeof bounds.isValid !== 'function' || !bounds.isValid()) return null;
  return move(map, { bounds }, opts);
}

/** Centre on a point (when only a centroid is known), zooming in to at least `zoom`. */
export function focusPoint(map, latlng, opts = {}) {
  if (!map || !latlng) return null;
  const zoom = Math.max(map.getZoom(), opts.zoom ?? 17);
  return move(map, { latlng, zoom }, opts);
}

/** True if a map click selected a murabba in the last `ms` milliseconds. */
export const wasClickSelection = (map, ms = 1500) =>
  Boolean(map?._clickTriggeredSelection && Date.now() - map._clickTriggeredSelection < ms);
