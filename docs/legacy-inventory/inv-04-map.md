# INV-04 — Map page (route "/") inventory

Source root: `D:\temp-repo\old-repo\src`. All line refs are to that tree. Everything below was read in full from:
`components/Map/Core/**` (MapComponent, MapSidebar, DrawControl, GuidedDrawingMode(+css), GuidedRulerOverlay, ShapeTransformControls, CompassControl, LocateControl, SearchControl, LayerControl, AdminToolbar, MouzaNavigator, VectorTileLoader, VectorTileToggle, loadMurabbaPMTiles, securePMTilesProtocol, tileStyles, measurementUtils, GoToLocationForm, ShiftMouzaForm, LoadingOverlay(+css), `Map/*.js`, `hooks/*.js`, `utils/*.js`, `css/*.css`), `components/Map/{MapControlsPanel,MapLegend,LocationComponents}`, `styles/{GoToLocationForm,ShiftMouzaForm,ShiftPMTilesForm}.css`, `config/pmtiles*.js`, `utils/{locationUtils,akar,lruCache,deviceUtils}.js`, `hooks/useUserLayers.js`, `lib/mouzaApi.js` (metadata fetchers), and the map-related parts of `App.js`, `styles/global.css`, `index.css`.

Images in `components/Map/Core/images`: `compass-icon.png`, `location.png`, `north-static.png`, `north.png`. **Only `location.png` is referenced** (LocateControl button background). The compass is now inline SVG; `north*.png`/`compass-icon.png` are dead assets.

Dead / unmounted components found (not rendered by MapComponent or anything else): `MapSidebar.js` (react-bootstrap Offcanvas with 4 radio base layers + shajra switch/opacity range), `VectorTileToggle.js` (admin checkbox at top:10px/right:10px), `ShapeTransformControls.js` (+css, on-shape Move/Rotate handles in edit mode), `MapControlsPanel.js` (+css, dark zoom/reset/fullscreen panel top:80px left:16px), `MapLegend.js` (+css, dark collapsible legend bottom:24px left:16px), `Map/GeoJsonLoader.js` (old "geojson-only" loader; imported by MapComponent but never rendered — `dataMode` is only ever `'shajra'` or `'geojson-db'`), `Map/GeoJsonInteractionLayer.js` (not imported anywhere), `LocationComponents.js` (used only by `Admin/EnhancedStatistics.js`, not the map page). `config/pmtiles-simple.js` is not imported by the map code (only `config/pmtiles.js` is). Their specs are still recorded below in §2 (marked DEAD) in case the rebuild wants them.

---

## 1. Map page layout

### 1.1 App shell (App.js 346-372, 466-475)
- On `/` the Bootstrap `<Container fluid className="app-container px-0">` gets inline `position:fixed; top/left/right/bottom:0; overflow:hidden; display:flex; flex-direction:column; width:100%; paddingBottom: env(safe-area-inset-bottom)`. Other routes: `height:auto; minHeight:100dvh; overflow:visible`.
- Children in order: `<Header>` (navbar `.navbar-tech-theme`, height **42px**, see navbar inventory), `SubscriptionWarningBanner`, `NavigationMenu` (offcanvas), then `<div className="app-main flex-grow-1 d-flex flex-column" style={{overflow:'hidden'}}>` → `<Suspense>` → `<Routes>` → `<MapComponent>` lazy-loaded.
- `MapComponent` renders `<div className="map-container" style={{position:'relative'}}>` with CSS `.map-container{height:100%;width:100%}` and `<MapContainer style={{height:'100%',width:'100%'}}>`. So the map fills everything below the 42px navbar; iOS safe-area bottom is handled only by the container `paddingBottom`.
- Modals rendered by App (outside the map DOM): `ShiftMouzaForm` (`showShiftForm`), `GoToLocationForm` (`showGoToForm`).

### 1.2 MapContainer options (MapComponent.js 1780-1816) — keep EXACT
```
center=[30,71] zoom=5 maxZoom={currentMaxZoom}   // 14 if restricted user, else 21
rotate={true} rotateControl={false} touchRotate={false} bearing={0}   // leaflet-rotate
zoomSnap=0.25 zoomDelta=0.5 wheelPxPerZoomLevel=117 wheelDebounceTime=40
zoomAnimation zoomAnimationThreshold=6 fadeAnimation markerZoomAnimation
inertia inertiaDeceleration=2300 inertiaMaxSpeed=1500 easeLinearity=0.15
attributionControl={false} tap={false} whenCreated={onMapInit}
key={mapKey}  // remount on mapKey change
```
`isRestricted = user.userType!=='admin' && (status==='Expired'||status==='Pending'||daysRemaining<=0)`; `currentMaxZoom = isRestricted?14:21`. Default Leaflet zoom control (`topleft`, standard +/−) is NOT disabled, so it renders first in the top-left stack.

### 1.3 Control placement (Leaflet corners + absolute overlays)
| Control | Corner / position | Size | Notes |
|---|---|---|---|
| Leaflet zoom (+/−) | `topleft` (default Leaflet) | default | first in stack |
| LocateControl | `topleft` (after zoom) | 35×35 circle | `L.Control`, button `#leaflet-location-control-btn.leaflet-location-icon` |
| SearchControl (🔍) | `topleft` (after locate) | 35×35 circle | opens GoToLocationForm |
| Geoman draw toolbar | `bottomleft` | Geoman default (30px buttons), `oneBlock:true` | class alias `leaflet-draw-toolbar` added |
| Circular unit toggle (Ft/Km/m) | absolute, **computed**: `bottom = mapBottom − toolbarTop + 12px`, `left = toolbarLeft + toolbarWidth/2 − 18px` (fallback css `bottom:350px;left:12px`, mobile `bottom:340px;left:10px`) | 36×36 (34 mobile) | only when drawing or drawings exist |
| Compass (+ rotate ring + accuracy badge) | `topright` | wrapper 42×42, `margin-right:12px; margin-top:12px` (10px mobile) | |
| AdminToolbar | absolute `top:50%; right:10px; translateY(-50%)` | 40px buttons (34 mobile) | admin / subadmin only |
| LayerControl dropdown | absolute `bottom:10px; right:10px` (8px mobile) | select h 32px (28 mobile) | `z-index:1000` |
| Killa/drawn area info box | `bottomright` Leaflet control positioned via css `bottom:54px; right:10px` | auto | `z-index:1050` |
| MouzaNavigator (test mode) | absolute `top:10px; left:50%; translateX(-50%)` | — | `z-index:2000` |
| "Acquiring location…" message | absolute `top:10px; left:50%` | — | `z-index:1000` |
| LoadingOverlay | absolute inset 0, centered | spinner 40px | `z-index:9999`, transparent bg |
| GuidedDrawingMode overlay | absolute inset 0 | — | `z-index:15000`; toolbar container `z-index:15001`, `bottom:30px` (56px/60px + safe-area on ≤768/≤480) |
| GuidedRulerOverlay SVG | portal into map container, absolute inset 0 | — | `z-index:14000` |
| Clear-cache button | `.clear-cache-container` (no CSS defined; `showClearCacheOption` never passed → never shown) | | |
| Go-To markers | Leaflet markers w/ permanent tooltip `Lat: x, Lng: y` | icon 35×35 | iconUrl `https://cdn-icons-png.flaticon.com/512/684/684908.png`, anchor [17,35], tooltipAnchor [0,-35] |

### 1.4 z-index stacking
Leaflet panes (created once in `MapUpdater`, MapComponent.js 948-964; all start `pointer-events:none`):
- `completePMTilesPane` **550** (killa boundaries canvas, zoom≥15)
- `fallbackGeoJsonPane` **550** set by useFallbackGeoJSON/useGeoJsonLayer (initially 625 in MapUpdater; overwritten to 550 on load)
- `mouzaPMTilesPane` **610** (mouza murabba outlines canvas)
- `killaTooltipPane` **620** (615 when created by fallback path, 620 in MapUpdater/usePMTilesLoader)
- `murabbaPane` **630** (selected murabba killa SVG + killa highlight; set to 700 in dead geoJsonTransform path)
- `murabbaTooltipPane` **640**
- `geoJsonMouzaPane` 450 (dead GeoJsonLoader)
- Standard: tilePane 200, overlayPane 400 (drawn shapes!), markerPane 600, tooltipPane 650, popupPane 700.
DOM overlays: controls 1000; area box 1050; MouzaNavigator 2000; tooltip-selected 5000; LoadingOverlay 9999; ShapeTransform 10001 (dead); ruler 14000; guided overlay 15000/15001; modals (bootstrap) 1055.

**Important**: drawn shapes live in the default `overlayPane` (400) i.e. BELOW the data panes, which is why DrawControl injects `pointer-events:none` on data panes during draw/edit and hit-tests drawn shapes manually on click.

### 1.5 Mobile vs desktop
- **Data source**: `isMobile = L.Browser.mobile || /Mobi|Android|iPhone|iPad|iPod/i.test(UA)` → GeoJSON-first; desktop → PMTiles-first (VectorTileLoader 1313-1350, loadMurabbaPMTiles 273-279).
- **Admin override** `adminMapMode` (`localStorage 'admin_map_mode'`, `'auto'|'geojson'|'pmtiles'`): admin only; `'geojson'` forces mobile path (and suppresses PMTiles fallback — shows error instead), `'pmtiles'` forces desktop path. Toggling `forceMobileMode` ON also sets `adminMapMode='geojson'` (App.js 431-438).
- **Guided drawing** (crosshair mode) triggers when `forceMobileMode || window.innerWidth<=1024 || L.Browser.mobile || navigator.maxTouchPoints>0` at `pm:drawstart` (GuidedDrawingMode 128-156). Desktop uses native Geoman drawing + ruler lines following cursor.
- **Three-finger rotate** (ThreeFingerRotateControl): 3 touches → `map.setBearing(initialBearing + dx*0.5)`; `touchRotate` is false so two-finger rotate is disabled.
- CSS breakpoints: `@media (max-width:768px)` for LayerControl, AdminToolbar, Compass, DrawControl labels, Guided toolbar; `480px` for guided container.
- Safe area: `env(safe-area-inset-bottom)` on app container padding and guided toolbar bottom (`calc(env(safe-area-inset-bottom,0px) + 56px|60px)`).

### 1.6 Global map CSS (keep)
- `index.css`: `.leaflet-tooltip, .leaflet-tooltip-content, .leaflet-popup-content* { color:#111827 !important }` (overridden by murabba/killa classes).
- `global.css 133-139`: `.map-animating .leaflet-geoJsonMouzaPane-pane, .leaflet-murabbaPane-pane, .leaflet-fallbackGeoJsonPane-pane, .leaflet-murabbaTooltipPane-pane, .leaflet-killaTooltipPane-pane { visibility:hidden !important }` — hides vector layers during programmatic moves.
- `MapComponent_append.css`: `.killa-tooltip-fraction{font-size:85% !important}`; `.leaflet-tile{outline:none;border:none}`; `.leaflet-tile-container img{background:transparent}`; `.leaflet-tile-loaded{image-rendering:-webkit-optimize-contrast}`; `.leaflet-tile-pane{background:transparent}`.
- `MapComponent.css`: `.tooltip-selected { transform-origin:center; z-index:5000; border:2px solid #FFD700; background:rgba(0,0,0,0.9); color:#fff; border-radius:4px; box-shadow:0 0 7px rgba(255,215,0,0.5); font-weight:bold; padding:1px 4px; min-width:auto }` (all !important).
- Map container gets `data-zoom="<round(zoom)>"` attribute (GlobalZoomTracker) — label font sizes key off it.

---

## 2. Controls / panels / overlays — visual spec + behaviour

