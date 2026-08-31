/* eslint-env node */
/**
 * Operator placement editor helpers: add/rename/remove fields, box geometry,
 * and marking auto-detect positions as operator-approved truth.
 */
import {
  listTemplateLeafFields,
  resolveFieldContainer,
  resolveLeafParent,
  setFieldPositionByPath,
} from './template-field-paths.js';

export const PLACEMENT_META_KEY = '_placement';
export const PLACEMENT_SPACE = 'image_2x';
export const DEFAULT_FIELD_BOX = { width: 180, height: 28 };
export const BOOLEAN_FIELD_BOX = { width: 28, height: 28 };
export const MIN_FIELD_BOX = { width: 16, height: 16 };
export const FIELD_TYPES = ['string', 'date', 'number', 'boolean', 'currency'];

const RESERVED_FIELD_KEYS = new Set([
  PLACEMENT_META_KEY,
  'type',
  'items',
  'properties',
  'required',
  'position',
  'description',
]);

/**
 * @param {unknown} data
 * @returns {object}
 */
export function cloneTemplateData(data) {
  return JSON.parse(JSON.stringify(data ?? {}));
}

/**
 * @param {unknown} name
 * @returns {string}
 */
export function sanitizeFieldKey(name) {
  const cleaned = String(name || '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9_]/g, '')
    .replace(/^(\d)/, 'F_$1');
  return cleaned || 'Field';
}

function uniqueKeyIn(container, desired) {
  const base = sanitizeFieldKey(desired);
  if (!RESERVED_FIELD_KEYS.has(base) && container[base] === undefined) return base;
  let n = 2;
  while (container[`${base}_${n}`] !== undefined || RESERVED_FIELD_KEYS.has(`${base}_${n}`)) {
    n += 1;
  }
  return `${base}_${n}`;
}

/**
 * Prefer the single untyped top-level section (e.g. `Lease`) as the add target.
 * @param {object} templateData
 * @returns {string}
 */
export function defaultPlacementParentPath(templateData) {
  if (!templateData || typeof templateData !== 'object') return '';
  const keys = Object.keys(templateData).filter((k) => !k.startsWith('_'));
  if (keys.length === 1) {
    const only = templateData[keys[0]];
    if (only && typeof only === 'object' && !only.type) return keys[0];
  }
  return '';
}

/**
 * @param {string} [type]
 * @returns {{ width: number, height: number }}
 */
export function boxSizeForType(type) {
  return type === 'boolean' ? { ...BOOLEAN_FIELD_BOX } : { ...DEFAULT_FIELD_BOX };
}

/**
 * @param {object|null|undefined} position
 * @param {string} [type]
 * @returns {{ page: number, x: number, y: number, width: number, height: number, space: string }|null}
 */
export function normalizePlacementBox(position, type) {
  if (!position || typeof position !== 'object') return null;
  const x = Number(position.x);
  const y = Number(position.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const defaults = boxSizeForType(type);
  const page = Number.isFinite(Number(position.page)) ? Number(position.page) : 0;
  const width =
    Number.isFinite(Number(position.width)) && Number(position.width) > 0
      ? Number(position.width)
      : defaults.width;
  const height =
    Number.isFinite(Number(position.height)) && Number(position.height) > 0
      ? Number(position.height)
      : defaults.height;
  return {
    page,
    x,
    y,
    width,
    height,
    space: position.space || PLACEMENT_SPACE,
  };
}

/**
 * @param {object} templateData
 * @returns {Array<{ path: string, type: string, description: string, box: object|null }>}
 */
export function listPlacementFields(templateData) {
  return listTemplateLeafFields(templateData).map((field) => ({
    ...field,
    box: normalizePlacementBox(field.position, field.type),
  }));
}

/**
 * @param {object} box
 * @param {'move'|'n'|'s'|'e'|'w'|'ne'|'nw'|'se'|'sw'} handle
 * @param {number} dx
 * @param {number} dy
 * @param {number} pageWidth
 * @param {number} pageHeight
 * @returns {object}
 */
export function applyBoxDelta(box, handle, dx, dy, pageWidth, pageHeight) {
  let x = Number(box.x) || 0;
  let y = Number(box.y) || 0;
  let width = Number(box.width) || MIN_FIELD_BOX.width;
  let height = Number(box.height) || MIN_FIELD_BOX.height;
  const maxW = Number.isFinite(pageWidth) && pageWidth > 0 ? pageWidth : 1224;
  const maxH = Number.isFinite(pageHeight) && pageHeight > 0 ? pageHeight : 1584;

  if (handle === 'move') {
    x += dx;
    y += dy;
  } else {
    if (handle.includes('n')) {
      y += dy;
      height -= dy;
    }
    if (handle.includes('s')) {
      height += dy;
    }
    if (handle.includes('w')) {
      x += dx;
      width -= dx;
    }
    if (handle.includes('e')) {
      width += dx;
    }
  }

  if (width < MIN_FIELD_BOX.width) {
    if (handle.includes('w')) x -= MIN_FIELD_BOX.width - width;
    width = MIN_FIELD_BOX.width;
  }
  if (height < MIN_FIELD_BOX.height) {
    if (handle.includes('n')) y -= MIN_FIELD_BOX.height - height;
    height = MIN_FIELD_BOX.height;
  }

  x = Math.max(0, Math.min(x, maxW - width));
  y = Math.max(0, Math.min(y, maxH - height));
  width = Math.min(width, maxW - x);
  height = Math.min(height, maxH - y);

  return {
    ...box,
    page: box.page ?? 0,
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
    space: box.space || PLACEMENT_SPACE,
  };
}

/**
 * @param {number} clientX
 * @param {number} clientY
 * @param {{ left: number, top: number, width: number, height: number }} rect
 * @param {number} naturalWidth
 * @param {number} naturalHeight
 * @returns {{ x: number, y: number }|null}
 */
export function clientPointToImageCoords(
  clientX,
  clientY,
  rect,
  naturalWidth,
  naturalHeight
) {
  if (!rect || rect.width <= 0 || rect.height <= 0) return null;
  if (!Number.isFinite(naturalWidth) || !Number.isFinite(naturalHeight)) return null;
  const x = ((clientX - rect.left) / rect.width) * naturalWidth;
  const y = ((clientY - rect.top) / rect.height) * naturalHeight;
  return {
    x: Math.round(Math.max(0, Math.min(naturalWidth, x))),
    y: Math.round(Math.max(0, Math.min(naturalHeight, y))),
  };
}

/**
 * @param {object} templateData
 * @returns {boolean}
 */
export function isPlacementApproved(templateData) {
  return Boolean(
    templateData &&
      typeof templateData === 'object' &&
      templateData[PLACEMENT_META_KEY]?.approved === true
  );
}

/**
 * @param {object} templateData
 * @param {Date|string} [when]
 * @returns {object}
 */
export function markPlacementApproved(templateData, when = new Date()) {
  if (!templateData || typeof templateData !== 'object') return templateData;
  templateData[PLACEMENT_META_KEY] = {
    approved: true,
    source: 'operator',
    approved_at: when instanceof Date ? when.toISOString() : String(when),
  };
  return templateData;
}

/**
 * @param {object} templateData
 * @returns {object}
 */
export function clearPlacementApproval(templateData) {
  if (templateData && typeof templateData === 'object') {
    delete templateData[PLACEMENT_META_KEY];
  }
  return templateData;
}

/**
 * @param {object} templateData
 * @param {string} path
 * @param {{ type?: string, description?: string }} meta
 * @returns {boolean}
 */
export function setFieldMetaByPath(templateData, path, meta) {
  const resolved = resolveLeafParent(templateData, path);
  if (!resolved) return false;
  const next = { ...resolved.parent[resolved.key] };
  if (meta.type) next.type = meta.type;
  if (meta.description !== undefined) next.description = meta.description;
  resolved.parent[resolved.key] = next;
  return true;
}

/**
 * @param {object} templateData
 * @param {string} path
 * @returns {boolean}
 */
export function removeFieldByPath(templateData, path) {
  const resolved = resolveLeafParent(templateData, path);
  if (!resolved) return false;
  delete resolved.parent[resolved.key];
  return true;
}

function rebuildParentWithRenamedKey(parent, oldKey, newKey) {
  const next = {};
  for (const [key, value] of Object.entries(parent)) {
    next[key === oldKey ? newKey : key] = value;
  }
  for (const key of Object.keys(parent)) delete parent[key];
  Object.assign(parent, next);
}

/**
 * Rename a field key. Returns the new path or null.
 * @param {object} templateData
 * @param {string} path
 * @param {string} newKey
 * @returns {string|null}
 */
export function renameFieldByPath(templateData, path, newKey) {
  const resolved = resolveLeafParent(templateData, path);
  if (!resolved) return null;
  const safe = sanitizeFieldKey(newKey);
  if (!safe || safe === resolved.key) return path;
  if (RESERVED_FIELD_KEYS.has(safe)) return null;
  if (resolved.parent[safe] !== undefined) return null;
  rebuildParentWithRenamedKey(resolved.parent, resolved.key, safe);
  const parts = path.split('.');
  parts[parts.length - 1] = safe;
  return parts.join('.');
}

/**
 * @param {object} templateData
 * @param {{ parentPath?: string, key: string, type?: string, description?: string, position?: object }} spec
 * @returns {{ path: string, key: string }|null}
 */
export function addTemplateField(templateData, spec) {
  if (!templateData || typeof templateData !== 'object' || !spec?.key) return null;
  const parentPath =
    spec.parentPath === undefined
      ? defaultPlacementParentPath(templateData)
      : spec.parentPath;
  const container = resolveFieldContainer(templateData, parentPath);
  if (!container) return null;
  const key = uniqueKeyIn(container, spec.key);
  const type = FIELD_TYPES.includes(spec.type) ? spec.type : 'string';
  const field = {
    type,
    description: spec.description || key.replace(/_/g, ' '),
  };
  if (spec.position) {
    field.position = normalizePlacementBox(spec.position, type) || spec.position;
  }
  container[key] = field;
  const path = parentPath ? `${parentPath}.${key}` : key;
  return { path, key };
}

/**
 * Place an unplaced field at image coordinates on a page.
 * @param {object} templateData
 * @param {string} path
 * @param {{ page: number, x: number, y: number, width?: number, height?: number }} point
 * @returns {boolean}
 */
export function placeFieldAtPoint(templateData, path, point) {
  const resolved = resolveLeafParent(templateData, path);
  if (!resolved || !point) return false;
  const type = resolved.parent[resolved.key]?.type;
  const size = boxSizeForType(type);
  return setFieldPositionByPath(templateData, path, {
    page: point.page ?? 0,
    x: point.x,
    y: point.y,
    width: point.width || size.width,
    height: point.height || size.height,
    space: PLACEMENT_SPACE,
  });
}
