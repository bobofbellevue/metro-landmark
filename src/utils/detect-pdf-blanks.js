/**
 * Deterministic blank detection from PDF text geometry (pdf.js).
 * Form blanks on NWMLS-style leases are usually gaps between text runs;
 * some are underscore glyphs or a blank line immediately under a label.
 */

/**
 * @typedef {{ str: string, x: number, y: number, w: number }} TextItem
 * @typedef {{
 *   page: number,
 *   xPdf: number,
 *   yPdf: number,
 *   xPx: number,
 *   yPx: number,
 *   widthPdf: number,
 *   leftLabel: string,
 *   rightLabel: string,
 *   kind?: 'mid_gap' | 'trailing' | 'next_line' | 'underscore',
 * }} DetectedBlank
 */

/**
 * Find horizontal gaps / underscore / next-line blanks that look like fill-ins.
 *
 * @param {TextItem[]} items - pdf.js text items (transform already flattened to x/y/w)
 * @param {{ pageIndex?: number, pageWidth?: number, pageHeight?: number, scale?: number, minGap?: number }} [opts]
 * @returns {DetectedBlank[]}
 */
export function detectBlanksFromTextItems(items, opts = {}) {
  const pageIndex = opts.pageIndex ?? 0;
  const pageWidth = opts.pageWidth ?? 612;
  const pageHeight = opts.pageHeight ?? 792;
  const scale = opts.scale ?? 2;
  const minGap = opts.minGap ?? 42;
  const rightMargin = pageWidth - 36;
  const contentLeft = 72;

  const normalized = (items || [])
    .filter((i) => i && typeof i.str === 'string' && i.str.trim())
    .map((i) => ({
      str: i.str,
      x: Number(i.x),
      y: Number(i.y),
      w: Number(i.w) || 0,
    }))
    .filter((i) => Number.isFinite(i.x) && Number.isFinite(i.y));

  /** @type {Map<number, typeof normalized>} */
  const byY = new Map();
  for (const it of normalized) {
    const key = Math.round(it.y / 2) * 2;
    if (!byY.has(key)) byY.set(key, []);
    byY.get(key).push(it);
  }

  /** @type {DetectedBlank[]} */
  const blanks = [];

  const pushBlank = (blank) => {
    blanks.push({
      ...blank,
      xPx: blank.xPdf * scale,
      yPx: (pageHeight - blank.yPdf) * scale,
    });
  };

  // Underscore glyph runs (when the form encodes blanks as "_" text)
  for (const it of normalized) {
    const trimmed = it.str.trim();
    if (!/^[_‐\-.]{4,}$/.test(trimmed) && !/_{6,}/.test(trimmed)) continue;
    if (isHeaderNoise(trimmed, '', it.y, pageHeight)) continue;
    pushBlank({
      page: pageIndex,
      xPdf: it.x + 2,
      yPdf: it.y,
      widthPdf: Math.max(it.w, trimmed.length * 4),
      leftLabel: '',
      rightLabel: '[underscore]',
      kind: 'underscore',
    });
  }

  const rowYs = [...byY.keys()].sort((a, b) => b - a);
  const rowSpacingSamples = [];
  for (let i = 0; i < rowYs.length - 1; i += 1) {
    const gap = rowYs[i] - rowYs[i + 1];
    if (gap >= 8 && gap <= 22) rowSpacingSamples.push(gap);
  }
  const typicalLineHeight =
    rowSpacingSamples.length > 0
      ? rowSpacingSamples.sort((a, b) => a - b)[
          Math.floor(rowSpacingSamples.length / 2)
        ]
      : 14;

  for (let rowIndex = 0; rowIndex < rowYs.length; rowIndex += 1) {
    const y = rowYs[rowIndex];
    const row = byY.get(y);
    row.sort((a, b) => a.x - b.x);
    const rowText = row.map((t) => t.str).join(' ').replace(/\s+/g, ' ').trim();
    const invitesNextLine = invitesNextLineBlank(rowText);
    let midGapCount = 0;

    for (let i = 0; i < row.length - 1; i += 1) {
      const left = row[i];
      const right = row[i + 1];
      const gapStart = left.x + left.w;
      const gapEnd = right.x;
      const gapW = gapEnd - gapStart;
      if (gapW < minGap) continue;

      // Full-row context so cues like "NSF" on the right still match
      const leftLabel = row
        .slice(0, i + 1)
        .map((t) => t.str)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      let rightLabel = row
        .slice(i + 1)
        .map((t) => t.str)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();

      const lineNumberAtMargin =
        /^\d{1,3}$/.test(right.str.trim()) && gapEnd > pageWidth - 100;
      if (lineNumberAtMargin) {
        rightLabel = '[line#]';
      }

      if (isHeaderNoise(leftLabel, rightLabel, y, pageHeight)) continue;
      if (lineNumberAtMargin && gapW < minGap) continue;

      midGapCount += 1;
      pushBlank({
        page: pageIndex,
        xPdf: gapStart + 3,
        yPdf: y,
        widthPdf: gapW,
        leftLabel,
        rightLabel,
        kind: 'mid_gap',
      });
    }

    // Trailing blank to right margin — skip when the blank clearly belongs
    // on the next line (e.g. "named persons:") or the line already has a
    // mid-gap fill-in / ends a wrapped sentence.
    const last = row[row.length - 1];
    const trailStart = last.x + last.w;
    const trailW = rightMargin - trailStart;
    const lastText = last.str.trim();
    const endsCompleteSentence = /\.\s*$/.test(rowText);
    const skipTrailing =
      invitesNextLine ||
      endsCompleteSentence ||
      (midGapCount > 0 && trailW < 200);

    if (
      !skipTrailing &&
      trailW >= Math.max(minGap, 80) &&
      !/^\d{1,3}$/.test(lastText)
    ) {
      if (!isHeaderNoise(rowText || lastText, '[margin]', y, pageHeight)) {
        pushBlank({
          page: pageIndex,
          xPdf: trailStart + 3,
          yPdf: y,
          widthPdf: trailW,
          leftLabel: rowText || lastText,
          rightLabel: '[margin]',
          kind: 'trailing',
        });
      }
    }

    // Next-line blank: label ends with ":" / "named persons" and the
    // following visual line is underscore-only, sparse, or missing.
    if (invitesNextLine) {
      const nextBlank = findNextLineBlank({
        rowYs,
        rowIndex,
        byY,
        y,
        typicalLineHeight,
        contentLeft,
        pageWidth,
        rowText,
      });
      if (nextBlank) {
        pushBlank({
          page: pageIndex,
          ...nextBlank,
          leftLabel: rowText,
          rightLabel: '[next-line]',
          kind: 'next_line',
        });
      }
    }
  }

  // Attach nearby row context to underscore-only blanks (empty leftLabel)
  attachContextToUnderscoreBlanks(blanks, byY);

  blanks.sort((a, b) => b.yPdf - a.yPdf || a.xPdf - b.xPdf);
  return blanks;
}

