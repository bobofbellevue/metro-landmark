/* eslint-env node */
/**
 * Helpers for listing template schema leaf fields and applying measured positions.
 */

function isMetaKey(key) {
  return typeof key === 'string' && key.startsWith('_');
}

function leafFieldRecord(path, node, fallbackName) {
  return {
    path,
    type: node.type,
    description: node.description || fallbackName || path.split('.').pop() || path,
    position: node.position && typeof node.position === 'object' ? node.position : null,
  };
}

/**
 * @param {object} templateData
 * @returns {Array<{ path: string, type: string, description: string, position: object|null }>}
 */
export function listTemplateLeafFields(templateData) {
  const fields = [];

  const walk = (node, pathPrefix) => {
    if (!node || typeof node !== 'object') return;

    if (node.type === 'array' && node.items?.properties) {
      walk(node.items.properties, pathPrefix ? `${pathPrefix}[]` : '[]');
      return;
    }

    if (node.type && (node.position || node.description !== undefined || node.items)) {
      // Leaf-ish field definition (may still be array/object typed)
      if (node.type !== 'object' || !node.properties) {
        fields.push(leafFieldRecord(pathPrefix, node, pathPrefix.split('.').pop()));
        return;
      }
    }

    for (const [key, value] of Object.entries(node)) {
      if (isMetaKey(key)) continue;
      if (!value || typeof value !== 'object') continue;
      const nextPath = pathPrefix ? `${pathPrefix}.${key}` : key;

      if (value.type === 'array' && value.items?.properties) {
        // Record the array itself only if it has a position; otherwise walk items
        if (value.position) {
          fields.push(leafFieldRecord(nextPath, value, key));
        }
        walk(value.items.properties, `${nextPath}[]`);
        continue;
      }

      if (value.type && value.type !== 'object') {
        fields.push(leafFieldRecord(nextPath, value, key));
        continue;
      }

      if (value.type === 'object' && value.properties) {
        walk(value.properties, nextPath);
        continue;
      }

      if (!value.type) {
        walk(value, nextPath);
      }
    }
  };

  walk(templateData, '');
  return fields.filter((f) => f.path);
}

/**
 * Resolve the parent object and leaf key for a dotted path (supports `[]`).
 * @param {object} templateData
 * @param {string} path
 * @returns {{ parent: object, key: string }|null}
 */
export function resolveLeafParent(templateData, path) {
  if (!templateData || !path) return null;
  const parts = path.split('.').filter(Boolean);
  let node = templateData;

  for (let i = 0; i < parts.length; i += 1) {
    let key = parts[i];
    const isArrayItems = key.endsWith('[]');
    if (isArrayItems) key = key.slice(0, -2);

    if (!node || typeof node !== 'object') return null;

    if (isArrayItems) {
      const arrNode = node[key];
      if (!arrNode?.items?.properties) return null;
      node = arrNode.items.properties;
      continue;
    }

    if (i === parts.length - 1) {
      if (!node[key] || typeof node[key] !== 'object') return null;
      return { parent: node, key };
    }

    node = node[key];
  }
  return null;
}

/**
 * Resolve a container object for adding fields (`Lease` or `Lease.Applicants[]`).
 * Empty path returns the root schema object.
 * @param {object} templateData
 * @param {string} [path]
 * @returns {object|null}
 */
export function resolveFieldContainer(templateData, path = '') {
  if (!templateData || typeof templateData !== 'object') return null;
  if (!path) return templateData;
  const parts = path.split('.').filter(Boolean);
  let node = templateData;
  for (const part of parts) {
    let key = part;
    const isArrayItems = key.endsWith('[]');
    if (isArrayItems) key = key.slice(0, -2);
    if (!node || typeof node !== 'object') return null;
    if (isArrayItems) {
      if (!node[key]?.items?.properties) return null;
      node = node[key].items.properties;
    } else {
      if (!node[key] || typeof node[key] !== 'object') return null;
      node = node[key];
    }
  }
  return node;
}

function mergePosition(existing, position) {
  const prev =
    existing && typeof existing === 'object' ? { ...existing } : {};
  const next = {
    ...prev,
    page: position.page,
    x: position.x,
    y: position.y,
  };
  if (position.space) next.space = position.space;
  if (Number.isFinite(Number(position.width)) && Number(position.width) > 0) {
    next.width = Number(position.width);
  }
  if (Number.isFinite(Number(position.height)) && Number(position.height) > 0) {
    next.height = Number(position.height);
  }
  return next;
}

/**
 * Set position on a field by dotted path (supports `[]` for array item props).
 * Merges width/height/space onto any existing position.
 * @param {object} templateData
 * @param {string} path
 * @param {{ page: number, x: number, y: number, width?: number, height?: number, space?: string }} position
 * @returns {boolean}
 */
export function setFieldPositionByPath(templateData, path, position) {
  if (!templateData || !path || !position) return false;
  const resolved = resolveLeafParent(templateData, path);
  if (!resolved) return false;
  const { parent, key } = resolved;
  parent[key] = {
    ...parent[key],
    position: mergePosition(parent[key].position, position),
  };
  return true;
}

/**
 * Apply measured positions onto a schema (mutates and returns it).
 * @param {object} templateData
 * @param {Array<{ path: string, position: { page: number, x: number, y: number } }>} measurements
 * @returns {{ applied: number, templateData: object }}
 */
export function applyMeasuredPositions(templateData, measurements) {
  let applied = 0;
  for (const item of measurements || []) {
    if (!item?.path || !item?.position) continue;
    const { page, x, y } = item.position;
    if (
      typeof page !== 'number' ||
      typeof x !== 'number' ||
      typeof y !== 'number' ||
      !Number.isFinite(page) ||
      !Number.isFinite(x) ||
      !Number.isFinite(y)
    ) {
      continue;
    }
    if (setFieldPositionByPath(templateData, item.path, { page, x, y })) {
      applied += 1;
    }
  }
  return { applied, templateData };
}

/**
 * Offset every field position.page by pageOffset (for batched schema merges).
 * @param {object} templateData
 * @param {number} pageOffset
 */
export function offsetTemplatePositionPages(templateData, pageOffset) {
  if (!pageOffset) return templateData;
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.type && node.position && typeof node.position === 'object') {
      if (typeof node.position.page === 'number') {
        node.position.page += pageOffset;
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
  return templateData;
}
