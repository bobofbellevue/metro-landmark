/* eslint-env node */
/**
 * Helpers for listing template schema leaf fields and applying measured positions.
 */

/**
 * @param {object} templateData
 * @returns {Array<{ path: string, type: string, description: string }>}
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
        fields.push({
          path: pathPrefix,
          type: node.type,
          description: node.description || pathPrefix.split('.').pop() || pathPrefix,
        });
        return;
      }
    }

    for (const [key, value] of Object.entries(node)) {
      if (!value || typeof value !== 'object') continue;
      const nextPath = pathPrefix ? `${pathPrefix}.${key}` : key;

      if (value.type === 'array' && value.items?.properties) {
        // Record the array itself only if it has a position; otherwise walk items
        if (value.position) {
          fields.push({
            path: nextPath,
            type: value.type,
            description: value.description || key,
          });
        }
        walk(value.items.properties, `${nextPath}[]`);
        continue;
      }

      if (value.type && value.type !== 'object') {
        fields.push({
          path: nextPath,
          type: value.type,
          description: value.description || key,
        });
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
 * Set position on a field by dotted path (supports `[]` for array item props).
 * @param {object} templateData
 * @param {string} path
 * @param {{ page: number, x: number, y: number, space?: string }} position
 * @returns {boolean}
 */
export function setFieldPositionByPath(templateData, path, position) {
  if (!templateData || !path || !position) return false;
  const parts = path.split('.').filter(Boolean);
  let node = templateData;

  for (let i = 0; i < parts.length; i += 1) {
    let key = parts[i];
    const isArrayItems = key.endsWith('[]');
    if (isArrayItems) key = key.slice(0, -2);

    if (!node || typeof node !== 'object') return false;

    if (isArrayItems) {
      const arrNode = node[key];
      if (!arrNode?.items?.properties) return false;
      node = arrNode.items.properties;
      continue;
    }

    if (i === parts.length - 1) {
      if (!node[key] || typeof node[key] !== 'object') return false;
      const nextPosition = {
        page: position.page,
        x: position.x,
        y: position.y,
      };
      if (position.space) nextPosition.space = position.space;
      node[key] = {
        ...node[key],
        position: nextPosition,
      };
      return true;
    }

    node = node[key];
  }
  return false;
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