### 2.1 LocateControl (`LocateControl.js`, `css/LocateControl.css`)
- Button `.leaflet-location-icon`: 35×35, `background:#ffffff`, `background-image:url(location.png)` size 25×25 centered no-repeat, `border:1px solid #ccc`, `border-radius:50%`, `box-shadow:0 2px 4px rgba(0,0,0,0.2)`, transition transform/box-shadow/bg 0.2s. Hover: `scale(1.1)`, shadow `0 4px 8px rgba(0,0,0,0.3)`, bg `#f3f4f6`. Title "Track My Live Location".
- Active `.leaflet-location-icon-active`: bg `#86efac`, border `#4ade80`; hover bg `#4ade80`. Title "Locating…" while active.
- User marker: divIcon `.blinking-location` html `<div class="blinking-circle">`, 14×14 anchor [7,7]; `.blinking-circle{width/height:14px; background:#ff2701; border-radius:50%; border:3px solid #fdeb79; animation:blink 1.1s infinite}` keyframes `0%,100% scale(0.9); 50% scale(1.1)`.
- Accuracy circle `L.circle` className `.leaflet-accuracy-circle{stroke:none; fill:#136AFE; fill-opacity:0.2}` radius = accuracy m.
- `.locating-message`: absolute top 10px, centered, `background:rgba(0,0,0,0.7); color:#fff; padding:4px 8px; border-radius:4px; font-size:14px; z-index:1000`, text "Acquiring location…".
- Behaviour: toggle. Start: Tier1 `getCurrentPosition({enableHighAccuracy:false,timeout:10000,maximumAge:30000})`; Tier3 `watchPosition({enableHighAccuracy:true,timeout:15000,maximumAge:5000})`; on high-acc error (not code 1) → Tier2 `getCurrentPosition({false,15000,60000})` then low-accuracy watch `({false,20000,30000})`. Positions buffered (max 50) and averaged every 5s. First fix → `map.flyTo([lat,lng],18,{duration:2})`. Dispatches `window` event `locationAccuracyUpdate {accuracy, active:true}`; stop → `{active:false}`. Alerts: "Geolocation is not supported by your browser.", "Location permission denied. Please allow location access in your browser settings.", "Unable to retrieve location. Please check if device GPS / Location is turned on and try again."
- Unused CSS in file: `.locate-toast*` (fixed top 80px right 20px, z 10000, white cards with left border colours success `#4facfe`, error `#f5576c`, warning `#f59e0b`, info `#667eea`) and `.gps-accuracy-indicator/.accuracy-badge` (fixed bottom 30px right 20px) — nothing renders them.

### 2.2 SearchControl (`SearchControl.js`, `css/SearchControl.css`)
- `.leaflet-search-container{position:relative}` > `button.search-btn` innerHTML `🔍`, title "Go to coordinates"; `35×35; border-radius:50%; background:#fff; border:1px solid #ccc; display:flex; center; font-size:18px`. Click → `onSearchClick()` = `setShowGoToForm(true)`.
- Unused `.search-form/.search-input/.search-results` styles (white 200px input dropdown) remain in CSS.

### 2.3 CompassControl (`CompassControl.js`, `css/CompassControl.css`) — topright
- Wrapper `.compass-control-wrapper` 42×42, `margin-right:12px; margin-top:12px` (10px ≤768).
- Rotate ring `.compass-rotate-ring` (z1, 42×42, `cursor:grab`): `background:linear-gradient(135deg, rgba(15,23,42,0.68) 0%, rgba(30,41,59,0.78) 100%)`, `backdrop-filter:blur(14px)`, `border:1px solid rgba(255,255,255,0.22)`, `box-shadow: 0 0 0 1px #ffffff, 0 0 8px rgba(0,0,0,0.3), inset 0 1.5px 3px rgba(255,255,255,0.15), inset 0 0 0 0.8px rgba(56,189,248,0.25)`. Hover: gradient `(0.82→0.9)`, border `rgba(56,189,248,0.5)`, shadow `0 0 0 1.5px #fff, 0 5px 14px rgba(0,0,0,0.4), inset 0 1.5px 3px rgba(255,255,255,0.2), inset 0 0 0 1px rgba(56,189,248,0.5)`. Active/`.is-dragging`: `cursor:grabbing`, gradient `rgba(15,23,42,0.9)→0.98`, inset ring `rgba(255,42,75,0.75)`.
  - Notch `::after`: `top:-8.5px; left:50%; translateX(-50%); 14×12` crimson triangle SVG data-URI (`fill:#ff2a4b` + white 1px inner stroke), `filter:drop-shadow(0 0 5px rgba(255,42,75,0.5)) drop-shadow(0 2px 2px rgba(0,0,0,0.3))`. Hover: fill `#ff4d69`, `scale(1.15)`, glow 8px/0.7. Active: fill `#e61c3c`, `scale(1.25)`, glow 10px/0.8.
  - Drag-to-rotate: pointer angle delta (normalised ±180) → `map.setBearing(current + delta)`.
- Icon `.leaflet-compass-icon` (z2, 36×36 centered): `background:rgba(255,255,255,0.75); backdrop-filter:blur(10px); border-radius:50%; border:1px solid rgba(255,255,255,0.6); box-shadow:0 2px 8px rgba(0,0,0,0.12), inset 0 1px 2px rgba(255,255,255,0.8)`. `.map-rotated`: `border-color:#eab308; box-shadow:0 0 0 2px rgba(234,179,8,0.2)`. `.compass-loading`: opacity .6, pulse 1.5s. `.compass-active`: `filter:drop-shadow(0 0 4px rgba(102,126,234,0.8))`. `.compass-calibrating`: opacity .7 pulse 2s. keyframes `pulse{0%,100% opacity .7 scale(1); 50% opacity .9 scale(1.05)}`, `compassGlow` (0→15px ring rgba(102,126,234,.6)).
- SVG (viewBox 0 0 100 100, `.compass-svg{filter:drop-shadow(0 1px 2px rgba(0,0,0,0.3))}`): outer circle r46 stroke `rgba(255,255,255,0.15)`; cardinal ticks `M50 2 L50 9…` stroke `rgba(0,0,0,0.5)` w3 round; sub-cardinal diagonal ticks stroke `rgba(0,0,0,0.3)` w2; letters font `'Inter',-apple-system,sans-serif`: N at (50,22) size 20 weight 900 fill `#dc2626`; E (79,50), S (50,78), W (21,50) size 15 weight 800 fill `#0f172a`, all `drop-shadow(0 1px 2px #fff)`. Needle group `transition: transform 0.2s cubic-bezier(0.34,1.56,0.64,1)` (css overrides to `transition:none`): north polygon `50,10 44,50 56,50` fill gradient `#ff4b4b→#cc0000`; south `50,90 44,50 56,50` gradient `#f8fafc→#94a3b8`; pivot circle r5 `#334155`, r2 `#cbd5e1`; shadow filter `feDropShadow dx1 dy2 std1.5 #000 .25`.
- Needle rotation = continuous map bearing (shortest-path accumulated) minus device heading when active; ring rotates by continuous bearing.
- Click: if |bearing|>0.5 → animate reset to north (duration `clamp(180, |b|*1.3, 280)` ms, easeOutCubic) and return; else toggle device-orientation compass (iOS `DeviceOrientationEvent.requestPermission`), throttle 80ms mobile / 32ms desktop (`lodash/throttle`), adaptive smoothing alpha 0.3 (>10° diff) else 0.12, declination from `https://api.ngdc.noaa.gov/geomag-web/calculators/calculateDeclination?lat1&lon1&resultFormat=json` (1.5s abort) else +2.0 if within lat 23-38/lng 60-80.
- Titles: "Click to reset map rotation to North" / "Compass active - click to disable" / "Click to enable compass".
- Accuracy badge `#locate-accuracy-badge-btn.locate-accuracy-badge` below compass: `top:calc(100% + 8px)`, flex column, `border-radius:6px; padding:2px 6px; min-width:46px; box-shadow:0 2px 6px rgba(0,0,0,0.3); font-family:'Inter',Arial; z-index:1001; animation lacFadeIn .25s`. html `<span class="lac-val">±{ft}ft</span><span class="lac-lbl">{HIGH|MED|LOW}</span>`; bg `#16a34a` ≤50ft HIGH, `#d97706` ≤150ft MED, else `#dc2626` LOW. `.lac-val{#fff; 11px; 700; ls .3px}` `.lac-lbl{rgba(255,255,255,.9); 8px; 600; ls .8px; uppercase}`.

### 2.4 LayerControl (`LayerControl.js`, `css/LayerControl.css`) — see §3 for layers
- `.dropdown-container`: absolute bottom 10 right 10, z 1000, `background:linear-gradient(135deg, rgba(15,32,39,0.95) 0%, rgba(32,58,67,0.95) 50%, rgba(44,83,100,0.95) 100%)`, `backdrop-filter:blur(10px)`, `border:1px solid rgba(0,255,255,0.3)`, `border-radius:16px`, `padding:1px`, font `'Segoe UI','Arial'`; hover border `rgba(0,255,255,0.5)`.
- `select#map-base-layer-select.dropdown-select`: `height:32px; font-size:13px; font-weight:500; border-radius:16px; border:1px solid rgba(0,255,255,0.4); padding:0 8px; background:linear-gradient(135deg, rgba(0,212,255,0.1), rgba(138,43,226,0.1)); color:#00ffff; cursor:pointer`; inline `width: calc(<name.length*0.95>ch + 32px)`. Hover gradient 0.2/0.2 + border `#00ffff`; focus 0.25/0.25. Options: `padding:8px; font-size:14px; background:#1a2332; color:#00ffff; weight 500`; checked `background:#0d9488; color:white; weight 600`. Mobile: h28, 12px, radius 14, padding 0 6px.
- Click/scroll propagation disabled. Layer swap: remove previous `L.tileLayer`, add new; unmount removes it.

### 2.5 Killa / drawn area info box (`css/LayerControl.css 95-166`, built in measurementUtils.showKaramSegmentLengths and DrawControl.showAreaBox)
- `.killa-area-info-box, .drawn-area-info-box`: absolute `bottom:54px; right:10px; z-index:1050; background:linear-gradient(135deg, rgba(15,23,42,0.96), rgba(30,41,59,0.96)); backdrop-filter:blur(12px); border:1px solid rgba(56,189,248,0.5); border-radius:12px; padding:8px 30px 8px 16px; box-shadow:0 8px 24px -4px rgba(0,0,0,0.5), 0 0 12px rgba(56,189,248,0.3); text-align:center; white-space:nowrap; animation:killaBoxPopIn .3s` (`translateY(10px) scale(.95)`→1).
- HTML: `<button class="killa-area-close-btn" title="Close Measurements">&times;</button><div class="killa-area-title">Killa Area|Area|Rectangle Area|Circle Area</div><div class="killa-area-value">…</div>`.
- `.killa-area-close-btn`: absolute top 4 right 8, transparent, `color:rgba(255,255,255,0.6); font-size:16px; weight 700; padding:2px 4px; radius 4px`; hover `color:#ef4444; background:rgba(239,68,68,0.15)`.
- `.killa-area-title`: `10px; 700; uppercase; letter-spacing .8px; color:#38bdf8; margin-bottom 2px`. `.killa-area-value`: `14px; 800; #fff; font-family 'Segoe UI',system-ui; text-shadow 0 0 8px rgba(56,189,248,0.5)`.

### 2.6 AdminToolbar (`AdminToolbar.js`, `css/AdminToolbar.css`)
- Container: absolute `top:50%; right:10px; translateY(-50%); z 1000; flex column; gap 8px; background:#fff; border:2px solid rgba(0,0,0,0.2); border-radius:25px; padding:6px; box-shadow:0 1px 5px rgba(0,0,0,0.4); font 'Segoe UI'`. Mobile: gap 6, padding 4.
- Button `.admin-toolbar-btn`: 40×40 (34 mobile), `border-radius:50%; border:2px solid rgba(0,0,0,0.2); bg #fff; color #464646; font-size 18px; box-shadow 0 2px 5px rgba(0,0,0,0.2); transition .2s`. Hover: bg `#f4f4f4`, color `#000`, `translateY(-2px)`, shadow `0 4px 8px rgba(0,0,0,0.3)`. Icon 18px (15 mobile), react-icons/fa.
- Tooltip `.admin-toolbar-tooltip` (hover, left of button): `right:50px; top:50%; translateY(-50%) translateX(10px→0); background:rgba(15,32,39,0.95); backdrop blur 5px; color:#00ffff; padding 6px 12px; radius 8px; 12px/500; border 1px solid rgba(0,255,255,0.3)`.
- Variants (color / border / idle gradient / hover gradient+border+shadow):
  - `.btn-register` FaUserPlus `#2ecc71`, `rgba(46,204,113,.4)`, `linear-gradient(135deg, rgba(46,204,113,.1), rgba(138,43,226,.1))` → `.3/.3`, border `#2ecc71`, shadow `0 4px 10px rgba(46,204,113,.3)`
  - `.btn-manage` FaUserEdit `#fd7e14`, `rgba(253,126,20,.4)`, gradient with `rgba(138,43,226,.1)`
  - `.btn-public-users` FaUsers `#9b59b6`, gradient with `rgba(52,152,219,.1)`
  - `.btn-insights` FaChartBar `#e84393`, gradient with `rgba(138,43,226,.1)`
  - `.btn-subadmins` FaUserTie `#e67e22`, gradient with `rgba(241,196,15,.1)`
