/**
 * Remove all position objects from a template schema (mutates).
 * @param {object} templateData
 */
export function clearTemplatePositions(templateData) {
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.type && node.position) {
      delete node.position;
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
