/* eslint-env node */
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

/**
 * Generate a PDF document from a template schema and data
 * @param {Object} templateData - Template schema (JSONB from templates table)
 * @param {Object} formData - Data to populate the form
 * @returns {Promise<Uint8Array>} PDF bytes
 */
export async function generatePDFFromTemplate(templateData, formData) {
  // Create a new PDF document
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]); // US Letter size (8.5 x 11 inches)
  const { width, height } = page.getSize();

  // Get fonts
  const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBoldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let yPosition = height - 50; // Start from top
  const margin = 50;
  const lineHeight = 20;
  const sectionSpacing = 30;
  const fieldSpacing = 15;

  // Helper function to add text with word wrapping
  function addText(text, x, y, font, size, color = rgb(0, 0, 0), maxWidth = null, targetPage = page) {
    if (maxWidth) {
      // Simple word wrapping
      const words = text.split(' ');
      let line = '';
      let currentY = y;
      
      for (const word of words) {
        const testLine = line + (line ? ' ' : '') + word;
        const textWidth = font.widthOfTextAtSize(testLine, size);
        
        if (textWidth > maxWidth && line) {
          targetPage.drawText(line, { x, y: currentY, size, font, color });
          line = word;
          currentY -= size + 2;
        } else {
          line = testLine;
        }
      }
      
      if (line) {
        targetPage.drawText(line, { x, y: currentY, size, font, color });
        return currentY - size - 2;
      }
      
      return currentY;
    } else {
      targetPage.drawText(text, { x, y, size, font, color });
      return y - size - 2;
    }
  }

  // Helper function to get nested value from formData
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

  // Helper function to format value based on type
  function formatValue(value, fieldType) {
    if (value === null || value === undefined) return '';
    
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
      return value ? 'Yes' : 'No';
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

  // Iterate through template sections
  let currentPage = page;
  for (const [sectionKey, sectionFields] of Object.entries(templateData)) {
    // Check if we need a new page
    if (yPosition < 100) {
      currentPage = pdfDoc.addPage([612, 792]);
      yPosition = height - 50;
    }

    // Section title
    const sectionTitle = sectionKey.replace(/_/g, ' ').replace(/\d+_/g, '').trim();
    yPosition = addText(
      sectionTitle,
      margin,
      yPosition,
      helveticaBoldFont,
      14,
      rgb(0, 0, 0),
      null,
      currentPage
    );
    yPosition -= 5;

      // Draw line under section title
      currentPage.drawLine({
        start: { x: margin, y: yPosition },
        end: { x: width - margin, y: yPosition },
        thickness: 1,
        color: rgb(0.7, 0.7, 0.7)
      });
      yPosition -= sectionSpacing;

      // Iterate through fields in section
      for (const [fieldKey, fieldDef] of Object.entries(sectionFields)) {
        if (typeof fieldDef !== 'object' || !fieldDef.type) continue;

        // Check if we need a new page
        if (yPosition < 100) {
          currentPage = pdfDoc.addPage([612, 792]);
          yPosition = height - 50;
        }

      const fieldLabel = fieldDef.description || fieldKey.replace(/_/g, ' ');
      const fieldPath = `${sectionKey}.${fieldKey}`;
      
      // Get value from formData
      let fieldValue = getNestedValue(fieldPath, formData);
      
      // If not found, try direct field key
      if (fieldValue === null) {
        fieldValue = getNestedValue(fieldKey, formData);
      }
      
      // If still not found, try in section
      if (fieldValue === null && formData[sectionKey]) {
        fieldValue = formData[sectionKey][fieldKey];
      }

      const formattedValue = formatValue(fieldValue, fieldDef.type);

      // Draw field label and value
      const labelText = `${fieldLabel}:`;
      yPosition = addText(
        labelText,
        margin + 20,
        yPosition,
        helveticaFont,
        10,
        rgb(0.3, 0.3, 0.3),
        null,
        currentPage
      );

      if (formattedValue) {
        yPosition = addText(
          formattedValue,
          margin + 150,
          yPosition + 10,
          helveticaFont,
          10,
          rgb(0, 0, 0),
          width - margin - 160,
          currentPage
        );
      } else {
        yPosition -= 10;
      }

      yPosition -= fieldSpacing;
    }

    yPosition -= sectionSpacing;
  }

  // Generate PDF bytes
  const pdfBytes = await pdfDoc.save();
  return pdfBytes;
}

/**
 * Add signature to an existing PDF
 * @param {Uint8Array} pdfBytes - Original PDF bytes
 * @param {string} signatureImageBase64 - Base64 encoded signature image
 * @param {Object} signaturePosition - { x, y, width, height, pageIndex }
 * @returns {Promise<Uint8Array>} PDF bytes with signature
 */
export async function addSignatureToPDF(pdfBytes, signatureImageBase64, signaturePosition) {
  const pdfDoc = await PDFDocument.load(pdfBytes);
  
  // Decode base64 signature image
  // Handle both data URL format and plain base64
  let base64Data = signatureImageBase64;
  if (base64Data.includes(',')) {
    base64Data = base64Data.split(',')[1];
  }
  
  // Convert base64 to buffer (Node.js compatible)
  const imageBytes = Buffer.from(base64Data, 'base64');
  
  // Embed image (assuming PNG format)
  const signatureImage = await pdfDoc.embedPng(imageBytes);
  
  // Get the page
  const pages = pdfDoc.getPages();
  const pageIndex = signaturePosition.pageIndex || pages.length - 1;
  const page = pages[pageIndex];
  
  // Draw signature
  const { width, height } = page.getSize();
  const x = signaturePosition.x || width - 200;
  const y = signaturePosition.y || 100;
  const sigWidth = signaturePosition.width || 150;
  const sigHeight = signaturePosition.height || 50;
  
  page.drawImage(signatureImage, {
    x,
    y,
    width: sigWidth,
    height: sigHeight
  });
  
  const signedPdfBytes = await pdfDoc.save();
  return signedPdfBytes;
}

