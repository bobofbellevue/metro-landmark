/**
 * Filter internal identity / FK fields out of lease template schemas and
 * document_data so users can edit display values without changing parties,
 * property, or unit identities.
 */

const INTERNAL_ID_KEYS = new Set([
  'landlord_id',
  'unit_id',
  'property_id',
  'client_id',
  'user_id',
  'lease_id',
  'pmc_id',
  'manager_id',
  'template_id',
  'document_id',
  'workflow_id',
  'tenant_id',
  'application_id',
]);

const SCHEMA_META_KEYS = new Set([
  'type',
  'description',
  'position',
  'items',
  'properties',
  'required',
  'format',
  'enum',
  'default',
  'title',
  'sensitive',
]);

/**
 * @param {string} key
 * @returns {boolean}
 */
export function isInternalTemplateFieldKey(key) {
  if (!key || typeof key !== 'string') return false;
  const normalized = key.trim().toLowerCase();
  if (INTERNAL_ID_KEYS.has(normalized)) return true;
  if (
    /(_id|id)$/i.test(normalized) &&
    /^(landlord|unit|property|client|user|lease|pmc|manager|template|document|workflow|tenant|application)/i.test(
      normalized
    )
  ) {
    return true;
  }
  return false;
}

/**
 * Deep-clone template schema with internal id fields removed.
 * @param {unknown} templateData
 * @returns {unknown}
 */
export function stripInternalIdFieldsFromTemplate(templateData) {
  if (Array.isArray(templateData)) {
    return templateData.map((item) => stripInternalIdFieldsFromTemplate(item));
  }
  if (!templateData || typeof templateData !== 'object') {
    return templateData;
  }

  const result = {};
  for (const [key, value] of Object.entries(templateData)) {
    if (SCHEMA_META_KEYS.has(key)) {
      result[key] = value;
      continue;
    }
    if (isInternalTemplateFieldKey(key)) {
      continue;
    }
    if (value && typeof value === 'object') {
      if (value.properties) {
        result[key] = {
          ...value,
          properties: stripInternalIdFieldsFromTemplate(value.properties),
          ...(value.items
            ? { items: stripInternalIdFieldsFromTemplate(value.items) }
            : {}),
        };
      } else if (value.items) {
        result[key] = {
          ...value,
          items: stripInternalIdFieldsFromTemplate(value.items),
        };
      } else if (value.type || value.description || value.position) {
        result[key] = value;
      } else {
        result[key] = stripInternalIdFieldsFromTemplate(value);
      }
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Remove internal id keys from a nested document_data object.
 * @param {unknown} data
 * @returns {unknown}
 */
export function stripInternalIdFieldsFromDocumentData(data) {
  if (Array.isArray(data)) {
    return data.map((item) => stripInternalIdFieldsFromDocumentData(item));
  }
  if (!data || typeof data !== 'object') {
    return data;
  }
  const result = {};
  for (const [key, value] of Object.entries(data)) {
    if (isInternalTemplateFieldKey(key)) continue;
    result[key] =
      value && typeof value === 'object'
        ? stripInternalIdFieldsFromDocumentData(value)
        : value;
  }
  return result;
}

/**
 * Make every field optional in a template schema (Fill Lease behavior).
 * @param {unknown} templateData
 * @returns {unknown}
 */
export function makeAllFieldsOptional(templateData) {
  if (!templateData || typeof templateData !== 'object') {
    return templateData;
  }

  if (Array.isArray(templateData)) {
    return templateData.map((item) => makeAllFieldsOptional(item));
  }

  const result = {};
  for (const [key, value] of Object.entries(templateData)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (
        'type' in value ||
        'properties' in value ||
        'items' in value ||
        'description' in value
      ) {
        result[key] = {
          ...value,
          required: false,
        };
        if (value.properties) {
          result[key].properties = makeAllFieldsOptional(value.properties);
        }
        if (value.items) {
          result[key].items = makeAllFieldsOptional(value.items);
        }
      } else {
        result[key] = makeAllFieldsOptional(value);
      }
    } else {
      result[key] = value;
    }
  }
  return result;
}
