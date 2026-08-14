/**
 * Template field positions are captured from 2x-scale page images with a
 * top-left origin (see api/documents/convert-pdf-to-json.js and
 * src/utils/detect-pdf-blanks.js).
 *
 * pdf-lib uses PDF points with a bottom-left origin. Image-based generation
 * draws in pixel space on the 2x canvas then scales the page by 1/2.
 * PDF overlay must convert explicitly.
 */

/**
 * @param {{ page?: number, x?: number, y?: number, space?: string }|null|undefined} position
 * @param {{ width: number, height: number }} pageSize PDF page size in points
 * @returns {boolean}
 */
export function positionLooksLikeImagePixels(position, pageSize = {}) {
  if (!position || typeof position !== 'object') return false;
  if (position.space === 'image_2x' || position.space === 'pixels') return true;

  const rawX = Number(position.x);
  const rawY = Number(position.y);
  if (!Number.isFinite(rawX) || !Number.isFinite(rawY)) return false;

  const width = Number(pageSize?.width) || 612;
  const height = Number(pageSize?.height) || 792;

  // 2x US Letter is ~1224×1584. Any coord past the PDF page size is decisive.
  return rawX > width || rawY > height || rawX > 650 || rawY > 850;
}

/**
 * If ANY field is clearly in 2x image space, treat the whole template that way.
 * Top-of-page blanks have small pixel Y (e.g. 256) and look like PDF points when
 * judged alone — that left Agreement_Date/Lessor unconverted while Rent worked.
 *
 * @param {object} templateData
 * @param {{ width: number, height: number }} [pageSize]
 * @returns {boolean}
 */
export function templateUsesImagePixelPositions(templateData, pageSize = {}) {
  let found = false;
  const walk = (node) => {
    if (found || !node || typeof node !== 'object') return;
    if (node.type && node.position) {
      if (positionLooksLikeImagePixels(node.position, pageSize)) {
        found = true;
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
  return found;
}

/**
 * @param {{ page?: number, x?: number, y?: number, space?: string }|null|undefined} position
 * @param {{ width: number, height: number }} pageSize PDF page size in points
 * @param {{ forceImagePixels?: boolean }} [options]
 * @returns {{ pageIndex: number, x: number, y: number, convertedFromPixels: boolean }|null}
 */
export function resolveTemplateFieldPosition(position, pageSize, options = {}) {
  if (!position || typeof position !== 'object') return null;

  const pageIndex =
    typeof position.page === 'number' && Number.isFinite(position.page)
      ? position.page
      : 0;
  const rawX = Number(position.x);
  const rawY = Number(position.y);
  if (!Number.isFinite(rawX) || !Number.isFinite(rawY)) return null;

  const width = Number(pageSize?.width) || 612;
  const height = Number(pageSize?.height) || 792;

  const looksLike2xPixels =
    options.forceImagePixels === true ||
    positionLooksLikeImagePixels(position, pageSize);

  if (looksLike2xPixels) {
    return {
      pageIndex,
      x: rawX / 2,
      // Image Y is distance from top; PDF Y is distance from bottom.
      y: height - rawY / 2,
      convertedFromPixels: true,
    };
  }

  return {
    pageIndex,
    x: rawX,
    y: rawY,
    convertedFromPixels: false,
  };
}
