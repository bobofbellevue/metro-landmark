/* eslint-env node */
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import {
  resolveTemplateFieldPosition,
  templateUsesImagePixelPositions,
} from '../../utils/template-field-position.js';

/**
 * Overlay data on an existing template PDF
 * Works for both Application and Lease templates
 * Requires field positions to be stored in template_data during template import
 * 
 * Coordinate System:
 * - Units: PDF points (1 point = 1/72 inch)
 * - Origin: Bottom-left corner of the page (0, 0)
 * - X-axis: Increases to the right (0 to page width)
 * - Y-axis: Increases upward from bottom (0 to page height)
 * - Standard US Letter: 612 points wide × 792 points tall (8.5" × 11")
 * 
 * Example: A field at the top-left of page 1 would have:
 *   position: { page: 0, x: 50, y: 750 }
 * 
 * @param {Uint8Array} templatePdfBytes - Original template PDF bytes
 * @param {Object} templateData - Template schema (JSONB from templates table) with position coordinates
 * @param {Object} formData - Data to populate (from lease/application data)
 * @param {Object} documentData - Filled data from Fill Lease/Application modal (may have more specific values)
 * @returns {Promise<Uint8Array>} PDF bytes with data overlaid
 */
export async function overlayDataOnTemplatePDF(templatePdfBytes, templateData, formData, documentData = {}) {
  // Load the template PDF
  const pdfDoc = await PDFDocument.load(templatePdfBytes);
  const pages = pdfDoc.getPages();
  
  // Debug: Log page properties to understand coordinate system
  if (pages.length > 0) {
    const firstPage = pages[0];
    const pageSize = firstPage.getSize();
    console.log(`[PDF Overlay] Page size: ${pageSize.width} x ${pageSize.height} points`);
    
    try {
      const mediaBox = firstPage.node.MediaBox();
      const cropBox = firstPage.node.CropBox();
      console.log(`[PDF Overlay] MediaBox:`, mediaBox);
      console.log(`[PDF Overlay] CropBox:`, cropBox);
      
      // Check if there's a coordinate system offset
      if (cropBox && mediaBox) {
        const offsetX = cropBox[0] - mediaBox[0];
        const offsetY = cropBox[1] - mediaBox[1];
        if (offsetX !== 0 || offsetY !== 0) {
          console.log(`[PDF Overlay] Coordinate offset detected: x=${offsetX}, y=${offsetY}`);
        }
      }
    } catch (e) {
      console.warn(`[PDF Overlay] Could not read page boxes:`, e.message);
    }
  }
  
  // Get fonts for overlaying text
  const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBoldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // Merge documentData into formData (documentData takes precedence)
  const mergedData = { ...formData, ...documentData };

  const pageSizeHint = pages[0]?.getSize?.() || { width: 612, height: 792 };
  const forceImagePixels = templateUsesImagePixelPositions(
    templateData,
    pageSizeHint
  );
  if (forceImagePixels) {
    console.log(
      '[RENDER_DIAG] Template positions treated as 2x image pixels (top-left) for all fields'
    );
  }

  // Helper function to format value
  function formatValue(value, fieldType) {
    if (value === null || value === undefined || value === '') return '';
    
    if (fieldType === 'date' && value) {
      try {
        const date = new Date(value);
        return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      } catch {
        return String(value);
      }
    }
    
    if (fieldType === 'currency' || fieldType === 'number') {
      if (typeof value === 'number') {
        return fieldType === 'currency' ? `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : String(value);
      }
      return String(value);
    }
    
    if (fieldType === 'boolean') {
      return value ? 'X' : ''; // Checkbox - draw X if true
    }
    
    if (Array.isArray(value)) {
      return value.map(item => {
        if (typeof item === 'object') {
          return Object.entries(item).map(([k, v]) => `${k}: ${v}`).join(', ');
        }
        return String(item);
      }).join('; ');
    }
    
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }
    
    return String(value);
  }

  // Helper function to get nested value
  function getNestedValue(path, data) {
    const keys = path.split('.');
    let value = data;
    for (const key of keys) {
      if (value && typeof value === 'object' && key in value) {
        value = value[key];
      } else {
        return null;
      }
    }
    return value;
  }


  // Helper function to get position from field definition.
  // Converts 2x image pixel coords (top-left) to PDF points (bottom-left)
  // when needed so overlay matches template extraction positions.
  function getFieldPosition(fieldDef, pageSize) {
    return resolveTemplateFieldPosition(fieldDef?.position, pageSize, {
      forceImagePixels,
    });
  }

  function resolveFieldValue(fieldPath, fieldKey, sectionKey) {
    // Only use explicit nested/section paths. Do NOT fall back to generic flat
    // keys like start_date/end_date/rent — that paints the same value onto
    // every loosely named field and lands data in the wrong blanks.
    let fieldValue = getNestedValue(fieldPath, mergedData);
    if (fieldValue === null || fieldValue === undefined) {
      fieldValue = getNestedValue(fieldPath, formData);
    }
    if (
      (fieldValue === null || fieldValue === undefined) &&
      sectionKey &&
      mergedData[sectionKey] &&
      typeof mergedData[sectionKey] === 'object' &&
      !mergedData[sectionKey].type
    ) {
      fieldValue = mergedData[sectionKey][fieldKey];
    }
    return fieldValue;
  }

  function drawFieldValue(fieldKey, fieldDef, fieldValue, yAdjust = 0) {
    if (fieldValue === null || fieldValue === undefined || fieldValue === '') {
      return false;
    }
    const formattedValue = formatValue(fieldValue, fieldDef.type);
    if (!formattedValue && fieldDef.type !== 'boolean') return false;

    const pageIndexHint =
      typeof fieldDef.position?.page === 'number' ? fieldDef.position.page : 0;
    const hintPage = pages[pageIndexHint] || pages[0];
    if (!hintPage) return false;

    const position = getFieldPosition(fieldDef, hintPage.getSize());
    if (!position || !pages[position.pageIndex]) {
      console.warn(
        `[RENDER_DIAG] No usable position for field "${fieldDef.description || fieldKey}"`
      );
      return false;
    }

    const page = pages[position.pageIndex];
    const drawY = position.y + yAdjust;

    if (fieldDef.type === 'boolean') {
      if (fieldValue === true) {
        page.drawText('X', {
          x: position.x,
          y: drawY,
          size: 12,
          font: helveticaBoldFont,
          color: rgb(0, 0, 0),
        });
        return true;
      }
      return false;
    }

    console.log(
      `[RENDER_DIAG] Overlay draw "${String(formattedValue).substring(0, 40)}" ` +
        `for ${fieldDef.description || fieldKey} at (${position.x.toFixed(1)}, ${drawY.toFixed(1)})` +
        `${position.convertedFromPixels ? ' [from 2x px]' : ''}`
    );
    page.drawText(String(formattedValue), {
      x: position.x,
      y: drawY,
      size: 10,
      font: helveticaFont,
      color: rgb(0, 0, 0),
    });
    return true;
  }

  let fieldsSeen = 0;
  let fieldsDrawn = 0;

  // Recursively walk nested template schema (not just Category → Field)
  function walkSchema(node, pathPrefix = '') {
    if (!node || typeof node !== 'object') return;

    // Array field group
    if (node.type === 'array' && node.items?.properties) {
      const arrayData = getNestedValue(pathPrefix, mergedData) || mergedData[pathPrefix.split('.').pop()] || [];
      if (Array.isArray(arrayData)) {
        arrayData.forEach((itemData, itemIndex) => {
          for (const [fieldKey, fieldDef] of Object.entries(node.items.properties)) {
            if (typeof fieldDef !== 'object' || !fieldDef.type) continue;
            fieldsSeen += 1;
            const fieldValue = itemData?.[fieldKey];
            if (drawFieldValue(fieldKey, fieldDef, fieldValue, -(itemIndex * 20))) {
              fieldsDrawn += 1;
            }
          }
        });
      }
      return;
    }

    // Leaf field definition
    if (node.type && (node.position || node.description !== undefined)) {
      // Only draw when this node itself is a field (has type). Callers pass leaf nodes via entries.
      return;
    }

    for (const [key, value] of Object.entries(node)) {
      if (!value || typeof value !== 'object') continue;
      const fieldPath = pathPrefix ? `${pathPrefix}.${key}` : key;

      if (value.type === 'array' && value.items?.properties) {
        walkSchema(value, fieldPath);
        continue;
      }

      if (value.type && value.position) {
        fieldsSeen += 1;
        const sectionKey = pathPrefix.split('.')[0] || '';
        const fieldValue = resolveFieldValue(fieldPath, key, sectionKey);
        if (drawFieldValue(key, value, fieldValue)) {
          fieldsDrawn += 1;
        }
        continue;
      }

      // Nested section / object without a field type — keep walking
      if (!value.type) {
        walkSchema(value, fieldPath);
      }
    }
  }

  walkSchema(templateData);

  console.log(
    `[RENDER_DIAG] PDF overlay complete: fields_seen=${fieldsSeen}, fields_drawn=${fieldsDrawn}, pages=${pages.length}`
  );

  // Save the modified PDF
  const pdfBytes = await pdfDoc.save();
  return pdfBytes;
}