/**
 * Labels that introduce a fill-in blank on the following line rather than
 * at the end of the current sentence.
 * @param {string} rowText
 * @returns {boolean}
 */
export function invitesNextLineBlank(rowText) {
  const text = String(rowText || '').trim();
  if (!text) return false;
  if (/named persons\s*:?\s*$/i.test(text)) return true;
  if (/private residence only for the following/i.test(text)) return true;
  if (/the following (named )?(persons|occupants|tenants)\s*:?\s*$/i.test(text)) {
    return true;
  }
  if (/as follows\s*:\s*$/i.test(text)) return true;
  if (/listed below\s*:\s*$/i.test(text)) return true;
  // Generic: line ends with a colon and reads like a prompt
  if (/:\s*$/.test(text) && text.length >= 20) return true;
  return false;
}

function findNextLineBlank({
  rowYs,
  rowIndex,
  byY,
  y,
  typicalLineHeight,
  contentLeft,
  pageWidth,
  rowText,
}) {
  const nextY = rowYs[rowIndex + 1];
  const expectedY = y - typicalLineHeight;

  if (nextY != null) {
    const gap = y - nextY;
    // Immediately next text row
    if (gap >= typicalLineHeight * 0.55 && gap <= typicalLineHeight * 1.75) {
      const nextRow = [...byY.get(nextY)].sort((a, b) => a.x - b.x);
      const nextJoined = nextRow.map((t) => t.str).join('').trim();
      const underscoreOnly =
        nextRow.length > 0 &&
        nextRow.every((t) => /^[_‐\-.\s]+$/.test(t.str)) &&
        /[_‐\-]{4,}/.test(nextJoined);
      const sparse =
        nextRow.reduce((sum, t) => sum + (t.w || 0), 0) < 50 &&
        nextJoined.length < 8;

      if (underscoreOnly) {
        const startX = Math.min(...nextRow.map((t) => t.x));
        const endX = Math.max(...nextRow.map((t) => t.x + t.w));
        return {
          xPdf: startX + 2,
          yPdf: nextY,
          widthPdf: Math.max(endX - startX, 120),
        };
      }
      if (sparse) {
        return {
          xPdf: contentLeft,
          yPdf: nextY,
          widthPdf: Math.max(pageWidth - contentLeft - 72, 200),
        };
      }
    }

    // Missing text row between this label and the next content (underline
    // drawn as vector art with no "_" glyphs).
    if (gap >= typicalLineHeight * 1.6 && gap <= typicalLineHeight * 3.2) {
      return {
        xPdf: contentLeft,
        yPdf: expectedY,
        widthPdf: Math.max(pageWidth - contentLeft - 72, 200),
      };
    }
  } else {
    // Last content row — still allow a blank line below the prompt
    return {
      xPdf: contentLeft,
      yPdf: expectedY,
      widthPdf: Math.max(pageWidth - contentLeft - 72, 200),
    };
  }

  void rowText;
  return null;
}