- Admin items: `/admin/register` "Register User"; `/users` "Manage Users" (title "Manage/Edit Users"); `/users?tab=publicRegistration` "Public Users"; `/stats` "Insights"; `/admin/subadmins` "Sub-admins". Subadmin items: `/subadmin/users?new=1` "New Customer" (btn-register); `/subadmin/users` "My Customers" (btn-manage); `/subadmin/users?tab=awaiting` "Awaiting Activation" (btn-public-users); `/subadmin` "Dashboard & Bills" (btn-insights). Others: null.

### 2.7 MouzaNavigator (`MouzaNavigator.js`) — rendered only when `testMode`
Inline: `position:absolute; top:10px; left:50%; translateX(-50%); zIndex:2000; backgroundColor:rgba(255,255,255,0.9); padding:5px 10px; borderRadius:20px; boxShadow:0 2px 6px rgba(0,0,0,0.3); flex; gap 10px`. Text `<span bold .9rem #333>Test Mode: {currentMauza||'No Mouza'}</span>` + react-bootstrap `ButtonGroup size=sm` with `outline-primary` buttons `<FaChevronLeft/> Prev` / `Next <FaChevronRight/>` (hasPrev/hasNext always true). Calls `onPrevMauza/onNextMauza` → `handleNavigateMauza` (admin only; fetches mauza list and selects neighbour).

### 2.8 LoadingOverlay (`LoadingOverlay.js/.css`)
`.loading-overlay{absolute inset 0; background:transparent; flex center; z 9999; pointer-events:all; animation fadeIn .2s}`; `.loading-spinner-container{flex column; gap 12px}`; `.loading-spinner{40×40; border:3px solid rgba(52,152,219,0.2); border-top:3px solid #3498db; radius 50%; spin .8s linear infinite}`; `.loading-message{14px; 500; color #333; background rgba(255,255,255,0.95); padding 6px 12px; radius 4px; shadow 0 2px 8px rgba(0,0,0,0.15); font-family -apple-system,…}`.
Messages (MapComponent 1934-1949): external `loadingMessage` (`Loading mouzas for {tehsil}...` / `Loading murabbas for {mauza}...`) else extraction progress `✨ Instant load from metadata ({found} murabbas)` or `Extracting murabbas... ({found} found, {processed}/{total} tiles)` else `Loading Murabba {n}...` / `Loading {mauza}...` / `Loading map data...`. Shown when `isLoadingMouza || externalLoading`.

