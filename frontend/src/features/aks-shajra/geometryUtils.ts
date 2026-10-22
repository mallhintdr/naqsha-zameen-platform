// Ported from legacy src/components/AksShajra/geometryUtils.js

/**
 * Find the closest snap point within a threshold distance
 * @param {{x: number, y: number}} point Cursor point in canvas coords
 * @param {Array<{x: number, y: number, type?: string}>} candidatePoints List of points to snap to
 * @param {number} threshold Pixel threshold
 */
export const getClosestSnapPoint = (point: { x: number; y: number }, candidatePoints: any[], threshold = 12): any => {
  let closest: any = null;
  let minDist = threshold;

  for (const candidate of candidatePoints) {
    const dist = Math.hypot(point.x - candidate.x, point.y - candidate.y);
    if (dist < minDist) {
      minDist = dist;
      closest = candidate;
    }
  }

  return closest ? { ...closest, distance: minDist } : null;
};

/**
 * Calculate polygon area using Shoelace formula (in pixel squared)
 */
export const calculatePolygonArea = (points: number[]) => {
  if (!points || points.length < 6) return 0; // points array is flat [x1, y1, x2, y2, ...]
  let area = 0;
  const numPoints = points.length / 2;

  for (let i = 0; i < numPoints; i++) {
    const x1 = points[i * 2];
    const y1 = points[i * 2 + 1];
    const nextIdx = (i + 1) % numPoints;
    const x2 = points[nextIdx * 2];
    const y2 = points[nextIdx * 2 + 1];
    area += x1 * y2 - x2 * y1;
  }

  return Math.abs(area) / 2;
};

/**
 * Calculate polygon centroid
 */
export const calculateCentroid = (points: number[]) => {
  if (!points || points.length < 2) return { x: 0, y: 0 };
  const numPoints = points.length / 2;
  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < numPoints; i++) {
    sumX += points[i * 2];
    sumY += points[i * 2 + 1];
  }
  return {
    x: sumX / numPoints,
    y: sumY / numPoints,
  };
};
