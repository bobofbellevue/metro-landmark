/**
 * Normalize JSON structure while preserving the original key order.
 * This keeps the document sections in the order they were authored while
 * still returning plain objects/arrays without undefined values.
 */
export function normalizeJSON(obj) {
  if (obj === null || obj === undefined) {
    return obj;
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => normalizeJSON(item));
  }
  
  if (typeof obj === 'object') {
    const normalized = {};
    
    for (const key of Object.keys(obj)) {
      normalized[key] = normalizeJSON(obj[key]);
    }
    
    return normalized;
  }
  
  return obj;
}

/**
 * Normalize a JSON string by parsing, normalizing, and stringifying
 * @param {string} jsonString - JSON string to normalize
 * @param {number} indent - Indentation for stringify (default: 2)
 * @returns {string} - Normalized JSON string
 */
export function normalizeJSONString(jsonString, indent = 2) {
  try {
    const parsed = JSON.parse(jsonString);
    const normalized = normalizeJSON(parsed);
    return JSON.stringify(normalized, null, indent);
  } catch (error) {
    throw new Error(`Invalid JSON: ${error.message}`);
  }
}

