/**
 * kmzBuilderService.js
 *
 * Builds the final .kmz (a zip containing doc.kml + branded PNGs) that gets
 * handed to the allottee for use in Google Earth.
 *
 * Visual convention (explicit final spec):
 *   - Killa boundary  = bright yellow #FFFF00, weight 2 — matches
 *     MAP_STYLES.musteel in src/components/Map/Core/tileStyles.js.
 *   - Murabba context boundary = NOT drawn in the KMZ export (deliberately
 *     omitted — only the allotted killa(s) are shown; the frontend preview
 *     may still show it, but the exported file should not).
 *   - Killa label     = WHITE bold text, DARK (black) halo.
 *   - Murabba label   = RED bold text, WHITE halo, rendered 1.5x the size of
 *     the killa number labels via explicit <IconStyle><scale> (not via a
 *     bigger raster font — see the constants below for why).
 * Note the label colors are a deliberate departure from the live map's own
 * `.killa-tooltip` (gold text) / `.murabba-tooltip` (black halo) CSS — this
 * is the confirmed final spec, not an oversight.
 *
 * Every visible text label is rendered as a small rasterized PNG (via
 * landLabelIconRenderer.js / @napi-rs/canvas) shown through a Point
 * Placemark's <IconStyle>, NOT KML's native <LabelStyle> — that has no
 * shadow/outline property at all, so it can't replicate the CSS text-shadow
 * halo the live map's tooltips use.
 */
const archiver = require('archiver');
const { PassThrough } = require('stream');
const { renderLandInfoBanner } = require('./landInfoBannerRenderer');
const { renderHaloLabelIcon } = require('./landLabelIconRenderer');

const KILLA_LINE_WIDTH = 2;   // matches MAP_STYLES.musteel.geojson.weight
// Both labels are rasterized at the SAME base font size deliberately — the
// "70/3" murabba text is much wider than the 2-digit killa numbers, so if we
// instead inflated its font size, the two PNGs would end up with very
// different aspect ratios. Google Earth's on-screen icon size for a custom
// <Icon> is not a reliable 1:1 with raw PNG pixel dimensions once aspect
// ratios diverge like that, which is why a previous "bigger font" attempt
// rendered SMALLER on screen for the wider text. The relative size is
// instead controlled purely via <IconStyle><scale>, which KML guarantees as
// a direct multiplier — see MURABBA_ICON_SCALE below.
const KILLA_LABEL_FONT_SIZE = 34;
const MURABBA_LABEL_FONT_SIZE = KILLA_LABEL_FONT_SIZE;
const KILLA_ICON_SCALE = 1;
const MURABBA_ICON_SCALE = 1.5; // explicit final spec: murabba label is 1.5x the killa label

const escapeXml = (s) => String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function ringToKmlCoordinates(ring) {
    // GeoJSON [lon, lat] pairs map directly to KML "lon,lat,alt" triples —
    // no axis swap needed, just formatting.
    return ring.map(([lon, lat]) => `${lon},${lat},0`).join(' ');
}

/** Centroid of a closed ring (drops the repeated closing point). */
function ringCentroid(ring) {
    const pts = ring.slice(0, -1);
    const sum = pts.reduce((acc, [lon, lat]) => [acc[0] + lon, acc[1] + lat], [0, 0]);
    return [sum[0] / pts.length, sum[1] / pts.length];
}

/**
 * A point inset from a ring's first vertex toward its centroid — used to
 * place the Murabba No callout "inside the geometry" near the top-left
 * corner, rather than exactly on the boundary line/vertex where it's easy
 * to misread against the outline.
 */
function insetCorner(ring, fraction = 0.22) {
    const corner = ring[0];
    const centroid = ringCentroid(ring);
    return [
        corner[0] + (centroid[0] - corner[0]) * fraction,
        corner[1] + (centroid[1] - corner[1]) * fraction
    ];
}

const iconStyleId = (fileName) => `${fileName.replace(/\W/g, '')}Style`;

