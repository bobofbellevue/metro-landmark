/* eslint-env node */
import { PDFDocument } from 'pdf-lib';
import { createCanvas, loadImage } from 'canvas';

/**
 * Generate PDF from template images with data overlaid using pixel coordinates
 * @param {Array<Buffer|Uint8Array>} templateImages - Array of image buffers (one per page)
 * @param {Object} templateData - Template schema with pixel coordinates
 * @param {Object} formData - Data to populate the form
 * @param {Object} documentData - Additional data from document_data field
 * @returns {Promise<Uint8Array>} PDF bytes
 */
export async function generatePDFFromTemplateImages(templateImages, templateData, formData, documentData = {}) {
  const pdfDoc = await PDFDocument.create();
  const mergedData = { ...formData, ...documentData };

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
        return fieldType === 'currency'
          ? `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
          : String(value);
      }
      return String(value);
    }

    if (fieldType === 'boolean') {
      return value ? 'X' : '';
    }

    if (Array.isArray(value)) {
      return value
        .map((item) => {
          if (typeof item === 'object') {
            return Object.entries(item)
              .map(([k, v]) => `${k}: ${v}`)
              .join(', ');
          }
          return String(item);
        })
        .join('; ');
    }

    if (typeof value === 'object') {
      return JSON.stringify(value);
    }

    return String(value);
  }

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

  function resolveFieldValue(fieldPath, fieldKey, sectionKey) {
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

  let fieldsDrawn = 0;

  for (let pageIndex = 0; pageIndex < templateImages.length; pageIndex++) {
    const imageBuffer = templateImages[pageIndex];
    const image = await loadImage(imageBuffer);
    const canvas = createCanvas(image.width, image.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);

    const fontSize = 20; // 20px at 2x scale ≈ 10pt in final PDF
    ctx.font = `${fontSize}px Arial, sans-serif`;
    ctx.fillStyle = 'black';
    ctx.textBaseline = 'alphabetic';

    function drawOnPage(fieldDef, fieldValue, yAdjust = 0) {
      if (fieldValue === null || fieldValue === undefined || fieldValue === '') return false;
      const position = fieldDef.position;
      if (!position || typeof position !== 'object') return false;
      const posPage = typeof position.page === 'number' ? position.page : 0;
      if (posPage !== pageIndex) return false;

      const formattedValue = formatValue(fieldValue, fieldDef.type);
      if (!formattedValue && fieldDef.type !== 'boolean') return false;

      const x = position.x || 0;
      const y = (position.y || 0) + yAdjust;

      if (fieldDef.type === 'boolean') {
        if (fieldValue === true) {
          ctx.font = `${fontSize * 1.2}px Arial, sans-serif`;
          ctx.fillText('X', x, y);
          ctx.font = `${fontSize}px Arial, sans-serif`;
          return true;
        }
        return false;
      }

      ctx.fillText(String(formattedValue), x, y);
      return true;
    }

    function walkSchema(node, pathPrefix = '') {
      if (!node || typeof node !== 'object') return;

      if (node.type === 'array' && node.items?.properties) {
        const arrayData =
          getNestedValue(pathPrefix, mergedData) ||
          mergedData[pathPrefix.split('.').pop()] ||
          [];
        if (Array.isArray(arrayData)) {
          arrayData.forEach((itemData, itemIndex) => {
            for (const [fieldKey, fieldDef] of Object.entries(node.items.properties)) {
              if (typeof fieldDef !== 'object' || !fieldDef.type) continue;
              if (drawOnPage(fieldDef, itemData?.[fieldKey], itemIndex * 40)) {
                fieldsDrawn += 1;
              }
            }
          });
        }
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
          const sectionKey = pathPrefix.split('.')[0] || '';
          const fieldValue = resolveFieldValue(fieldPath, key, sectionKey);
          if (drawOnPage(value, fieldValue)) {
            fieldsDrawn += 1;
          }
          continue;
        }

        if (!value.type) {
          walkSchema(value, fieldPath);
        }
      }
    }

    walkSchema(templateData);

    const imageBufferWithText = canvas.toBuffer('image/png');
    const pdfImage = await pdfDoc.embedPng(imageBufferWithText);
    const pdfPage = pdfDoc.addPage([image.width / 2, image.height / 2]);
    pdfPage.drawImage(pdfImage, {
      x: 0,
      y: 0,
      width: image.width / 2,
      height: image.height / 2,
    });
  }

  console.log(
    `[RENDER_DIAG] Image-based complete: fields_drawn=${fieldsDrawn}, pages=${templateImages.length}`
  );

  return pdfDoc.save();
}
