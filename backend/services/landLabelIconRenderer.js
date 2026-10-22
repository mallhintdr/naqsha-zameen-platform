/**
 * landLabelIconRenderer.js
 *
 * Renders small standalone text-label PNGs for KMZ Point Placemarks that
 * need a halo/outline effect KML's native <LabelStyle> cannot do — KML has
 * no shadow/outline property for text labels at all (unlike the CSS
 * text-shadow used on the frontend preview map). Using an <IconStyle> image
 * instead of <LabelStyle> text gives full control over the rendering while
 * still staying geographically anchored (pans/zooms with the map, unlike a
 * ScreenOverlay).
 */
const { createCanvas } = require('@napi-rs/canvas');

/**
 * @param {string} text
 * @param {{ fill?: string, haloColor?: string, fontSize?: number }} [opts]
 * @returns {Buffer} PNG buffer, tightly cropped to the text content
 */
function renderHaloLabelIcon(text, opts = {}) {
    const fontSize = opts.fontSize || 40;
    const fill = opts.fill || '#ff0000';
    const haloColor = opts.haloColor || '#ffffff';
    const font = `bold ${fontSize}px "Segoe UI", Arial, sans-serif`;
    const haloWidth = Math.max(3, Math.round(fontSize * 0.11));

    const scratch = createCanvas(10, 10).getContext('2d');
    scratch.font = font;
    const textWidth = scratch.measureText(text).width;

    const pad = haloWidth * 2 + 4;
    const width = Math.ceil(textWidth + pad * 2);
    const height = Math.ceil(fontSize * 1.4 + pad * 2);

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.font = font;
    ctx.textBaseline = 'middle';

    const cx = width / 2;
    const cy = height / 2;

    // White halo: stroke the text multiple times at small offsets (cheap,
    // reliable substitute for a true outline stroke on small canvas text).
    ctx.textAlign = 'center';
    ctx.fillStyle = haloColor;
    const steps = 12;
    for (let i = 0; i < steps; i++) {
        const angle = (i / steps) * Math.PI * 2;
        const dx = Math.cos(angle) * haloWidth;
        const dy = Math.sin(angle) * haloWidth;
        ctx.fillText(text, cx + dx, cy + dy);
    }

    // Foreground text on top
    ctx.fillStyle = fill;
    ctx.fillText(text, cx, cy);

    return canvas.toBuffer('image/png');
}

module.exports = { renderHaloLabelIcon };