/** A Point Placemark that shows a pre-rendered icon (from `files/<fileName>`) instead of native text. */
function buildIconLabelPlacemark(name, [lon, lat], fileName) {
    return `
    <Placemark>
      <name>${escapeXml(name)}</name>
      <styleUrl>#${iconStyleId(fileName)}</styleUrl>
      <Point><coordinates>${lon},${lat},0</coordinates></Point>
    </Placemark>`;
}

function buildKillaPolygonPlacemark(feature, info) {
    const killaNo = feature.properties.Killa;
    const ring = feature.geometry.coordinates[0];
    const coords = ringToKmlCoordinates(ring);
    const description = `
      <![CDATA[
        <b>Mouza:</b> ${escapeXml(info.mouza)}<br/>
        <b>Murabba No:</b> ${escapeXml(info.murabbaNo)}<br/>
        <b>Killa No:</b> ${escapeXml(killaNo)}<br/>
        <b>Allottee:</b> ${escapeXml(info.allotteeName)}<br/>
        <b>CNIC:</b> ${escapeXml(info.cnic)}
      ]]>
    `;
    return `
    <Placemark>
      <name>${escapeXml(killaNo)}</name>
      <description>${description}</description>
      <styleUrl>#allottedKillaStyle</styleUrl>
      <Polygon>
        <tessellate>1</tessellate>
        <outerBoundaryIs><LinearRing><coordinates>${coords}</coordinates></LinearRing></outerBoundaryIs>
      </Polygon>
    </Placemark>`;
}

// Fixed on-screen pixel footprint for the info banner (NOT a fraction of
// screen width). Google Earth's mobile app does not reliably honor
// `<size x="fraction" y="0">` (auto/aspect-locked height) for a wide,
// short-aspect image like this banner — the overlay ends up partially or
// mostly rendered outside the visible viewport on phones. A fixed pixel size
// (both x and y) sidesteps that entirely: the banner occupies the same
// absolute screen footprint on any device, which comfortably fits within
// even small phone screens (modern phones are virtually always >= 720px
// wide) while remaining a small, readable corner overlay on desktop too.
const BANNER_SCREEN_WIDTH_PX = 320;

