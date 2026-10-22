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

/**
 * Ramer-Douglas-Peucker algorithm to simplify freehand drawing paths
 */
export const simplifyPath = (points: number[], tolerance = 2) => {
  if (points.length <= 4) return points; // flat [x, y, ...]

  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < points.length; i += 2) {
    pts.push({ x: points[i], y: points[i + 1] });
  }

  const getSqDist = (p1, p2) => {
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    return dx * dx + dy * dy;
  };

  const getSqSegDist = (p, p1, p2) => {
    let x = p1.x;
    let y = p1.y;
    let dx = p2.x - x;
    let dy = p2.y - y;

    if (dx !== 0 || dy !== 0) {
      const t = ((p.x - x) * dx + (p.y - y) * dy) / (dx * dx + dy * dy);
      if (t > 1) {
        x = p2.x;
        y = p2.y;
      } else if (t > 0) {
        x += dx * t;
        y += dy * t;
      }
    }

    dx = p.x - x;
    dy = p.y - y;
    return dx * dx + dy * dy;
  };

  const simplifyDPStep = (ptsList, first, last, sqTolerance, simplified) => {
    let maxSqDist = sqTolerance;
    let index = 0;

    for (let i = first + 1; i < last; i++) {
      const sqDist = getSqSegDist(ptsList[i], ptsList[first], ptsList[last]);
      if (sqDist > maxSqDist) {
        index = i;
        maxSqDist = sqDist;
      }
    }

    if (maxSqDist > sqTolerance) {
      if (index - first > 1) simplifyDPStep(ptsList, first, index, sqTolerance, simplified);
      simplified.push(ptsList[index]);
      if (last - index > 1) simplifyDPStep(ptsList, index, last, sqTolerance, simplified);
    }
  };

  const sqTolerance = tolerance * tolerance;
  const last = pts.length - 1;
  const simplified = [pts[0]];
  simplifyDPStep(pts, 0, last, sqTolerance, simplified);
  simplified.push(pts[last]);

  const flatResult: number[] = [];
  for (const pt of simplified) {
    flatResult.push(pt.x, pt.y);
  }
  return flatResult;
};