/**
 * Overlay data on an existing template PDF
 * Uses text search to find field labels and overlays values near them
 * @param {Uint8Array} templatePdfBytes - Original template PDF bytes
 * @param {Object} templateData - Template schema (JSONB from templates table)
 * @param {Object} formData - Data to populate (from lease data)
 * @param {Object} documentData - Filled data from Fill Lease modal (may have more specific values)
 * @returns {Promise<Uint8Array>} PDF bytes with data overlaid
 */
export async function overlayDataOnTemplatePDF(templatePdfBytes, templateData, formData, documentData = {}) {
  // Import pdf-parse for text extraction (if available) or use pdf-lib's capabilities
  let pdfParse;
  try {
    pdfParse = (await import('pdf-parse')).default;
  } catch (e) {
    console.warn('pdf-parse not available, using basic text overlay');
  }

  // Load the template PDF
  const pdfDoc = await PDFDocument.load(templatePdfBytes);
  const pages = pdfDoc.getPages();
  
  // Get fonts for overlaying text
  const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBoldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // Merge documentData into formData (documentData takes precedence as it's from Fill Lease)
  const mergedData = { ...formData, ...documentData };

  // Helper function to find text in PDF and get approximate position
  // This is a simplified approach - in production, you might want more sophisticated text matching
  async function findTextPosition(pdfBytes, searchText) {
    if (!pdfParse) {
      // Without pdf-parse, we'll use a heuristic approach
      return null;
    }

    try {
      const pdfData = await pdfParse(pdfBytes);
      const text = pdfData.text;
      const index = text.toLowerCase().indexOf(searchText.toLowerCase());
      
      if (index === -1) return null;
      
      // Estimate position based on text position (rough approximation)
      // This is a simplified approach - actual implementation would need more sophisticated positioning
      const lines = text.substring(0, index).split('\n');
      const lineNumber = lines.length;
      const charInLine = lines[lines.length - 1].length;
      
      return {
        pageIndex: 0, // Simplified - would need to track pages
        lineNumber,
        charInLine,
        estimatedY: 750 - (lineNumber * 12), // Rough estimate
        estimatedX: 50 + (charInLine * 6) // Rough estimate
      };
    } catch (error) {
      console.error('Error extracting text from PDF:', error);
      return null;
    }
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

  // Iterate through template structure and overlay values
  for (const [sectionKey, sectionFields] of Object.entries(templateData)) {
    if (typeof sectionFields !== 'object') continue;

    for (const [fieldKey, fieldDef] of Object.entries(sectionFields)) {
      if (typeof fieldDef !== 'object' || !fieldDef.type) continue;

      const fieldLabel = fieldDef.description || fieldKey.replace(/_/g, ' ');
      const fieldPath = `${sectionKey}.${fieldKey}`;
      
      // Get value - try documentData first, then formData
      let fieldValue = getNestedValue(fieldPath, mergedData);
      
      // If not found, try direct field key
      if (fieldValue === null || fieldValue === undefined) {
        fieldValue = mergedData[fieldKey] || formData[fieldKey];
      }
      
      // If still not found, try in section
      if ((fieldValue === null || fieldValue === undefined) && mergedData[sectionKey]) {
        fieldValue = mergedData[sectionKey][fieldKey];
      }

      if (fieldValue === null || fieldValue === undefined || fieldValue === '') {
        continue; // Skip empty fields
      }

      const formattedValue = formatValue(fieldValue, fieldDef.type);
      if (!formattedValue) continue;

      // Try to find the label position in the PDF
      // For now, we'll use a heuristic: search for the label and place value to the right
      // In a production system, you might want to store field positions during template import
      
      // Simplified approach: overlay text on first page at estimated positions
      // This is a basic implementation - you may want to enhance this with:
      // 1. Storing field positions during template import
      // 2. Using OCR to find exact label positions
      // 3. Using a more sophisticated text matching algorithm
      
      if (pages.length > 0) {
        const page = pages[0]; // Start with first page
        const { width, height } = page.getSize();
        
        // Try to find label text position (simplified - would need better text extraction)
        let position = null;
        if (pdfParse) {
          position = await findTextPosition(templatePdfBytes, fieldLabel);
        }
        
        if (position) {
          // Use found position
          page.drawText(formattedValue, {
            x: position.estimatedX + 150, // Place to the right of label
            y: position.estimatedY,
            size: 10,
            font: helveticaFont,
            color: rgb(0, 0, 0)
          });
        } else {
          // Fallback: Use a simple vertical stacking approach
          // This is a temporary solution - in production, you'd want better positioning
          // For now, we'll skip automatic positioning and let the user know
          // that field positions need to be determined
          console.warn(`Could not find position for field: ${fieldLabel}. Consider storing field positions during template import.`);
        }
      }
    }
  }

  // Save the modified PDF
  const pdfBytes = await pdfDoc.save();
  return pdfBytes;
}