function buildKmlDocument(killaFeatures, info, killaLabelFiles, murabbaLabelFileName, bannerDims) {
    const placemarks = killaFeatures.map((f, i) => {
        const [centerLon, centerLat] = ringCentroid(f.geometry.coordinates[0]);
        const labelFile = killaLabelFiles[i];
        return `${buildKillaPolygonPlacemark(f, info)}\n${buildIconLabelPlacemark(f.properties.Killa, [centerLon, centerLat], labelFile)}`;
    }).join('\n');

    // Murabba No callout INSIDE the first allotted killa, near its top-left
    // corner (inset from ring[0] toward the centroid, not sitting on the
    // boundary vertex).
    let murabbaLabel = '';
    if (killaFeatures.length > 0 && murabbaLabelFileName) {
        const firstRing = killaFeatures[0].geometry.coordinates[0];
        murabbaLabel = buildIconLabelPlacemark(info.murabbaNo, insetCorner(firstRing), murabbaLabelFileName);
    }

    const docName = `${info.mouza} - Murabba ${info.murabbaNo} - ${info.allotteeName}`;

    // One <Style> per distinct icon file (killa number labels + the murabba
    // label), all sharing the same "icon only, no native text label" shape.
    const uniqueIconFiles = Array.from(new Set([...killaLabelFiles, ...(murabbaLabelFileName ? [murabbaLabelFileName] : [])]));
    const iconStyles = uniqueIconFiles.map(fileName => {
        const scale = fileName === murabbaLabelFileName ? MURABBA_ICON_SCALE : KILLA_ICON_SCALE;
        return `
  <Style id="${iconStyleId(fileName)}">
    <IconStyle><scale>${scale}</scale><Icon><href>files/${escapeXml(fileName)}</href></Icon></IconStyle>
    <LabelStyle><scale>0</scale></LabelStyle>
  </Style>`;
    }).join('');

    return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <name>${escapeXml(docName)}</name>

  <!-- Killa boundary: matches MAP_STYLES.musteel — bright yellow, transparent fill. -->
  <Style id="allottedKillaStyle">
    <LineStyle><color>ff00ffff</color><width>${KILLA_LINE_WIDTH}</width></LineStyle>
    <PolyStyle><fill>0</fill><outline>1</outline></PolyStyle>
  </Style>
  ${iconStyles}

  <!-- Branded info banner, horizontally CENTERED and positioned 15% down
       from the top of the screen — clear of any edge-anchored app chrome
       (toolbars/nav strips) and reads as a clean, centered title banner.
       Fixed pixel size (not a screen-fraction with auto height) so it
       renders fully on-screen on mobile too — see BANNER_SCREEN_WIDTH_PX
       above. -->
  <ScreenOverlay>
    <name>GeoMatrix Info Banner</name>
    <Icon><href>files/banner.png</href></Icon>
    <overlayXY x="0.5" y="1" xunits="fraction" yunits="fraction"/>
    <screenXY x="0.5" y="0.85" xunits="fraction" yunits="fraction"/>
    <rotationXY x="0" y="0" xunits="fraction" yunits="fraction"/>
    <size x="${bannerDims.width}" y="${bannerDims.height}" xunits="pixels" yunits="pixels"/>
  </ScreenOverlay>

  <Folder>
    <name>Allotted Killa(s)</name>
    ${murabbaLabel}
    ${placemarks}
  </Folder>
</Document>
</kml>`;
}

/**
 * @param {Array} killaFeatures GeoJSON Polygon features for the allotted killas
 * @param {{ mouza, murabbaNo, killaNos, allotteeName, cnic }} info
 * @returns {Promise<Buffer>} the .kmz file as a buffer
 */
async function buildKmz(killaFeatures, info) {
    const murabbaLabelFileName = killaFeatures.length > 0 ? 'murabba-label.png' : null;
    const killaLabelFiles = killaFeatures.map(f => `killa-${String(f.properties.Killa).replace(/\W/g, '_')}.png`);

    // Explicit final spec: killa labels = white text / dark halo; murabba
    // label = red text / white halo, sized 1.5x via <IconStyle><scale>.
    const [bannerResult, murabbaLabelBuffer, killaLabelBuffers] = await Promise.all([
        renderLandInfoBanner(info),
        murabbaLabelFileName
            ? Promise.resolve(renderHaloLabelIcon(info.murabbaNo, { fill: '#ff0000', haloColor: '#ffffff', fontSize: MURABBA_LABEL_FONT_SIZE }))
            : Promise.resolve(null),
        Promise.all(killaFeatures.map(f =>
            renderHaloLabelIcon(String(f.properties.Killa), { fill: '#ffffff', haloColor: '#000000', fontSize: KILLA_LABEL_FONT_SIZE })
        ))
    ]);

    const bannerBuffer = bannerResult.buffer;
    const bannerDims = {
        width: BANNER_SCREEN_WIDTH_PX,
        height: Math.round(BANNER_SCREEN_WIDTH_PX * (bannerResult.height / bannerResult.width))
    };
    const kml = buildKmlDocument(killaFeatures, info, killaLabelFiles, murabbaLabelFileName, bannerDims);

    return new Promise((resolve, reject) => {
        const archive = archiver('zip', { zlib: { level: 9 } });
        const output = new PassThrough();
        const chunks = [];

        output.on('data', (chunk) => chunks.push(chunk));
        output.on('end', () => resolve(Buffer.concat(chunks)));
        archive.on('error', reject);
        output.on('error', reject);

        archive.pipe(output);
        archive.append(kml, { name: 'doc.kml' });
        archive.append(bannerBuffer, { name: 'files/banner.png' });
        if (murabbaLabelBuffer) {
            archive.append(murabbaLabelBuffer, { name: `files/${murabbaLabelFileName}` });
        }
        killaLabelFiles.forEach((fileName, i) => {
            archive.append(killaLabelBuffers[i], { name: `files/${fileName}` });
        });
        archive.finalize();
    });
}

module.exports = { buildKmz };