function attachContextToUnderscoreBlanks(blanks, byY) {
  const rowYs = [...byY.keys()].sort((a, b) => b - a);
  for (const blank of blanks) {
    if (blank.kind !== 'underscore') continue;
    if (blank.leftLabel) continue;
    // Prefer the text row immediately above this underscore
    const aboveY = rowYs.find((y) => y > blank.yPdf + 4 && y < blank.yPdf + 28);
    if (aboveY == null) continue;
    const row = byY.get(aboveY) || [];
    blank.leftLabel = row
      .map((t) => t.str)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}

function isHeaderNoise(left, right, y, pageHeight) {
  // Top ~1.25" of page is form chrome on NWMLS (title / copyright / page #)
  if (y > pageHeight - 95) {
    if (/NWMLS|Copyright|Listing Service|ALL RIGHTS|Page \d|Rev\.|LEASE\s*\/\s*RENTAL/i.test(left)) {
      return true;
    }
    if (/Copyright|Listing Service|ALL RIGHTS|LEASE\s*\/\s*RENTAL/i.test(right)) {
      return true;
    }
  }
  return false;
}

/**
 * Flatten pdf.js TextContent items into {str,x,y,w}.
 * @param {object} textContent
 * @returns {TextItem[]}
 */
export function flattenPdfJsTextItems(textContent) {
  return (textContent?.items || [])
    .filter((i) => i && typeof i.str === 'string')
    .map((i) => ({
      str: i.str,
      x: i.transform?.[4] ?? 0,
      y: i.transform?.[5] ?? 0,
      w: i.width ?? 0,
    }));
}

/**
 * Detect blanks across all pages of a PDF File / ArrayBuffer.
 *
 * @param {File|Blob|ArrayBuffer|Uint8Array} pdfSource
 * @param {{ scale?: number, minGap?: number }} [opts]
 * @returns {Promise<DetectedBlank[]>}
 */
export async function detectBlanksFromPdf(pdfSource, opts = {}) {
  const pdfjs = await import('pdfjs-dist');
  if (pdfjs.GlobalWorkerOptions && !pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.394/build/pdf.worker.min.mjs`;
  }

  let data;
  if (pdfSource instanceof ArrayBuffer) {
    data = new Uint8Array(pdfSource);
  } else if (ArrayBuffer.isView(pdfSource)) {
    data = new Uint8Array(pdfSource.buffer, pdfSource.byteOffset, pdfSource.byteLength);
  } else if (typeof Blob !== 'undefined' && pdfSource instanceof Blob) {
    data = new Uint8Array(await pdfSource.arrayBuffer());
  } else {
    throw new Error('Unsupported PDF source for blank detection');
  }

  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
  const scale = opts.scale ?? 2;
  const all = [];

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum += 1) {
    const page = await doc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1 });
    const textContent = await page.getTextContent();
    const items = flattenPdfJsTextItems(textContent);
    const blanks = detectBlanksFromTextItems(items, {
      pageIndex: pageNum - 1,
      pageWidth: viewport.width,
      pageHeight: viewport.height,
      scale,
      minGap: opts.minGap,
    });
    all.push(...blanks);
  }

  return all;
}
