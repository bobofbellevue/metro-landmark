/* eslint-env node */
/**
 * Detect unusable / synthetic field positions in template schemas.
 *
 * Vision extraction sometimes invents a neat vertical column of PDF-point
 * coordinates (e.g. x=250, y=700/650/600/…) when it cannot measure real blanks.
 * Overlaying those on the template PDF looks exactly like the old sequential
 * "no template" layout painted onto Form 68 — wrong blanks, same column.
 */

/**
 * Collect leaf field positions from a template schema.
 * @param {object} templateData
 * @returns {Array<{ x: number, y: number, page: number }>}
 */
export function collectFieldPositions(templateData) {
  const positions = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.type && node.position && typeof node.position === 'object') {
      const x = Number(node.position.x);
      const y = Number(node.position.y);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        positions.push({
          x,
          y,
          page:
            typeof node.position.page === 'number' &&
            Number.isFinite(node.position.page)
              ? node.position.page
              : 0,
        });
      }
      return;
    }
    if (node.type === 'array' && node.items?.properties) {
      walk(node.items.properties);
      return;
    }
    for (const value of Object.values(node)) {
      if (value && typeof value === 'object') walk(value);
    }
  };
  walk(templateData);
  return positions;
}

function nearlyEqual(a, b, eps = 0.51) {
  return Math.abs(a - b) <= eps;
}

/**
 * True when positions look like a single invented vertical column of
 * PDF-point coords (same X, regularly stepped Y) rather than measured blanks.
 *
 * @param {object} templateData
 * @param {{ minFields?: number }} [options]
 * @returns {{ synthetic: boolean, reason: string|null, sample: Array<object>, sharedX: number|null }}
 */
export function analyzeTemplatePositionQuality(templateData, options = {}) {
  const minFields = options.minFields ?? 5;
  const positions = collectFieldPositions(templateData);
  const empty = {
    synthetic: false,
    reason: null,
    sample: positions.slice(0, 8),
    sharedX: null,
    field_count: positions.length,
  };

  if (positions.length < minFields) {
    return empty;
  }

  // Group by page
  const byPage = new Map();
  for (const p of positions) {
    const list = byPage.get(p.page) || [];
    list.push(p);
    byPage.set(p.page, list);
  }

  for (const [, pagePositions] of byPage) {
    if (pagePositions.length < minFields) continue;

    // Dominant X: at least minFields share essentially the same X
    const xBuckets = [];
    for (const p of pagePositions) {
      let bucket = xBuckets.find((b) => nearlyEqual(b.x, p.x));
      if (!bucket) {
        bucket = { x: p.x, items: [] };
        xBuckets.push(bucket);
      }
      bucket.items.push(p);
    }
    xBuckets.sort((a, b) => b.items.length - a.items.length);
    const dominant = xBuckets[0];
    if (!dominant || dominant.items.length < minFields) continue;

    // Prefer PDF-point-sized X (invented columns); large 2x-pixel X is OK
    // only if Y is also a regular stack with almost no X spread.
    const looksLikePdfPoints = dominant.x <= 650;

    const ys = dominant.items.map((p) => p.y).sort((a, b) => b - a);
    const gaps = [];
    for (let i = 1; i < ys.length; i += 1) {
      gaps.push(Math.round((ys[i - 1] - ys[i]) * 10) / 10);
    }
    const positiveGaps = gaps.filter((g) => g > 0.5);
    if (positiveGaps.length < minFields - 1) continue;

    // Regular step (e.g. every 50pt) — hallmark of invented columns
    const stepCounts = new Map();
    for (const g of positiveGaps) {
      const key = Math.round(g);
      stepCounts.set(key, (stepCounts.get(key) || 0) + 1);
    }
    let bestStep = 0;
    let bestCount = 0;
    for (const [step, count] of stepCounts) {
      if (count > bestCount) {
        bestStep = step;
        bestCount = count;
      }
    }
    const regular =
      bestStep >= 20 &&
      bestCount >= Math.max(3, Math.floor(positiveGaps.length * 0.5));

    // Almost no horizontal spread on the page
    const uniqueX = xBuckets.filter((b) => b.items.length > 0).length;
    const columnOnly = uniqueX <= 2 && dominant.items.length / pagePositions.length >= 0.7;

    if (looksLikePdfPoints && regular && columnOnly) {
      return {
        synthetic: true,
        reason: `vertical_column_x=${dominant.x}_step≈${bestStep}`,
        sample: dominant.items.slice(0, 8).map((p) => ({
          page: p.page,
          x: p.x,
          y: p.y,
        })),
        sharedX: dominant.x,
        field_count: positions.length,
      };
    }
  }

  return empty;
}

/**
 * @param {object} templateData
 * @returns {boolean}
 */
export function hasSyntheticTemplatePositions(templateData) {
  return analyzeTemplatePositionQuality(templateData).synthetic;
}
