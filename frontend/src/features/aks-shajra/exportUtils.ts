// src/components/AksShajra/exportUtils.js
import jsPDF from 'jspdf';
import { PAPER_SIZES } from './shajraConstants';

/**
 * Export Konva Stage to PNG.
 * The stage already renders the title block on canvas, so toDataURL() includes it.
 * We additionally stamp a thin metadata header over the exported image so it
 * survives even if the on-canvas title is small.
 */
export const exportStageToPNG = (stageRef, metadata = {}, fileName = 'aks-shajra-map.png', pixelRatio = 3) => {
  if (!stageRef || !stageRef.current) return;

  const stageDataUrl = stageRef.current.toDataURL({ pixelRatio });

  const img = new window.Image();
  img.onload = () => {
    const W = img.width;
    const H = img.height;

    const canvas = document.createElement('canvas');
    canvas.width  = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    // Draw the Konva stage capture (already includes title block)
    ctx.drawImage(img, 0, 0);

    // Compose metadata footer strip at the very bottom so it never overlaps
    const stripH = Math.round(H * 0.04);   // 4% of image height
    const fs     = Math.max(12, Math.round(stripH * 0.45));

    ctx.fillStyle = 'rgba(15,23,42,0.82)';
    ctx.fillRect(0, H - stripH, W, stripH);

    ctx.fillStyle = '#f8fafc';
    ctx.font      = `${fs}px "Inter", Arial, sans-serif`;
    ctx.textBaseline = 'middle';

    const parts = [
      metadata.title     && metadata.title,
      metadata.tehsil    && `Tehsil: ${metadata.tehsil}`,
      metadata.mauza     && `Mouza: ${metadata.mauza}`,
      metadata.murabba   && `Murabba: ${metadata.murabba}`,
      metadata.hadbastNo && `Hadbast: ${metadata.hadbastNo}`,
      metadata.scale     && `Scale: ${metadata.scale}`,
      metadata.preparedBy && `Prepared By: ${metadata.preparedBy}`,
      metadata.checkedBy  && `Checked By: ${metadata.checkedBy}`,
      `Date: ${metadata.date || new Date().toISOString().split('T')[0]}`,
    ].filter(Boolean).join('   |   ');

    ctx.fillText(parts, 14, H - stripH / 2);

    // Download
    const link = document.createElement('a');
    link.download = fileName;
    link.href     = canvas.toDataURL('image/png');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };
  img.src = stageDataUrl;
};

/**
 * Export complete layout (Title block, Map, Legend, North Arrow, Scale Bar) to PDF
 */
