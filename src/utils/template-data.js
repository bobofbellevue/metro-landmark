/**
 * Obtain the raw JSON string for a template, preserving author-provided ordering.
 * Falls back to stringifying the parsed object if no raw text is available.
 */
export function getTemplateDataString(template, fallback = '{\n\n}') {
  if (!template) {
    return fallback;
  }

  if (typeof template === 'string') {
    return template;
  }

  if (typeof template.template_data_raw === 'string' && template.template_data_raw.length > 0) {
    return template.template_data_raw;
  }

  const data = template.template_data;
  if (typeof data === 'string') {
    return data;
  }

  if (data && typeof data === 'object') {
    try {
      return JSON.stringify(data, null, 2);
    } catch (error) {
      console.error('Failed to stringify template_data object:', error);
      return fallback;
    }
  }

  return fallback;
}

/**
 * Parse template data into an object while respecting raw JSON ordering.
 */
export function parseTemplateData(template) {
  if (!template) {
    return {};
  }

  if (typeof template === 'string') {
    try {
      return JSON.parse(template);
    } catch (error) {
      console.error('Failed to parse template JSON string:', error);
      return {};
    }
  }

  if (typeof template.template_data_raw === 'string' && template.template_data_raw.length > 0) {
    try {
      return JSON.parse(template.template_data_raw);
    } catch (error) {
      console.error('Failed to parse template_data_raw:', error);
    }
  }

  const data = template.template_data;
  if (typeof data === 'string') {
    try {
      return JSON.parse(data);
    } catch (error) {
      console.error('Failed to parse template_data string:', error);
      return {};
    }
  }

  if (data && typeof data === 'object') {
    return data;
  }

  return {};
}