### 2.9 Geoman draw toolbar (`DrawControl.js`, `css/DrawControl.css`)
- `map.pm.addControls({position:'bottomleft', drawMarker, drawPolyline, drawPolygon, drawRectangle, drawCircle, drawCircleMarker:false, drawText:false, editMode, dragMode, cutPolygon:false, removalMode, rotateMode, oneBlock:true})`.
- Global options: `continueDrawing:false, allowSelfIntersection:false, allowSelfIntersectionEdit:false, clickTolerance:15, snappable:true, snapDistance:20`.
- Legacy aliases added after 200ms: toolbar gets `.leaflet-draw-toolbar`; buttons get `.leaflet-draw-draw-polyline|polygon|rectangle|circle|marker`, `.leaflet-draw-edit-edit|drag|rotate|remove` (tours target these); actions container gets `.leaflet-draw-actions`.
- CSS: active button `background:rgba(220,220,220,0.9); color:#333`; hover `background:rgba(100,223,247,0.9); scale(1.1); shadow 0 4px 8px rgba(0,0,0,0.3)`. Edit/delete block separated: `.button-container:has(.leaflet-pm-icon-edit){margin-top:12px; border-top:1px solid rgba(0,255,255,0.3)}`.
- Icon colour filters (CSS `filter` on Geoman's black SVG icons): polyline → red `#FF0000` (`invert(16%) sepia(89%) saturate(6011%) hue-rotate(358deg) brightness(105%) contrast(115%)`), polygon → goldenrod `#DAA520` (`invert(69%) sepia(76%) saturate(417%) hue-rotate(7deg) brightness(94%) contrast(92%)`), rectangle → limegreen `#32CD32` (`invert(67%) sepia(82%) saturate(350%) hue-rotate(72deg) brightness(87%) contrast(93%)`), circle → dodgerblue `#1E90FF` (`invert(38%) sepia(88%) saturate(2978%) hue-rotate(205deg) brightness(101%) contrast(104%)`), marker → blue (`invert(46%) sepia(86%) saturate(2331%) hue-rotate(193deg) brightness(105%) contrast(101%)`), delete → red (same as polyline). All prefixed `brightness(0) saturate(100%)`.
- Actions bar `.leaflet-pm-actions{background:rgba(15,32,39,0.9); blur 5px; border:1px solid rgba(0,255,255,0.3); radius 4px}`; `.leaflet-pm-action{color:#fff; bg transparent}` hover `rgba(100,223,247,0.3)`.
- Vertex handles: `.marker-icon` 15.75px (margin −7.875); `.marker-icon-middle` 7.5px; `.marker-icon.leaflet-pm-draggable{radius 50%; 9×9; margin −4.5; bg #fff; border 2px solid #00d4ff; shadow 0 2px 4px rgba(0,0,0,.2)}` hover `scale(1.2); bg #00d4ff; border #fff`; touch: cursor 15.75, draggable 10.5.
- Removal mode: container class `pm-removal-active` → custom red-X cursor SVG data-URI (28×28, circle fill `rgba(15,23,42,0.85)` stroke `#ff2222` w2, X lines w3) hotspot 14 14. On `pm:remove` a burst marker `.pm-delete-burst-icon` (32×32 same SVG, circle fill `rgba(15,23,42,0.9)` stroke 2.5) animates `deleteBurstAnim .6s cubic-bezier(.175,.885,.32,1.275)` (0.3→1.3→1.1→1.6 scale, fade) then removed at 600ms; removal mode auto-exits after 50ms.
- Measurement labels CSS (`.labelstyle,.distance-label,.area-label,.circle-label`): absolute `translate(-50%,-50%)`, `color:#fff; weight 600; nowrap; background:rgba(15,23,42,0.85); blur 4px; padding 1px 3px; border 1px solid rgba(255,255,255,0.15); radius 3px; pointer-events none; shadow 0 1px 2px rgba(0,0,0,.3); font-family -apple-system,…; text-shadow 0 1px 1px rgba(0,0,0,.8); line-height 1.1`; base `font-size 9px`; `[data-zoom=14|15]` 10px; `16|17` 11px; `18..22` 13px; mobile (≤768) 11px/pad 1px 4px, 12px/2px 5px, 14px/2px 6px. Containers `.area-label-container,.distance-label-container,.circle-label-container,.marker-label-container{overflow:visible}`.
- `.distance-label.karam-distance-label`: `padding 0 2px; radius 2px; border 1px solid rgba(255,255,255,.2); bg rgba(15,23,42,.8); font-size 8px; 600; shadow .25`; `[data-zoom=14|15]` 8px, `16|17` 9px, `18+` 10px.
- `.marker-label`: like distance label but `translate(-50%, 25px)`, `padding 2px 4px`, `pointer-events:auto; cursor:pointer; transition .1s`; hover `bg rgba(30,41,59,0.95); scale(1.05)`. Click copies "lat, lng" (5 dp) to clipboard and shows `.copy-notification` div "Coordinates copied to clipboard!" for 2s (no CSS defined for it).

### 2.10 Circular unit toggle (`GuidedDrawingMode.js` 572-610, css 292-375)
- Shown when native drawing started (`isNativeDrawing`) or drawings exist (`hasDrawings || map.drawnItems.getLayers().length>0`).
- `.circular-unit-toggle-container{absolute; bottom:350px; left:12px; z 1000; animation fadeIn .3s}` (repositioned by JS above the Geoman toolbar). `.circular-unit-toggle-btn{36×36; radius 50%; bg rgba(15,23,42,0.88); blur 16px; border 1.5px solid rgba(0,212,255,0.4); shadow 0 6px 20px rgba(0,0,0,.4), inset 0 1px 0 rgba(255,255,255,.2); transition .25s cubic-bezier(.34,1.56,.64,1)}`. States: `.imperial-active` `linear-gradient(135deg,#0f766e,#115e59)` border `rgba(45,212,191,.5)` shadow `0 4px 16px rgba(15,118,110,.45)`; `.metric-active` `#0284c7→#0369a1`, border `rgba(56,189,248,.6)`; `.meters-active` `#7c3aed→#6d28d9`, border `rgba(167,139,250,.6)`. Hover `scale(1.1); brightness(1.15); shadow 0 8px 24px rgba(0,0,0,.5), 0 0 12px rgba(56,189,248,.35)`; active `scale(.94)`. Label `.circular-unit-label{#fff; 13px; 800; ls .02em; uppercase; text-shadow 0 1px 2px rgba(0,0,0,.5)}`. Mobile 34px/12px.
- Cycle: imperial (`Ft`, title "Feet / Acres (Click for Km / Sq Km)") → metric (`Km`, "Km / Sq Km (Click for Meters / Sq Meters)") → meters (`m`, "Meters / Sq Meters (Click for Feet / Acres)"). Persisted `localStorage 'geo_unit_mode'` (default `'imperial'`). Button title `Current Units: {title}`.

### 2.11 Guided drawing overlay — see §6.4.
### 2.12 Guided ruler overlay — see §6.5.

### 2.13 DEAD components (specs for reference)
- **MapSidebar**: Offcanvas `placement="end" backdrop={false} scroll`, title "Map Layers & Settings"; radios Google Hybrid/Google Streets/Esri Satellite/OpenStreetMap (values `googleHybrid|googleStreets|esriSatellite|osm`); "Shajra Layer" switch label Visible/Hidden + `Form.Range 0..1 step .1` "Opacity: N%"; else "No Shajra available for this location.".
- **VectorTileToggle**: absolute top 10 right 10, z1000, `rgba(255,255,255,.9)`, padding 8px 12px, radius 4px, shadow 0 2px 4px rgba(0,0,0,.2), 12px, border 1px solid #ccc; checkbox "Vector Tiles" (+ "(Fallback)" grey 10px when unsupported); admin only.
- **ShapeTransformControls**: portal root z 10001; per-shape pill at bounds centre `.shape-transform-controls{translate(-50%,-50%); flex; gap 6px; padding 4px 6px; radius 24px; bg rgba(15,23,42,.9); blur 12px; border 1px solid rgba(255,255,255,.3); shadow 0 6px 18px rgba(0,0,0,.45),0 0 0 1px rgba(0,0,0,.3); popIn .2s}`; buttons 28px circles: move `#2563eb→#1d4ed8` (hover `#3b82f6→#2563eb`), rotate `#059669→#047857` (hover `#10b981→#059669`), 16px stroke icons; drag moves/rotates latlngs, fires `pm:edit`.
- **MapControlsPanel**: absolute top 80 left 16 (60/12 mobile), `rgba(10,15,32,.95)`, border rgba(255,255,255,.15), radius 12, padding 8, blur 12, z1000; buttons 40px (36) `rgba(255,255,255,.08)` border `.12` radius 8 color `#e4e7eb` 20px/300; hover `rgba(0,255,255,.15)` border `var(--primary-cyan)` scale 1.05 glow; `.active` gradient cyan/purple .2; divider 1px rgba(255,255,255,.1). Glyphs `+ − ⌂ ⛶`.
- **MapLegend**: absolute bottom 24 left 16, same dark card, min 200 max 300; header 12px 16px, title `.9rem 600 var(--primary-cyan) uppercase`; items 20px colour squares.
- **GeoJsonLoader** (old): pane `geoJsonMouzaPane` z450; style `fillColor #000; fillOpacity .01; color #ff0c04; weight by zoom (1/1.5/2/2.5/3.5)`; tooltip blink 3s @300ms; flyToBounds `{duration 1.5, easeLinearity .5, padding 40, maxZoom 17}`.
- **GeoJsonInteractionLayer**: invisible layer `color #000 weight 10 opacity .001 fillOpacity 0` → `handleMurabbaClick`.

---

## 3. Base layers (`LayerControl.js`) — all `minZoom:5`, `maxZoom:currentMaxZoom` unless noted; no attribution (attributionControl false)
| Name (option label & value) | URL template | extra |
|---|---|---|
| **Google Hybrid Satellite** (DEFAULT, `useState('Google Hybrid Satellite')` in App) | `https://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}` | subdomains mt0-mt3 |
| Google Satellite | `…lyrs=s…` | mt0-mt3 |
| Google Streets | `…lyrs=m…` | mt0-mt3 |
| Google Terrain | `…lyrs=p…` | mt0-mt3 |
| Esri World Imagery | `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}` | |
| Esri World Topo | `…/World_Topo_Map/MapServer/tile/{z}/{y}/{x}` | |
| Esri World Streets | `…/World_Street_Map/MapServer/tile/{z}/{y}/{x}` | |
| Carto Light (Positron) | `https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png` | a-d |
| Carto Dark (Dark Matter) | `https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png` | a-d |
| OpenStreetMap (Standard) | `https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png` | |
| OpenTopoMap | `https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png` | maxZoom 17 |
Note: the `layers` object is rebuilt every render (new `L.tileLayer` instances each time) — harmless but wasteful. State lives in App (`baseLayer/setBaseLayer`), also used by tours.

**Shajra raster overlay** (MapComponent 1269-1491, `dataMode==='shajra'`): `L.tileLayer('',{opacity:shajraOpacity(1), maxNativeZoom:20, maxZoom:21, tileSize:256, zIndex:10})` with custom `createTile` fetching `${REACT_APP_API_URL||'http://localhost:5000'}/api/shajra-tiles/{tehsil}/{mauza}/{z}/{x}/{y}.png` with `credentials:'include'`, `Accept:image/png`; 401/403 → error; 404 → 1×1 transparent canvas, and after **8 consecutive 404s** switches `dataMode` to `'geojson-db'`; successful blobs cached in IndexedDB `rasterDB/tiles` key `shajra-{tehsil}-{mauza}-{z}-{x}-{y}` (via `idb` `openDB`). Fit to `shajraMeta.bounds` once (string "w,s,e,n" or `{topLeft,topRight,bottomRight,bottomLeft}`). Label geojson `${base}/Shajra Parcha/{tehsil}/{mauza}.geojson?t=` → murabba dropdown + fit to point extents; dropdown select flies to point `min(18,maxZoom)` `{duration 1.2, easeLinearity .5}` and calls `loadMurabbaPMTiles(..., isFallbackMode, false, true)`. (`shajraVisible/opacity` setters are never exposed in the current UI; `showClearCacheOption` never set.)

---

## 4. Data pipeline

### 4.1 Hierarchy & owners
- Tehsil: `user.activeTehsil` (Header dropdown). Changing tehsil → `map.setView([30,71],5,{animate:true})` and clears drawings/labels/killa selection.
- Mouza (`selectedMauza`, Header). On change App fetches `${API}/Metadata/{tehsil}/{mouza}.json` → `shiftResult {mouza, tehsil, geojson:'{tehsil}/{mouza}.json', murabbaSummary: payload.murabbas}`; MapComponent then fetches `${API}/Shajra Parcha/{tehsil}/{mouza}.json?t=` (`cache:no-store`, credentials) — JSON OK ⇒ `dataMode='shajra'` else `'geojson-db'`.
- App also fetches `GET ${API}/api/geo/adjustment/{tehsil}/{mouza}` (withCredentials) → `pmtilesOffset {lat,lng}` on every mouza change.
- Murabba (`selectedMurabba`, Header dropdown or map click); options set via `setMurabbaOptions` (array of strings, or `{value,label,centroid}` objects in PMTiles path).
- Killa: rendered from complete PMTiles / murabba GeoJSON; click → highlight + karam labels + AKM area box.

### 4.2 `dataMode==='geojson-db'` → `<VectorTileLoader>` main effect (keyed `${tehsil}/${mouza}/${resetFlag}/${adminMapMode}`)
1. `cleanupAllLayers()` (removes tooltips, layers, `map.off('mousemove')`, `map.off('click')`, nukes `map._renderer`), `map.invalidateSize()`, wait 100ms.
2. **Mobile/forced-geojson** → `useGeoJsonLayer.loadGeoJsonFallback()`:
   - fetch `${apiBase}/JSON Murabba/{tehsil}/{mouza}.geojson?t=` (apiBase = '' on localhost so CRA proxy sends cookie; else `REACT_APP_API_URL`), `credentials:'include', cache:'no-store'`; fallback `${apiBase}/api/geojson/{tehsil}/{mouza}?t=`.
   - `normalizeKillaBandi()`; after 350ms create `L.geoJSON` in `fallbackGeoJsonPane` (z550) with own `L.svg` renderer; styles §5.3; `onEachFeature` hover-prefetch murabba file, click → killa highlight (if `Killa`) / `focusPoint(center,{zoom:17})` + `loadMurabbaPMTiles(...,isFallbackMode,false,true)` + `onSelect`; `programmaticSelect` event loads murabba.
   - `flyToBounds(bounds,{duration:4, easeLinearity:.25, padding:[20,20]})` unless already inside (zoom≥14 & center inside) or a murabba is selected.
   - `bindMurabbaTooltip` / `bindKillaTooltip` per feature; murabba options sorted `byPlotNumber`; `onLayerReady(layer)`.
   - Failure with `adminMapMode==='geojson'` → `onError("GeoJSON mode active — data unavailable…")` and stop; else fall through to PMTiles.
3. **Desktop** → `getSignedPMTilesUrl(tehsil,mouza)` then `loadVectorTiles()`; on throw retry with `/pmtiles/{tehsil}/{mouza}.pmtiles`; if both fail → `onFallbackMode(true)` + `loadGeoJsonFallback()`.
4. `onLoadingChange(false)` in finally; `isLoadingRef` cleared after 500ms.

### 4.3 `loadVectorTiles` (PMTiles mouza layer)
- `new PMTiles(url)`; `getHeader()` → bounds `[[minLat,minLon],[maxLat,maxLon]]`.
- Background: `extractMurabbaNumbersFromPMTiles(pmtiles, header, onExtractionProgress, tehsil, mouza)` (tileDecoder): order = localStorage `murabba_list_{tehsil}_{mouza}` (24h, empty list rejected) → `fetchMurabbaJson` (mouzaApi: `/Metadata/{tehsil}/{mouza}-Murabba.json` local → `REACT_APP_METADATA_BASE_URL` → `{mouza}-Metadata.json` consolidated → killa-bandi derivation) → signed `{mouza}-Murabba.json` from worker → PMTiles metadata (`description` JSON `murabba_list`, legacy `murabba_numbers`/`murabbas`) → tile scan at zooms [15,16,14,mid,min(,max≤18)] in parallel batches of 10 with progress callbacks, centroids stored in `window.scannedMurabbaCentroids`. Then `getMurabbaCentroidsFromMetadata` → `setMurabbaOptions([{value,label,centroid}])`, then `buildMurabbaBoundsMap(...)` (tooltipBuilder) creates permanent murabba tooltips (cached in `mouzaCache` LRU(15), 5 min).
- `VectorTileLayer = L.GridLayer.extend` canvas renderer: `tileSize 256, minZoom 10, maxZoom 22, maxNativeZoom header.maxZoom||18, pane 'mouzaPMTilesPane', zIndex 610, bounds`. Overzoom: request `min(z,maxNative)` tile and divide line width by `2^(z-maxNative)`. Draws every layer; style §5.2.
- Map `click` handler (only `zoom>=10`, not drawing): decode tile at click, ray-cast point-in-polygon for `Murabba_No` → `onSelect`, `focusPoint(center,{zoom:17})`, `loadMurabbaPMTiles(..., skipZoom=true)`, then `afterMove` → `highlightMurabbaTooltip` + `loadCompletePMTiles`.
- Add layer after 200ms; if not already inside mouza (zoom≥14 & center within) → `flyToBounds(mouzaBounds,{duration: 0.6|1.2|2.2|3.5 by distance <200m(&zoomDiff≤1)/<1km/<5km/else, easeLinearity .25, padding [20,20]})`. Ensures `murabbaPane` z630 / `murabbaTooltipPane` z640 and brings mustateel layers to front (immediately + 150ms).
- `onLayerReady(vectorTileLayer)`.
- `zoomend`: zoom≥16 & not loaded → `loadCompletePMTiles`; zoom<16 → remove complete layer + killa tooltips, reset flags.

### 4.4 `loadCompletePMTiles` (usePMTilesLoader) — killa boundaries
- Skipped if `map._geojsonModeActive`, already loaded, fallback layer active, or loading.
- URL `getSignedPMTilesUrl(tehsil,mouza,null,'{mouza}-complete.pmtiles')`; header failure → try `/pmtiles/{tehsil}/{mouza}-complete.pmtiles`; if still failing and base layer exists → abort, else `loadFallbackGeoJSONs`.
- `killaData = fetchKillaJson` (`/Metadata/{tehsil}/{mouza}-Killa.json` local → remote → consolidated `-Metadata.json`/`.json` → `[{Killa, Murabba_No, centroid:[lng,lat]}]`).
- `isDenseMode = killaData.length>500`; PMTiles layer shown at zoom ≥15 (`minZoom 15, maxZoom 22, maxNativeZoom min(header.maxZoom||20,22)`, pane `completePMTilesPane`); tooltips at zoom ≥ (dense?17:16).
- After add: `reloadMouzaPMTilesLayers` (removes & reloads each loaded murabba layer so it renders on top), `map.on('click', handleKillaClick)`.
- Duplicate-label heuristic: sample 50 killas vs murabba list; `overlap>0.7 && density<2.0` ⇒ skip killa tooltips ("Kamoke style").
- Killa tooltips: spatial grid density (cell 0.0005°) → classes `--extremely-dense` (>25), `--very-dense` (>15), `--medium-dense` (>8); zoom classes `--zoom-low` (≤16) `--zoom-medium` (17) `--zoom-high` (≥18); `L.tooltip({permanent, direction:'center', className:'killa-tooltip'+…, opacity:.9, offset:[0,0], pane:'killaTooltipPane'})`; all tooltips removed on `movestart` and re-evaluated on `moveend/zoomend` (viewport-filtered when dense); click on tooltip el → `handleKillaClick({latlng})`.
- No killa JSON → scan complete tiles at `min(maxZoom,16)` and build tooltips from polygon centres (visible ≥16).

### 4.5 `loadMurabbaPMTiles(murabbaNo, tehsil, mouza, map, mustateelLayers, preferGeoJson, testMode, skipZoom)` — selected-murabba detail
- Killa-bandi mouza → just focus the plot (`padding [40,40], maxZoom 19`).
- Dedup via `loadingMurabbas` Set and `mustateelLayers.current.find(l=>l.murabbaNo===murabbaNo)` (existing → refocus `{padding [30,30], maxZoom 18}` unless skipZoom/pmtiles layer).
- `shouldPreferGeoJson = preferGeoJson || isMobile(adminMapMode-adjusted)` → `loadGeoJSONFallback`: `getMurabbaGeoJson` cached promise map (max 300) for `${apiBase}/JSON Murabba/{tehsil}/{mouza}/{safeMurabba}.geojson` (safeMurabba: `/`→`-`, `[\\:*?"<>|]`→`_`); single-feature no-killa files skip layer creation (just focus). Layer in `murabbaPane` (z630) with dedicated `L.svg`; style §5.4; killa tooltips `L.tooltip({permanent, direction center, className 'killa-tooltip killa-tooltip--zoom-medium'+fraction+density, pane 'killaTooltipPane'})` bound to each feature, hidden <16, zoom classes updated on `zoomend` (+200ms initial); layer itself removed <16 and re-added ≥16 (`_zoomHandler`); density class by approx area (`<2500m²` very-compact, `>5500` none, else compact; lat×110800, lng×96500); killa click → highlight (§5.6).
- Else PMTiles path: `new PMTiles(getSignedPMTilesUrl(tehsil,mouza))` gridLayer in `murabbaPane` (`minZoom 10, maxZoom 22, maxNativeZoom min(header.maxZoom||20,22)`) whose `createTile` only collects features with `Murabba==murabbaNo` (draws nothing); redraw when crossing zoom 15; after 100ms creates instant killa labels from `localStorage metadata_{tehsil}_{mouza}` (24h) or `${REACT_APP_METADATA_BASE_URL||API/Metadata}/{tehsil}/{mouza}-Metadata.json` → `murabbas[murabbaNo].killa_centroids` as `L.circleMarker(radius 0)` + tooltip `className 'killa-label', opacity .9` in `murabbaPane` (skipped if complete tooltips active). Focus bounds `{padding [30,30], maxZoom 18}` (testMode: `fitBounds animate:false`).
- Catch: if preferGeoJson → GeoJSON fallback → else **template grid**: find murabba feature on map, `transformGeoJsonWithTurf(MustateelGeojson, TL,TR,BR,BL)` (5×5 grid of 25 killas numbered 1-5,10-6,11-15,20-16,21-25 boustrophedon) rendered `{color '#FFFF00', weight 2, fillOpacity .01, dashArray '5, 5', fill true, fillColor '#FFFF00'}` in `murabbaPane` with `bindKillaTooltip`.

### 4.6 Selection effects
- `VectorTileLoader` effect on `selectedMurabba` (300ms delay) → `applyMurabbaSelection` (tooltipBuilder 405-530): load murabba detail (skipZoom), centroid from `fetchMurabbaJson` (`[lng,lat]`→`[lat,lng]`) or `window.scannedMurabbaCentroids`; `loadCompletePMTiles`; if not `wasClickSelection(map,1500ms)` → `focusPoint(centroid,{zoom:17,onSettled:highlight})`; fires `programmaticSelect` on interaction layer; without centroid → `focusBounds(layer bounds,{padding [30,30], maxZoom 18})`.
- `highlightMurabbaTooltip` (useTooltipHighlight): removes previous displacement; sets offset `L.point(0, zoom>=16 ? -min(4, round(1.875*1.5^(zoom-16))) : -1.75)`, adds `.murabba-tooltip--selected-displaced`; blinks `.tooltip-selected` on/off every 600ms for 1.5s (skipped if same murabba); waits for `moveend` if animating; retries 5×120ms.

### 4.7 Signed URL / secure fetch (`config/pmtiles.js`, `securePMTilesProtocol.js`)
- `getSignedPMTilesUrl(tehsil,mouza,murabba?,filename?)`: `POST ${API}/api/pmtiles/signed-url {tehsil,mouza,murabba,filename}` (axios, no withCredentials) → `{url, expiresAt}`; cached in `signedUrlCache` Map keyed `tehsil/filename | tehsil/mouza/murabba | tehsil/mouza`, reused while `expiresAt > now+240s`; on error returns expired cached URL or throws; any failure → frontend static `/pmtiles/{tehsil}/{filename}` | `/pmtiles/{tehsil}/{mouza}/{murabba}.pmtiles` | `/pmtiles/{tehsil}/{mouza}.pmtiles`. `getBatchSignedUrls` → `POST /api/pmtiles/signed-urls {files:[...]}` (unused by map). `REACT_APP_PMTILES_MODE` ('local'|'cloudflare'), `REACT_APP_CLOUDFLARE_WORKER_URL`, listing fallback `https://pmtiles-worker.mallhintdr.workers.dev`.
- `setupSecurePMTilesFetch()` **monkey-patches `window.fetch`**: any string URL containing `.pmtiles` gets `credentials:'include'` (auth is httpOnly cookie `authToken`). Called at module load of VectorTileLoader and loadMurabbaPMTiles (patch applied twice; idempotent in effect). `createSecurePMTiles` (range-fetch source) exists but unused.
- `config/pmtiles-simple.js` (unused): direct worker URLs, 15-min cache, HEAD test with 3s timeout & 2 retries, 30s worker-unavailable backoff.

### 4.8 Caches
- `utils/lruCache.js` LRUCache(maxSize=20 default; VectorTileLoader uses 15) Map-based, get refreshes order, set evicts oldest.
- `mouzaCache` (tooltip data per `tehsil/mouza`, 5 min); `murabbaGeoJsonCache` (promise per URL, max 300); `signedUrlCache`; `mouzaApi` `murabbaCache/killaCache` (per session); localStorage `murabba_list_*`, `metadata_*` (+`_timestamp`, 24h), `admin_map_mode`, `geo_unit_mode`, `geo_device_id`; IndexedDB `rasterDB.tiles` (shajra PNGs). "SharedCache" does not exist in this slice.
- `cacheBuster = useMemo(Date.now, [selectedMauza])` appended as `?t=` to Shajra meta/geojson.

### 4.9 Offset / shift (`pmtilesOffset`, ShiftMouzaForm, App.js 190-207)
- `pmtilesOffset {lat,lng}` (degrees). MapComponent effect (466-531) on `[pmtilesOffset, mapKey]`: computes pixel delta between `map.getCenter()` and `center+offset` at current zoom and sets `pane.style.left/top = tx/ty px` (transform cleared, `transition:none`, `position:absolute`, `pointer-events:auto`) on panes `mouzaPMTilesPane, completePMTilesPane, murabbaPane, killaTooltipPane, murabbaTooltipPane, fallbackGeoJsonPane, overlayPane`; zero offset resets to 0px. Re-applied on `zoomend viewreset layeradd resize` only (not during zoom/move, so Leaflet CSS scaling stays smooth).
- Shift API: `GET/POST/DELETE ${API}/api/geo/adjustment/{tehsil}/{mouza}` (`withCredentials`), payload/response `{latOffset, lngOffset}`. Feet→deg: `1/364000` lat, `1/315000` lng.
- `shiftResult` effect (707-766): when a `geoJsonLayerInstance` exists and `shiftResult.geojson` is a FeatureCollection → clear+addData, rebuild murabba options, remove mustateel layers, re-fire `programmaticSelect`, restore view (now + 0ms + 300ms), then `onShiftResultApplied()`. (App currently sets `geojson` to a string path, so `addData` throws → effect just calls `onShiftResultApplied` — effectively a no-op.)

### 4.10 Shajra toggle
`dataMode` decides: `'shajra'` ⇒ raster tiles + label geojson; `'geojson-db'` ⇒ VectorTileLoader. `shajraVisible` is set true automatically when metadata exists; NavigationMenu's `toggleShajraVisible` toggles App-level `shajraVisible` which is passed to MapComponent as a prop but **not consumed** (MapComponent has its own internal state) — so the menu toggle only clears cached tiles. `shajraOpacity` fixed 1.

---

## 5. Feature styling

### 5.1 `tileStyles.js` MAP_STYLES
```
murabba.vector  {fill transparent/0, stroke '#FF0000', width 3, opacity 1}
murabba.geojson {color '#FFD700', weight 3, fillOpacity 0, opacity 1, fillColor 'transparent'}
musteel.vector  {stroke '#FFFF00', width 2, dasharray [5,5]}
musteel.geojson {color '#FFFF00', weight 2, fillOpacity 0, dashArray '5, 5', fillColor '#FFFF00'}
selected.*      {color '#FF0000', weight 3, fillOpacity 0.3, fillColor '#FF0000'}
merged.vector   {stroke '#FF0000', width 2}
merged.geojson  {color '#FF0000', weight 2, fillOpacity 0, fillColor 'transparent'}
TOOLTIP_STYLES murabba/killa {className 'murabba-tooltip'|'killa-tooltip', permanent, direction 'center', opacity 1}
getDenseStyle: zoom<12 || featureCount>800 → 'murabba-tooltip--dense'
applyVectorStyle/applyGeoJsonStyle: weight * clamp(zoom/15, 0.5, 2)   (unused)
```
MapComponent also passes `style={{merged:{color:'#97e702',weight:2,fillOpacity:.1}, murabba:{color:'#FFD700',weight:2,fillOpacity:.01}}}` to VectorTileLoader — **unused** (prop ignored).

### 5.2 Mouza PMTiles canvas (VectorTileLoader `_drawLayer`)
- Layer `musteel|mustateel` or featureType musteel → `MAP_STYLES.musteel.vector` stroke `#FFFF00` (dash array NOT applied on canvas); everything else → murabba stroke `#FF0000`; fill transparent (`rgba(0,0,0,0)`), polygons `closePath; fill; stroke`.
- Line width by tile zoom: `z≤14:1.0, 15:1.5, 16:2.0, 17:2.5, ≥18:3.5` ÷ overzoom scale.

### 5.3 Mouza GeoJSON (useGeoJsonLayer)
- `isMurabbaBoundary = layer_type==='murabba' || type==='murabba_boundary'` → `murabba.geojson` (gold `#FFD700`) else `merged.geojson` (red `#FF0000`); `fill:true; fillOpacity: base>0 ? base : 0.01; fillColor: base.fillColor!=='transparent' ? it : (color||'#FFD700')`; weight by zoom `≤14:1, 15:1.5, 16:2, 17:2.5, else 3.5` (updated on `zoomend`).

### 5.4 Killa boundaries (complete PMTiles canvas / murabba GeoJSON / fallback GeoJSON) — identical rule
- stroke `#FFD700`; width `z≤15:0.75, 16:1.0, 17:1.25, ≥18:1.75` (÷ overzoom); dash `z≤15:[2,8], 16:[2,6], 17:[2,4], else [2,3]` (SVG string `'2, 8'` etc.); GeoJSON variants `opacity 1, fill true, fillColor '#FFD700', fillOpacity 0.001`.

### 5.5 Label CSS (`css/GeoJsonLoader.css`)
- `.murabba-tooltip`: `pointer-events:none; background transparent; border none; shadow none; color #97e702; font-size 16px; bold; text-shadow 1px 1px 2px #000, -1px -1px 2px #0b0b0b, 1px -1px 2px #050505, -1px 1px 2px #070707` (all !important). `--dense` 14px; `--zoom-low` 9px; `--zoom-medium` 11px; `--zoom-high` 15px; `--very-dense` 10px; `--medium-dense` 12px; `--compact` 11px (area <30,000 m²). `--selected-displaced`: 16px, color `#a3ff00`, text-shadow `0 0 4px #000, 1px 1px 2px #000, -1px -1px 2px #000`, z 700, `transition transform .15s`. Class `clickable-tooltip` is added but has no CSS (pointer-events:none on `.murabba-tooltip`… but tooltips are created `interactive:true` so Leaflet adds `leaflet-interactive`; click handlers are attached to the element directly).
- `.killa-tooltip, .killa-label`: same but color `#FFD700`, 11px. `--compact` 10px; `--very-compact` 8.5px ls −.5px; `--extremely-dense` 7.5px ls −.5 shadow `1px 1px 1px #000`; `--very-dense` 8.5px; `--medium-dense` 9.5px; `--zoom-low` 9px; `--zoom-medium` 11px; `--zoom-high` 13px; `.killa-tooltip-fraction` 85%.
- Tooltip pointer triangles removed (`.leaflet-tooltip-*:before{border:none}`). `.label-small/medium/large` 10/12/16px (unused).
- Tooltip visibility rules: murabba ≥ zoom 15 and ≤400 visible in viewport (bindTooltips `MAX_VISIBLE_TOOLTIPS=400`, debounce 100ms; tooltipBuilder dense mode >400 → 120ms debounce); zoom classes `≤14 low, 15 medium, ≥18 high`; density (tooltipBuilder, cell 0.001°): `>10 very-dense, >5 medium-dense`. Killa (bindTooltips) ≥16, debounce 120ms; density by area `<2500 very-compact, ≤5500 compact`.
- bindTooltips computes a **visual centre** (pole-of-inaccessibility, 3-level 20×20 grid search on the largest ring) and monkey-patches `layer.getCenter`/`getBounds().getCenter` so labels sit inside irregular parcels.

### 5.6 Killa interaction
- Click (PMTiles: `useKillaInteraction.handleKillaClick` on map click at z16 tile; GeoJSON: layer click / `bindKillaTooltip._karamKillaClickHandler`): toggle key `${murabba}_${killa}` (`_geojson` suffix for geojson) — second click clears. Fetch 3×3 tiles, union fragments with turf (`buffer 1e-6 km`, `union`, `simplify tol 5e-6 highQuality`), pick ring containing click.
- Highlight polygon: `{color '#10B981', weight 3, dashArray '5, 5', fillColor '#10B981', fillOpacity 0.25, pane 'murabbaPane'}` stored in `map._activeKillaHighlight`.
- `showKaramSegmentLengths`: dedupe (<0.05 m), 3 passes dropping vertices with `dot>0.96` (<16°) or segment <0.5 m; per side label `round(feet/5.5)` karams (skip 0) as `.distance-label.karam-distance-label`; area = `turf.area(layer.toGeoJSON())` (fallback geodesicArea) × 10.7639 → `formatAKMArea` → box "Killa Area" (§2.5). Cleared by `clearActiveKillaSelection(map)` (also on any map click not flagged `_killaHandled`, mouza/tehsil change, complete-PMTiles load, draw start via `onMapClick` guard `!map._isDrawing`).
- `killaMeasurement` prop (menu toggle) is passed through to VectorTileLoader/useKillaInteraction but is **not read** anywhere (hook ignores it) — killa measurements are always on.
- `e.originalEvent._killaHandled=true` and `map._featureDblClicked=true` flags suppress global clear / custom dblclick zoom.

### 5.7 Measurement units & formulas (`measurementUtils.js`, `DrawControl.js`)
- `formatDistanceLabel(m, mode)`: metric → `≥1000: (m/1000).toFixed(2)+' km'`, `≥100: toFixed(3)+' km'`, else `m.toFixed(1)+' m'`; meters → `m.toFixed(2)+' m'`; imperial → `(m*3.28084).toFixed(2)+' Ft'`.
- `formatAreaCustomUnits(sqft, mode, m2)`: metric → `Area: {km².toFixed(3)} km²` (≥0.01), `toFixed(4)` (≥0.0001), else `m².toFixed(1) m²`; meters → `Area: {m².toFixed(2)} m²`; imperial → `Area: ` + `formatAKMArea`.
- `formatAKMArea(sqft)`: marla = 272.25 sqft; `totalMarlas=round(sqft/272.25)`; acres=floor(/160); kanals=floor(rem/20); marlas=rem%20; parts `${acres}A` (if >0), `${kanals}K` (if kanals>0||acres>0), `${marlas}M` joined `' - '` e.g. `1A - 2K - 5M`.
- Karam = 5.5 ft. Area: `L.GeometryUtil.geodesicArea` polyfill (R=6378137 spherical excess formula) ×10.7639 sqft; circle `π r²`.
- Guide line while drawing: live label `${feet.toFixed(2)} Ft` (always feet) at midpoint of last vertex→cursor.
- `utils/akar.js`: `AKAR_MESSAGE='AKAR chaks can only be assigned by the admin. Please contact the admin for access.'`, `isAkarTehsil(name)` (== 'akar-cholistan'), `withoutAkar(list)` — tehsil filter, not measurement.

---

## 6. Drawing tools

### 6.1 Tools & draw styles (DrawControl 307-346, 438-445)
| Shape | color | weight | fillOpacity | templine | hintline |
|---|---|---|---|---|---|
| Line | `#FF0000` | 2 | 0 | same | `dashArray [5,5]` |
| Polygon | `#FFD700` | 2 | 0.3 | | dashed |
| Rectangle | `#32CD32` | 2 | 0.3 | | dashed |
| Circle | `#00FFFF` | 2 | 0.3 | | dashed |
| Marker | Leaflet default blue icon (`marker-icon.png` etc. via mergeOptions) | | | | |
Loaded user layers use polyline red `#FF0000` w2, polygon/multipolygon `#FFD700` w2 fill .3, points default marker.

### 6.2 Draw-time behaviour
- `pm:drawstart`: `map.doubleClickZoom.disable(); map._isDrawing=true;` inject style `#leaflet-draw-passthrough-style` making data panes (`completePMTilesPane, mouzaPMTilesPane, fallbackGeoJsonPane, murabbaPane, murabbaTooltipPane, killaTooltipPane`) `pointer-events:none; cursor:crosshair` (also inline on children with dataset backup); orphan label cleanup; set workingLayer style; listen `pm:change pm:vertexadded pm:vertexremoved` → live measurements + `lastVertexLatLng`.
- Line: self-snap to own vertices within 20px; clicking first vertex (≥3 pts) closes it (`closeNextLineRef`), and on create `closeLineIfNearStart` (≤20px) closes the ring and sets `fill:true, fillOpacity:0.08`; closed lines show area like polygons.
- Rectangle/Circle: drag-to-draw — `map.dragging.disable()`, mousedown fires synthetic click (10ms), mouseup >5px fires second click.
- `pm:drawend`: re-enable dblclick/drag, `_isDrawing=false` after 300ms if no draw mode, remove passthrough.
- `pm:create`: `clickTolerance 15`, add to `drawnItems` FeatureGroup (`map.drawnItems`), bind edit events, `handleFeatureComplete`, `onDrawnChange(drawnItems.toGeoJSON())`, 300ms cool-off `_isDrawing`.
- Edit mode (`pm:globaleditmodetoggled`): passthrough + `isolateDrawnItemsFromGeoman` (sets `pmIgnore=true` and `pm.disable()` on every non-drawn, non-`_pmTempLayer` layer), shows labels for all shapes incl. hidden ones; real-time updates on `pm:change|edit|vertexadded|vertexremoved|markerdrag|drag|snap`; `pm:dragstart/markerdragstart` un-hides labels.
- Rotate mode: Geoman prototype safeguards (`handleLayerAdditionInGlobalRotateMode`, `Edit.Poly.enableRotate` guard for layers without `getLatLngs`); on `pm:rotateenable` each rotation vertex marker disables `map.dragging` on `dragstart` and re-enables on `dragend`; `pm:rotateend` refreshes labels.
- Removal mode: class `pm-removal-active`, burst animation, auto-exit after 50ms.
- Area box: one at a time (`areaBoxRef`), `drawn-area-info-box` class; ✕ hides labels of ALL non-marker drawn shapes (`hiddenLayersRef` WeakSet) and clicking inside a shape (manual hit-test on map container click capture: circle by radius, polygon/rectangle/closed line by ray cast, last hit wins) shows them again.
- Labels per shape: polyline → segment lengths; polygon/rectangle → area box (title "Area"/"Rectangle Area") + segment lengths (+closing side); circle → box "Circle Area" with `${area}<br><small>Radius: ${r}</small>`; marker → coordinate label (copy on click). Labels are `L.marker` divIcons `interactive:false, pmIgnore, snapIgnore`, reused during real-time drags when count matches.
- Unit change re-renders all labels instantly.
- Cleanup on unmount: all `map.off(...)` including **`map.off('mousemove')` with no handler** (nukes other mousemove listeners), `map.pm.removeControls()`, remove drawnItems.

### 6.3 Save / load layers (`hooks/useUserLayers.js`, NavigationMenu)
- `GET ${API}/api/user-layers` (withCredentials) on login → `userLayers`.
- Save: `handleSaveLayerClick` (needs `drawnLayerData`) opens modal with default name `Layer {n+1}`; submit: name-exists → `window.confirm('A layer named "…" already exists. Do you want to overwrite it?')` → `PUT /api/user-layers/{_id}` else `POST /api/user-layers` body `{name, geojson}`; error alert `err.response.data.message || 'Failed to save layer.'`.
- Load: `setUserLayerToLoad(layer.geojson)` → MapComponent effect (610-695): clears drawnItems & labels, rebuilds Leaflet layers from Feature/FeatureCollection (Point→marker, LineString/MultiLineString→polyline red, Polygon→`L.polygon` (flat ring when no holes) gold, MultiPolygon→polygon), `addMeasurementLabels`, `onDrawnChange`, `fitBounds`. Reset to null on mouza change.
- Delete: `window.confirm('Delete layer "name"?')` → `DELETE /api/user-layers/{_id}`.
- Export: **none active**. `leaflet-simple-map-screenshoter` is imported but the control is explicitly not created ("Screenshot capture button disabled", MapComponent 1039-1091). No KMZ/KML export exists. `html2canvas`/`jspdf` are not used on this page.

### 6.4 Guided drawing mode (mobile crosshair) — `GuidedDrawingMode.js/.css`
- Trigger: see §1.5; disables Geoman draw (`map.pm.disableDraw()` at 10ms and 150ms), `invalidateSize`, sets `activeShape`, points=[], centre=`crosshairLatLng()` (centre of the crosshair dot via `map.mouseEventToLatLng`), adds container class `guided-drawing-active` (hides Geoman cursor marker), dispatches window `guidedRulerUpdate {active, shape}`.
- Overlay `.guided-drawing-overlay` (z15000, pointer-events none, flex centre) containing: `.guided-ruler-h` (1.2px tall, `repeating-linear-gradient(90deg,#fff 0 4px, transparent 4px 8px)`, masked to fade at edges with a 22px gap at centre, `drop-shadow(0 0 1px rgba(0,0,0,.95))`), `.guided-ruler-v` (same vertical), `.guided-crosshair` SVG 48×48 (viewBox 40): halo circle r7 + 4 ticks stroke `rgba(0,0,0,.55)` w2.5, white ring r7 + ticks w1.2, centre dot r1.5 `#fff` stroke `rgba(0,0,0,.6)` w.6.
- Preview layers: polygon `#FFD700 w2 fill .3`, line `#FF0000 w2`, rectangle `#32CD32`, circle `#00FFFF`; dashed guide line `dashArray '5, 5'` colour red for Line else gold, from last point to centre. Live labels: `.distance-label` per segment (+closing side & area label at polylabel centre for polygon ≥3; rectangle 4 sides + area at centre; circle radius line + area at centre). Updates on `move/moveend`, `mousemove/pm:snap/pm:unsnap` re-pins Geoman hint marker to crosshair (rAF), resize/orientationchange/ResizeObserver resync.
- Toolbar `.guided-controls-container` (absolute `bottom:30px; left:50%; translateX(-50%); gap 16px; max-width 90%; z15001`; ≤768: `bottom:calc(env(safe-area-inset-bottom,0px)+56px)`, gap 12, max 96%; ≤480: +60px) → `.guided-toolbar{flex; gap 10px; background rgba(15,23,42,.85); padding 6px 14px; radius 50px; shadow 0 12px 36px rgba(0,0,0,.65), inset 0 1px 0 rgba(255,255,255,.18), inset 0 -1px 0 rgba(0,0,0,.4); blur 24px; border 1px solid rgba(255,255,255,.14)}` (mobile padding 5px 12px gap 9).
- Buttons `.guided-btn` 36×36 circles (35 mobile), icons 75% (react-icons/tb, stroke 2.2), `::before` inset highlight `inset 0 1.5px 3px rgba(255,255,255,.3)`, hover `scale(1.1)`, active `.95`, disabled `opacity .35; cursor not-allowed`:
  - `.btn-undo` TbArrowBackUp: `linear-gradient(135deg,#334155,#1e293b)`, border `rgba(245,158,11,.4)`, shadow `0 4px 14px rgba(0,0,0,.35)`, color `#fbbf24`; hover `#475569→#334155`, border `rgba(251,191,36,.8)`, shadow `0 6px 18px rgba(245,158,11,.35)`, color `#fde047`. Disabled when no points.
  - `.btn-add` TbPlus (42×42, 40 mobile): `#2563eb→#1d4ed8`, border `2px solid rgba(255,255,255,.3)`, shadow `0 4px 18px rgba(37,99,235,.6)`, `animation pulseGlow 2.5s infinite` (ring to 14px `rgba(59,130,246,.45→0)`); hover `#3b82f6→#2563eb`, `scale(1.12)`; stroke 2.6. Title "Add Point".
  - `.btn-finish` TbCheck: `#059669→#047857`, border `rgba(52,211,153,.4)`, shadow `0 4px 14px rgba(16,185,129,.4)`, color `#ecfdf5`; hover `#10b981→#059669`. Disabled until min points (Polygon 3, Line 2, Rectangle 2, Circle 2, Marker 1).
  - `.btn-cancel` TbX: `#dc2626→#b91c1c`, border `rgba(248,113,113,.4)`, shadow `0 4px 14px rgba(239,68,68,.4)`, color `#fef2f2`; hover `#ef4444→#dc2626`.
  - `.btn-unit-toggle` text (`.unit-btn-text` 12.5px 800 uppercase): `#0f766e→#115e59` border `rgba(45,212,191,.45)` color `#ccfbf1`; `.metric-active` `#0284c7→#0369a1`; `.meters-active` `#7c3aed→#6d28d9`; hover brightness 1.15 scale 1.08.
- Flow: Add Point appends centre; Marker finishes immediately; Rectangle/Circle finish at 2 points; Finish builds the Leaflet layer (same styles as §6.1) and `map.fire('pm:create',{layer, shape})` so DrawControl handles it; Cancel clears. `alert('Need more points to create a {shape}')` if insufficient.
- Unused CSS: `.guided-metrics-badge/.metric-*` HUD (dark pill, area `#fbbf24`) — `getMetrics()` computed but not rendered.

### 6.5 Guided ruler overlay (desktop) — `GuidedRulerOverlay.js/.css`
- Portal `<svg class="guided-ruler-overlay-container">` (absolute inset 0, z14000, pointer-events none) rendered only when native drawing (Line/Polygon/Rectangle) or edit mode active and NOT guided (guided draws its own lines). Position = cursor (container mousemove/pointermove, `+0.5px`), or while editing the dragged vertex / nearest vertex within 40px.
- Four dotted lines (`.guided-ruler-line{stroke #fff; width 1.2px; dasharray 4 4; drop-shadow(0 0 1px rgba(0,0,0,.95))}`) stopping `RING_R(5.4)+1` from centre, stroke fades via `linearGradient` (opacity 0→1 at cursor→0); ring `.guided-ruler-intersection{fill rgba(255,255,255,.25); stroke #fff 1.2px}` r5.4; centre dot r1.5 `#fff` stroke `rgba(0,0,0,.6)`. rAF-throttled; MutationObserver on container class.

---

## 7. GoToLocationForm & ShiftMouzaForm (react-bootstrap Modals, shared `styles/ShiftMouzaForm.css`)

### 7.1 Shared modal chrome (`.shift-mouza-modal`, `dialogClassName="modern-modal-compact shift-mouza-modal"`, `centered size="sm"`)
- `.modal-content{border none; radius 16px; overflow hidden; shadow 0 20px 60px rgba(0,0,0,.18), 0 4px 16px rgba(0,0,0,.1); max-height 90vh; flex column}`
- Header `background:linear-gradient(135deg,#0f2027 0%,#203a43 50%,#2c5364 100%); padding 14px 18px; no border`; title `#fff .95rem 600 ls .3px flex gap 8px`, `.title-icon{1rem; opacity .9}`; close btn `filter brightness(0) invert(1); opacity .7→1`.
- Body `#fff; padding 12px 14px; flex column gap 10px; overflow-y auto; max-height calc(90vh - 50px)`. Alerts `.82rem; padding 9px 12px; radius 8px; border 1.5px solid; margin 0`. ≤768px: dialog `margin-top:10px; margin-bottom:auto`.

### 7.2 GoToLocationForm (`Core/GoToLocationForm.js`)
- Title `🎯 Go To Location`. Fields: `Form.Select size=sm .modern-input` "Format": `decimal` "Decimal Degrees (DD)", `dms` "Degrees Minutes Seconds (DMS)", `paste` "Paste Coordinates" (changing clears inputs). `paste` → textarea rows 2 placeholder `31.5204, 74.3587`; else two `type=number step=any` inputs "Latitude" (min −90 max 90, placeholder "-90 to 90", required) / "Longitude" (−180..180) side by side (`d-flex gap-2`). Labels `.8rem 600`.
- Buttons: `variant=primary size=sm flex-fill` "Go To Location" (600) + `outline-danger size=sm` "Clear" (calls `onClearMarkers` and resets fields).
- Validation messages (danger Alert, dismissible, .8rem): `Format example: "31.5204, 74.3587"` (parse fail), `Please enter valid numbers.`, `Lat must be -90 to 90; Lng -180 to 180.`, `Coordinates must be within Pakistan.` (`PAKISTAN_BOUNDS n37.1 s23.6 e77.8 w60.8`). `parseCoordinateString` handles "lat, lng", DMS patterns (`dmsToDecimal`), etc. (locationUtils 117-150).
- Success → `onGoToLocation({lat,lng})` → App appends `{id:Date.now(), coords:[lat,lng]}` to `goToMarkers`; MapComponent flies to newest at `min(18,maxZoom)` with duration `0.6 (<200m & zoomDiff≤1) | 1.5 (<1km) | 2.5 (<5km) | 4.0`, `easeLinearity .25`; marker + permanent tooltip `Lat: {lat}, Lng: {lng}`. Then `onClose`.
- Inputs `.modern-input{border 1px solid #dee2e6; radius 4px; padding 6px 10px; .85rem; height 32px}` focus `border rgba(45,152,255,.5); shadow 0 0 0 2px rgba(45,152,255,.1)`; select `padding 4px 2.25rem 4px 8px; .78rem` (from `styles/GoToLocationForm.css`, which is NOT imported by the component — only `ShiftMouzaForm.css` is; `.modern-input/.modern-label/.form-group-modern` rules therefore only apply if GoToLocationForm.css is loaded elsewhere; it is not imported anywhere → effectively unused, Bootstrap defaults apply). Also unused there: `.goto-location-overlay/card/header` (dark navy radial gradient header), `.btn-goto-modern`, `.btn-clear-modern` (`#f093fb→#f5576c`), `.goto-location-modal` left-fixed 310px variant.

### 7.3 ShiftMouzaForm (`Core/ShiftMouzaForm.js`) — opened from NavigationMenu "Shift" when `(admin || status==='Active') && selectedMauza`
- Title `🔄 Shift Mouza`. Chip `.shift-mouza-chip{bg #f0f7ff; border 1px solid #bfdbfe; radius 6px; padding 4px 8px; .78rem; color #1e3a5f}` with `.chip-label` "SELECTED CHAK" (`#0096c7 .65rem 600 uppercase ls .5px`) + `.chip-value` mauza (`#1e3a5f .8rem 600`).
- Compass pad `.shift-compass` 3×3 grid of 34px cells gap 4px: N (top), W / centre dot (`.compass-dot 6px #dee2e6`) / E, S. `.compass-btn{34×34; radius 8px; border 1.5px solid #dee2e6; bg #fff; color #495057; .75rem 700; shadow 0 1px 3px rgba(0,0,0,.08)}` hover `border/color #0096c7; bg #f0f7ff; translateY(-1px); shadow 0 3px 8px rgba(0,150,199,.2)`; `.active` `linear-gradient(135deg,#0096c7,#007aaa); color #fff; shadow 0 4px 12px rgba(0,150,199,.35)`. N themed red: color `#dc2626`, border `rgba(220,38,38,.25)`, hover `#ef4444`/`#fff5f5`, active `#ef4444→#dc2626`. S themed blue: `#2563eb`, border `rgba(37,99,235,.25)`, hover `#3b82f6`/`#eff6ff`, active `#2563eb→#1d4ed8`. Default direction North.
- Distance: label "DISTANCE" (`.78rem 600 #374151 uppercase ls .5px`), wrap `.shift-distance-input-wrap{border 1.5px solid #d1d5db; radius 10px; overflow hidden}` focus-within `border #0096c7; shadow 0 0 0 3px rgba(0,150,199,.15)`; `input type=number min=1 placeholder "e.g., 100"` (`padding 6px 10px; .85rem 500; color #1f2937`), unit chip "feet" (`padding 0 12px; .75rem 600 #6c757d; bg #f8f9fa; border-left 1px solid #e9ecef`). Enter submits.
- Actions `.shift-action-row{flex gap 10px}`: `.shift-btn-reset` "↺ Reset" (`border 1.5px solid #ef4444; bg #fff5f5; color #ef4444; radius 8px; padding 6px 0; .82rem 600`; hover solid `#ef4444` white, shadow `0 4px 12px rgba(239,68,68,.3)`), `.shift-btn-apply` "↑ Apply Shift" (`#0096c7→#007aaa; #fff; shadow 0 2px 8px rgba(0,150,199,.25)`; hover `#0077a3→#006090`). Loading text `…` / `Applying…`; disabled `opacity .5`.
- Logic: on show `GET /api/geo/adjustment/{tehsil}/{mauza}` → currentOffsets. Apply: validate `distance>0` else message danger "Please enter a valid distance in feet."; new offsets = current ± feet×(1/364000 lat | 1/315000 lng); `POST` `{latOffset,lngOffset}`; `onShift` → App `setPmtilesOffset`; success "Shift of {d} ft to the {dir} applied successfully."; error "Failed to apply shift. Please try again.". Reset: `DELETE` → info "Mouza position has been reset to its baseline location." / danger "Failed to reset offset. Please try again.". Window events `setShiftTourValues {distance,direction}` and `silentResetShiftMouza` (tour).
- Result modal (`.shift-result-modal`, backdrop static): body `padding 32px 24px 24px` centred; icon circle 72px (`3rem`): success ✅ bg `#f0fdf4`, danger ❌ `#fff5f5`, info 🔁 `#eff6ff`; title (`1.05rem 700 #1f2937`) "Shift Applied" / "Error" / "Position Reset"; text `.87rem #6b7280 max-width 220px`; OK button full width `padding 10px; radius 10px; .875rem 600` label "OK"/"Close"/"OK" with gradients success `#10b981→#059669` (hover `#059669→#047857`), danger `#ef4444→#dc2626`, info `#0096c7→#007aaa`, shadows `0 4px 12px rgba(…,.3)`.
- `styles/ShiftPMTilesForm.css` (`.shift-pmtiles-modal`): radius 8px, shadow `0 20px 60px rgba(0,0,0,.3)`, focus ring `rgba(45,152,255,.5)/.1`, btn hover `opacity .9 translateY(-1px)` — class not used by any component.

---

## 8. Locate / compass / search / rotate behaviour — see §2.1-2.3; rotation summary
- `leaflet-rotate` provides `map.getBearing/setBearing`; `rotate:true`, UI control hidden, touch rotate off; rotation via compass ring drag, three-finger horizontal drag (0.5°/px), compass click resets to North with easeOutCubic 180-280ms.
- Monkey patches (MapComponent 60-88): `L.Map.createPane` puts every custom pane in `_rotatePane` except `tooltipPane, popupPane, markerPane, murabbaTooltipPane, killaTooltipPane` (→ `_norotatePane`), and `L.Tooltip._updatePosition` skips mathematical rotation for tooltips whose pane is inside the rotate pane. **Must be replicated if rotation is kept.**
- Custom dblclick zoom (native DOM listener, MapComponent 915-946): disabled Leaflet dblclick; if zoom < min(17,limit) → flyTo(latlng, 17) else +1; duration `clamp(0.5, zoomDiff*0.3, 3)`; skipped when drawing or `_featureDblClicked`.
- Smooth camera patch (795-910): `flyTo/panTo/setView(animate)/fitBounds/flyToBounds/setZoom/zoomIn` wrapped to clamp to `_currentMaxZoomLimit` and compute duration/ease: `<300m & Δz≤1: 0.75+min(.35,d/400), ease .25`; `<1500m & Δz≤2: 0.95+d/2500+Δz*.15, ease .20`; else `1.2+min(1.2, log10(max(10,d/500))*.45)+Δz*.18, ease .15`; clamped 0.6-2.4s; user options override.
- `murabbaCamera.js`: `map.stop()` + token; `prefers-reduced-motion` → instant; `<4px & Δz<.05` no-op; `SMOOTH=1.3`: same-zoom hop `flyTo duration (0.55+hop*0.35)*1.3, ease 0.35/1.3`; neighbour (`<1.5 screens, Δz≤2`) `(0.65+Δz*.1)*1.3`; far `min(1.4, 0.7+screens*.12+Δz*.08)*1.3, ease .25/1.3`; `afterMove(map, fn, 2500)` runs after `moveend`.

---

## 9. Admin-only features
- **AdminToolbar** (§2.6) for `admin` / `subadmin`.
- **Test mode** (`testMode`, menu toggle, admin): shows `MouzaNavigator` with Prev/Next (`handleNavigateMauza` via `fetchMauzas(tehsil)` list), passes `testMode` into loaders so all camera moves become `fitBounds(..., {animate:false})` / `setView(animate:false)` for deterministic screenshots.
- **Killa measurement** toggle (`killaMeasurement`) — plumbed but unused (always on).
- **Force mobile mode** (`forceMobileMode`) → guided drawing + `adminMapMode='geojson'`.
- **adminMapMode** radio in menu (`auto|geojson|pmtiles`), persisted `localStorage admin_map_mode`, included in VectorTileLoader effect key (switching reloads the mouza).
- **Shift Mouza** available to admin or Active users.
- Hidden/dead: VectorTileToggle, `showClearCacheOption` "Clear Cached Tiles" button (`.clear-cache-button`, no CSS).

---

## 10. Performance tricks to keep
1. Custom panes with fixed z-indexes and `pointer-events:none` by default; pixel-offset shift applied via `left/top` (not transform) so Leaflet's zoom CSS scaling still hardware-accelerates.
2. `.map-animating` class added on programmatic `movestart` (no `originalEvent`) → hides all vector/tooltip panes via `visibility:hidden` until `moveend`.
3. Killa tooltips removed on `movestart` and recreated on `moveend` (usePMTilesLoader); murabba tooltips viewport-filtered with 400-label cap and 100/120ms debounce; dense-mode viewport filtering.
4. `data-zoom` attribute on container drives label font sizes purely in CSS (no per-label JS on zoom for drawn labels).
5. Canvas `GridLayer` rendering of MVT via `pbf` + `@mapbox/vector-tile` with overzoom (request `min(z,maxNative)`, divide widths/dashes by `2^Δz`); tile bounds restrict requests.
6. Metadata-first murabba list (localStorage 24h → `/Metadata` JSON → PMTiles metadata → tile scan in batches of 10 with progress UI).
7. Fallback GeoJSON files fetched in chunks of 5 (`CHUNK_SIZE`), 350ms deferral before Leaflet layer creation, dedicated `L.svg` renderers per pane, forced `_renderer` reset on cleanup (avoids stale-renderer scaling bug).
8. Murabba GeoJSON promise cache + hover/touchstart prefetch; `loadingMurabbas` Set dedup; `mouzaCache` LRU(15)/5 min tooltip cache; signed URL cache with 4-min expiry buffer.
9. Single camera coordinator (`murabbaCamera`) with `map.stop()`, request tokens, `afterMove` deferral of heavy work (complete PMTiles, highlight) until the camera settles; `wasClickSelection` suppresses the second move from the selection effect.
10. rAF-throttled ruler/transform overlays; lodash `throttle` for device orientation (80/32ms); label marker reuse during drags (`canReuse`).
11. `safeSetTimeout` tied to mount state; Strict-Mode double-invoke guard via `currentMouzaRef` key.
12. No web workers are used anywhere in this slice (despite the "worker" wording — "Cloudflare worker" is server-side).
13. IndexedDB cache for shajra PNG tiles (`idb`).
14. `wheelPxPerZoomLevel 117`, `zoomSnap .25`, `inertiaDeceleration 2300` tuned feel.

---

## 11. Third-party libs on this page & replacement candidates
| Lib | Use | Replace? |
|---|---|---|
| `react-leaflet` 4.2 | `MapContainer`, `useMap`, `Marker/Tooltip` for go-to markers only | **Replace with plain Leaflet** in a single `useEffect` — nearly every component already bypasses it with `L.Control.extend`/`useMap`; removes the `whenCreated`/remount-by-key awkwardness. |
| `leaflet` 1.9.4 | core | keep (or MapLibre, see below) |
| `leaflet-rotate` | bearing/rotation + required pane monkey patches | keep only if rotation is a must; fragile (two prototype patches). MapLibre has native bearing. |
| `@geoman-io/leaflet-geoman-free` 2.20 | draw/edit/drag/rotate/remove toolbar | keep (heavily customised, many prototype safeguards, tours target its DOM); alternative Terra Draw if moving to MapLibre. |
| `leaflet-simple-map-screenshoter` | imported, control disabled | **drop**. |
| `leaflet-rotatedmarker`, `leaflet.locatecontrol`, `leaflet.heat` | not used on map page (heat only in admin stats) | drop from this page. |
| `pmtiles` 3 | `PMTiles(url).getHeader/getZxy/getMetadata` | keep; MapLibre could consume PMTiles natively via `pmtiles` Protocol and style JSON, removing the hand-written canvas renderer (§5.2/5.4) — biggest simplification candidate, but hit-testing/labels logic would need rewriting (`queryRenderedFeatures`, symbol layers). |
| `protomaps-leaflet` | in package.json, **not imported** by this slice | drop. |
| `@mapbox/vector-tile` + `pbf` | MVT decoding for canvas + hit-tests | keep while on Leaflet canvas renderer. |
| `@turf/turf` 7 | area, union/buffer/simplify for killa merge, distance/bearing/destination for template grid | keep (tree-shake to the used functions). |
| `polylabel` | label placement for drawn polygon areas | keep (tiny). |
| `idb` | IndexedDB shajra tile cache (NOT in package.json deps — transitive) | add explicitly or drop with shajra cache. |
| `lodash/throttle` | compass (NOT in package.json — transitive) | replace with 5-line throttle. |
| `react-bootstrap` | Modals (GoTo/Shift), MouzaNavigator buttons, dead MapSidebar | replace with Tailwind modals; keep exact gradients. |
| `react-icons` (fa, tb) | AdminToolbar, MouzaNavigator, guided toolbar | keep or inline SVG. |
| `axios` | signed-url, geo adjustment, user-layers | fetch wrapper fine. |
| `konva` / `react-konva` | listed in package.json, **not used** on the map page | drop. |
| `uuid` | device id (deviceUtils) | unrelated to map. |

---

## Gotchas
1. **`window.fetch` is monkey-patched** (`setupSecurePMTilesFetch`) to add `credentials:'include'` to any URL containing `.pmtiles`. Auth is an httpOnly cookie; signed-url POST is sent without `withCredentials`.
2. **`localhost` special-casing**: murabba/mouza GeoJSON use relative URLs on localhost (CRA proxy to :5000) but `REACT_APP_API_URL` elsewhere; `fetchFromLocal` in mouzaApi uses `REACT_APP_API_URL` prefix anyway. Vite rebuild must keep a dev proxy for `/JSON Murabba`, `/Metadata`, `/Shajra Parcha`, `/pmtiles`, `/api`.
3. Paths contain spaces: `/JSON Murabba/...`, `/Shajra Parcha/...` (encoded per segment).
4. Metadata centroids are `[lng,lat]` and must be swapped for Leaflet; `window.scannedMurabbaCentroids` are already `[lat,lng]`; `window.murabbaCentroids` (raw) also set. MapComponent's own dropdown-zoom fallback passes `option.centroid` straight to `flyTo` (likely lng/lat bug, kept as-is).
5. Several props are plumbed but dead: `killaMeasurement`, `shajraEnabled/shajraVisible` from App, `style` prop of VectorTileLoader, `onPMTilesOffsetFetched`, `geoJsonUrl`, `showClearCacheOption`, `onGeoJsonLoaded`, `mapKey`/`resetFlag` (never set → undefined).
6. `shiftResult` effect expects a FeatureCollection but App passes a string path → effectively no-op; the real shift mechanism is the CSS pane offset from `pmtilesOffset`.
7. `cleanupAllLayers` calls `map.off('mousemove')` / `map.off('click')` with no handler — wipes ALL listeners for those events (including DrawControl's guide-line mousemove and GlobalZoomTracker's click clear). DrawControl's unmount does the same for mousemove. Order of mount matters; keep or fix deliberately.
8. Leaflet-rotate pane patch: new panes are created inside the rotate pane except the whitelist; tooltips in the rotated pane skip rotation math. Any new pane name must be considered.
9. `MapUpdater` is defined inside the component (re-created each render; its effect deps `[map,setTilesLoaded,currentMaxZoom]`), and patches map prototype methods once per map instance (`_zoomClamped`, `_customDblClickZoom`).
10. Drawn shapes sit in `overlayPane` (400) under all data panes → clicks on drawn shapes are resolved by manual hit-testing on container click (capture phase), not Leaflet events.
11. Tours (`components/Common/*Tour.js`) target `.leaflet-draw-draw-polyline|polygon|rectangle`, `.leaflet-draw-edit-edit|remove`, `.leaflet-location-icon`, `#map-base-layer-select`, `#leaflet-location-control-btn`; `tourFlyToLevel` window event flies to a zoom. Keep these ids/classes.
12. Global state on `map`/`window`: `map._isDrawing, _featureDblClicked, _clickTriggeredSelection, _geojsonModeActive, _completePMTilesLoaded, _hasKillaTooltips, _activeKillaHighlight, _activeKillaKaramLabels, _activeKillaKey, _killaAreaBoxRef, _currentMaxZoomLimit, drawnItems, _murabbaCameraMoving/_murabbaCameraToken`, `window.leafletMap, _activeMurabbaTooltipsByNo, scannedMurabbaCentroids, murabbaCentroids, L`. Module-level singletons in bindTooltips (registries, `mapInstance`) require `clearRegisteredTooltips()` on mouza change.
13. `L.GeometryUtil.geodesicArea` is polyfilled by DrawControl at import time; measurementUtils and GuidedDrawingMode depend on it existing.
14. Restricted users (Expired/Pending/0 days) get `maxZoom 14` enforced via wrapped methods, and base layers rebuild with that `maxZoom`.
15. Two independent "Area" box implementations share CSS: killa box (`.killa-area-info-box`, removed on any map click) vs drawn box (`.drawn-area-info-box`, survives clicks; ✕ hides labels of all shapes).
16. Mobile killa tooltips in murabba GeoJSON path are per-feature `L.tooltip` bound to layers (not centroid markers) with pane `killaTooltipPane`; complete-PMTiles tooltips are standalone `L.tooltip.setLatLng` objects — different cleanup paths (`layer._killaTooltips`, `killaTooltipsRef`).
17. The dropdown murabba effect in MapComponent (1593-1683) only runs in `'shajra'` mode; in `'geojson-db'` mode selection is handled by VectorTileLoader's effect (300ms delay) — both call `loadMurabbaPMTiles` with `skipZoom=true`.
18. `idb` and `lodash` are not declared dependencies; `protomaps-leaflet`, `konva`, `react-konva`, `leaflet.locatecontrol`, `leaflet-rotatedmarker`, `html2canvas`, `jspdf` are declared but unused on this page.
19. Base-layer URLs include Google tile endpoints (no API key / attribution) — legal/ToS consideration carried over as-is.
20. `env(safe-area-inset-bottom)` only on app container padding and guided toolbar; Leaflet bottom-left/right controls (Geoman toolbar, layer dropdown at bottom 10px) are not safe-area aware.