export const exportToPDF = ({
  stageRef,
  metadata = {},
  legend = [],
  paperSize = 'A3',
  orientation = 'portrait',
  scale = '1:1000',
  northArrowSvg = null,
}) => {
  if (!stageRef || !stageRef.current) return;

  const isPortrait = orientation === 'portrait';
  const paper = PAPER_SIZES[paperSize] || PAPER_SIZES.A3;

  // Initialize jsPDF
  const doc = new jsPDF({
    orientation: isPortrait ? 'portrait' : 'landscape',
    unit: 'mm',
    format: [paper.widthMm, paper.heightMm],
  });

  const pageWidth  = isPortrait ? paper.widthMm  : paper.heightMm;
  const pageHeight = isPortrait ? paper.heightMm : paper.widthMm;
  const margin        = 10;
  const contentWidth  = pageWidth  - margin * 2;
  const contentHeight = pageHeight - margin * 2;

  // Outer Border
  doc.setLineWidth(0.8);
  doc.setDrawColor(20, 30, 60);
  doc.rect(margin, margin, contentWidth, contentHeight);

  // Inner Border
  doc.setLineWidth(0.2);
  doc.rect(margin + 1.5, margin + 1.5, contentWidth - 3, contentHeight - 3);

  // 1. Title Block (Header)
  const headerHeight = 34; // was 30 — a bit taller so Prepared/Checked By can be legible
  doc.setFillColor(248, 250, 252);
  doc.rect(margin + 1.5, margin + 1.5, contentWidth - 3, headerHeight, 'F');
  doc.line(margin + 1.5, margin + 1.5 + headerHeight, margin + contentWidth - 1.5, margin + 1.5 + headerHeight);

  // Left accent bar
  doc.setFillColor(2, 132, 199);
  doc.rect(margin + 1.5, margin + 1.5, 3, headerHeight, 'F');

  // Title Text
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  doc.setTextColor(15, 23, 42);
  doc.text(metadata.title || 'Aks Shajra Parcha', pageWidth / 2, margin + 9, { align: 'center' });

  // Divider under title
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.3);
  doc.line(margin + contentWidth * 0.12, margin + 16, margin + contentWidth * 0.88, margin + 16);

  // Subtitle / Info Row 1
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(51, 65, 85);
  const infoLeft = [
    metadata.mauza     && `Mouza: ${metadata.mauza}`,
    metadata.murabba   && `Murabba No: ${metadata.murabba}`,
    metadata.hadbastNo && `Hadbast: ${metadata.hadbastNo}`,
    metadata.tehsil    && `Tehsil: ${metadata.tehsil}`,
    metadata.district  && `District: ${metadata.district}`,
  ].filter(Boolean).join('  |  ');
  const infoRight = `Scale: ${metadata.scale || scale}   Date: ${metadata.date || new Date().toISOString().split('T')[0]}`;
  doc.text(infoLeft  || '—', margin + 7, margin + 21);
  doc.text(infoRight, margin + contentWidth - 5, margin + 21, { align: 'right' });

  if (metadata.preparedBy || metadata.checkedBy) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12); // was 8, then 10 — still reported unreadable on a full print
    doc.setTextColor(51, 65, 85);
    const preparedText = [
      metadata.preparedBy && `Prepared By: ${metadata.preparedBy}`,
      metadata.checkedBy  && `Checked By: ${metadata.checkedBy}`,
    ].filter(Boolean).join('     |     ');
    doc.text(preparedText, margin + 7, margin + 29.5);
  }

  // 2. Map Canvas Image
  const footerHeight     = 26; // was 22 — extra room for a properly sized North arrow graphic
  const mapTop           = margin + 1.5 + headerHeight + 2;
  const mapAvailableHeight = contentHeight - headerHeight - footerHeight - 7;
  const mapAvailableWidth  = contentWidth  - 6;

  // Capture canvas data (the stage already contains the on-canvas title block)
  const mapDataUrl  = stageRef.current.toDataURL({ pixelRatio: 2.5 });
  const stageWidth  = stageRef.current.width();
  const stageHeight = stageRef.current.height();

  // Aspect ratio fit
  const imgRatio = stageWidth / stageHeight;
  let drawW = mapAvailableWidth;
  let drawH = drawW / imgRatio;

  if (drawH > mapAvailableHeight) {
    drawH = mapAvailableHeight;
    drawW = drawH * imgRatio;
  }

  const mapX = margin + 3 + (mapAvailableWidth - drawW) / 2;
  const mapY = mapTop  + (mapAvailableHeight - drawH) / 2;

  doc.addImage(mapDataUrl, 'PNG', mapX, mapY, drawW, drawH);

  // Border around map image
  doc.setLineWidth(0.3);
  doc.setDrawColor(180, 190, 205);
  doc.rect(mapX, mapY, drawW, drawH);

  // 3. Footer Section (Scale bar & North & Legend summary)
  const footerTop = margin + contentHeight - footerHeight - 1.5;
  doc.setDrawColor(20, 30, 60);
  doc.setLineWidth(0.4);
  doc.line(margin + 1.5, footerTop, margin + contentWidth - 1.5, footerTop);

  // Scale bar graphic
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(30, 41, 59);
  doc.text('Scale Bar:', margin + 6, footerTop + 7);

  doc.setFillColor(30, 41, 59);
  doc.rect(margin + 26, footerTop + 4, 15, 3, 'F');
  doc.setFillColor(255, 255, 255);
  doc.rect(margin + 41, footerTop + 4, 15, 3, 'F');
  doc.setDrawColor(30, 41, 59);
  doc.rect(margin + 26, footerTop + 4, 30, 3);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.text('0', margin + 26, footerTop + 11);
  doc.text('100 Karams (550 ft)', margin + 56, footerTop + 11, { align: 'right' });

  // North Indicator in footer — a modern circular compass badge, matching the
  // one used on the map canvas itself. Everything is drawn relative to a
  // single radius (r) chosen to fit inside the footer band with margin on
  // every side, so no part of it can ever land outside the printed page.
  const naR  = Math.min(footerHeight / 2 - 3, 8);
  const naCx = margin + contentWidth - 14 - naR;
  const naCy = footerTop + footerHeight / 2;

  doc.setDrawColor(203, 213, 225);
  doc.setFillColor(255, 255, 255);
  doc.setLineWidth(0.3);
  doc.circle(naCx, naCy, naR, 'FD');

  // Compass needle (kite): red half points North, light half points South
  doc.setFillColor(220, 38, 38);
  doc.triangle(naCx, naCy - naR * 0.72, naCx + naR * 0.34, naCy, naCx, naCy, 'F');
  doc.setFillColor(239, 68, 68);
  doc.triangle(naCx, naCy - naR * 0.72, naCx - naR * 0.34, naCy, naCx, naCy, 'F');
  doc.setFillColor(226, 232, 240);
  doc.triangle(naCx, naCy + naR * 0.55, naCx + naR * 0.34, naCy, naCx, naCy, 'F');
  doc.setFillColor(241, 245, 249);
  doc.triangle(naCx, naCy + naR * 0.55, naCx - naR * 0.34, naCy, naCx, naCy, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(Math.max(6, naR * 0.85));
  doc.setTextColor(15, 23, 42);
  doc.text('N', naCx, naCy - naR * 0.62, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(71, 85, 105);
  doc.text('NORTH (شمال)', naCx, footerTop + footerHeight - 2, { align: 'center' });

  // Save PDF
  const cleanName = (metadata.mauza || 'aks_shajra').replace(/\s+/g, '_').toLowerCase();
  doc.save(`${cleanName}_shajra_map.pdf`);
};

/**
 * Export project state as JSON file
 */
export const exportProjectJSON = (projectData, fileName = 'aks-shajra-project.json') => {
  const jsonStr = JSON.stringify(projectData, null, 2);
  const blob    = new Blob([jsonStr], { type: 'application/json' });
  const url     = URL.createObjectURL(blob);
  const link    = document.createElement('a');
  link.href     = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

