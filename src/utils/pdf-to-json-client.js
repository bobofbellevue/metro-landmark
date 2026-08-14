/**
 * Client-side PDF/DOC/DOCX to JSON Schema converter
 * Converts files to images, then sends to Vercel serverless function
 */

// Dynamic import for pdfjs-dist to avoid SSR issues
let pdfjsLib;
async function loadPdfJs() {
  if (!pdfjsLib) {
    pdfjsLib = await import('pdfjs-dist');
    // Set worker source immediately after import to avoid warnings
    // Using jsdelivr CDN with exact version from package.json (5.4.394)
    if (pdfjsLib.GlobalWorkerOptions) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.394/build/pdf.worker.min.mjs`;
    }
  }
  return pdfjsLib;
}

// Dynamic import for mammoth (DOCX conversion)
let mammoth;
async function loadMammoth() {
  if (!mammoth) {
    mammoth = await import('mammoth');
  }
  return mammoth;
}

// Dynamic import for html2canvas
let html2canvas;
async function loadHtml2Canvas() {
  if (!html2canvas) {
    html2canvas = (await import('html2canvas')).default;
  }
  return html2canvas;
}

/**
 * Convert PDF pages to images (base64 encoded)
 * @param {File} file - PDF file
 * @param {Object} options - Options including abortController and onProgress
 */
async function pdfToImages(file, options = {}) {
  const { abortController, onProgress } = options;
  const pdfjs = await loadPdfJs();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  const numPages = pdf.numPages;
  const images = [];

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    if (abortController?.signal.aborted) {
      throw new Error('Conversion cancelled');
    }
    
    const page = await pdf.getPage(pageNum);
    // Use scale 2.0 for better OCR accuracy (higher resolution = better text recognition)
    // This matches the server-side conversion scale for consistency
    const viewport = page.getViewport({ scale: 2.0 });

    // Create canvas to render PDF page
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    // Render PDF page to canvas
    await page.render({
      canvasContext: context,
      viewport: viewport
    }).promise;

    // Convert canvas to base64 image
    // Use PNG for OCR to avoid compression artifacts that degrade text recognition
    // PNG is larger but provides better OCR accuracy than JPEG
    const imageData = canvas.toDataURL('image/png');
    // Keep pixel dimensions for the position-measurement pass (2x US Letter ≈ 1224×1584)
    images.push({
      dataUrl: imageData,
      width: Math.round(viewport.width),
      height: Math.round(viewport.height),
    });
    
    if (onProgress) {
      const progress = (pageNum / numPages) * 30; // 0-30% for image conversion
      onProgress('converting', progress, `Converting page ${pageNum} of ${numPages}...`);
    }
  }

  return images;
}

/**
 * Convert DOCX to HTML, then render HTML to images
 * @param {File} file - DOCX file
 * @param {Object} options - Options including abortController and onProgress
 */
async function docxToImages(file, options = {}) {
  const { abortController, onProgress } = options;
  
  if (abortController?.signal.aborted) {
    throw new Error('Conversion cancelled');
  }
  
  if (onProgress) onProgress('converting', 5, 'Converting DOCX to HTML...');
  
  const mammothLib = await loadMammoth();
  const arrayBuffer = await file.arrayBuffer();
  
  // Convert DOCX to HTML
  const result = await mammothLib.convertToHtml({ arrayBuffer });
  const html = result.value;
  
  // Log any warnings from mammoth
  if (result.messages && result.messages.length > 0) {
    console.warn('Mammoth conversion warnings:', result.messages);
  }
  
  if (abortController?.signal.aborted) {
    throw new Error('Conversion cancelled');
  }
  
  if (onProgress) onProgress('converting', 15, 'Rendering HTML to image...');
  
  // Load html2canvas library
  const html2canvasLib = await loadHtml2Canvas();
  
  // Create a temporary container to render HTML
  const container = document.createElement('div');
  container.style.position = 'absolute';
  container.style.left = '-9999px';
  container.style.top = '-9999px';
  container.style.width = '816px'; // Standard letter width at 96 DPI (8.5 inches)
  container.style.padding = '96px'; // 1 inch margins
  container.style.backgroundColor = 'white';
  container.style.fontFamily = 'Arial, sans-serif';
  container.style.fontSize = '12px';
  container.style.lineHeight = '1.5';
  container.style.color = 'black';
  container.innerHTML = html;
  document.body.appendChild(container);
  
  try {
    // Wait for images to load if any
    const images = container.querySelectorAll('img');
    await Promise.all(Array.from(images).map(img => {
      return new Promise((resolve) => {
        if (img.complete) {
          resolve();
        } else {
          img.onload = resolve;
          img.onerror = resolve; // Continue even if image fails
        }
      });
    }));
    
    if (abortController?.signal.aborted) {
      throw new Error('Conversion cancelled');
    }
    
    // Use html2canvas to convert HTML to image
    const canvas = await html2canvasLib(container, {
      backgroundColor: '#ffffff',
      scale: 1.0, // Reduced scale to prevent 413 errors
      useCORS: true,
      logging: false,
      width: container.scrollWidth,
      height: container.scrollHeight
    });
    
    // Convert canvas to base64 image using JPEG compression to reduce size
    const imageData = canvas.toDataURL('image/jpeg', 0.75);
    return [imageData];
  } finally {
    // Always clean up
    if (container.parentNode) {
      document.body.removeChild(container);
    }
  }
}

/**
 * Convert ArrayBuffer to base64 (browser-compatible)
 */
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Convert DOC file to images using server-side conversion
 * @param {File} file - DOC file
 * @param {Object} options - Options including abortController and onProgress
 */
async function docToImages(file, options = {}) {
  const { abortController, onProgress } = options;
  
  if (abortController?.signal.aborted) {
    throw new Error('Conversion cancelled');
  }
  
  if (onProgress) onProgress('converting', 5, 'Sending DOC file to server for conversion...');
  
  // Convert file to base64 (browser-compatible)
  const arrayBuffer = await file.arrayBuffer();
  const base64 = arrayBufferToBase64(arrayBuffer);
  const base64DataUrl = `data:application/msword;base64,${base64}`;

  // Determine API URL
  const apiUrl = import.meta.env.VITE_API_URL || 
                 (import.meta.env.PROD ? '/api' : 'http://localhost:3000/api');
  const endpoint = `${apiUrl}/documents/convert-doc-to-images`;

  const controller = new AbortController();
  if (abortController) {
    abortController.signal.addEventListener('abort', () => controller.abort());
  }
  
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      file: base64DataUrl,
      fileName: file.name
    }),
    signal: controller.signal
  });

  if (abortController?.signal.aborted) {
    throw new Error('Conversion cancelled');
  }

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Server error: ${response.status} ${response.statusText}`);
  }

  const result = await response.json();

  if (result.success) {
    // If server returned PDF (needs client-side conversion), convert it to images
    if (result.pdfBase64 && result.needsClientConversion) {
      if (onProgress) onProgress('converting', 15, 'Converting PDF to images...');
      // Convert base64 PDF to File object for pdfToImages
      const base64Data = result.pdfBase64.split(',')[1];
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const pdfBlob = new Blob([bytes], { type: 'application/pdf' });
      const pdfFile = new File([pdfBlob], 'converted.pdf', { type: 'application/pdf' });
      
      // Use existing PDF to images conversion
      const images = await pdfToImages(pdfFile, { abortController, onProgress });
      return images;
    } else if (result.images) {
      // Server already converted to images
      return result.images;
    } else {
      throw new Error('Server response missing images or PDF data');
    }
  } else {
    throw new Error(result.error || 'Failed to convert DOC file');
  }
}

/**
 * Convert any supported file (PDF, DOCX, DOC) to images
 * Automatically detects file type and uses appropriate converter
 * @param {File} file - File to convert
 * @param {Object} options - Options including abortController and onProgress
 */
async function fileToImages(file, options = {}) {
  const { abortController, onProgress } = options;
  const fileName = file.name.toLowerCase();
  const fileType = file.type;
  
  const isPDF = fileType === 'application/pdf' || fileName.endsWith('.pdf');
  const isDOCX = fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || 
                 fileName.endsWith('.docx');
  const isDOC = fileType === 'application/msword' || fileName.endsWith('.doc');
  
  if (isPDF) {
    return await pdfToImages(file, { abortController, onProgress });
  } else if (isDOCX) {
    return await docxToImages(file, { abortController, onProgress });
  } else if (isDOC) {
    return await docToImages(file, { abortController, onProgress });
  } else {
    throw new Error('Unsupported file type. Please use PDF, DOCX, or DOC files.');
  }
}

/**
 * Convert PDF file to JSON Schema using Vercel serverless function
 * @param {File} pdfFile - PDF file from file input
 * @param {Object} options - Optional configuration (currently unused, kept for API compatibility)
 * @returns {Promise<Object>} Conversion result with schema data
 */
export async function convertPDFToJSONSchema(pdfFile, options = {}) {
  // Note: options parameter kept for API compatibility but not currently used
  // Use convertFileToJSONSchema for progress tracking and cancellation support
  void options; // Suppress unused parameter warning
  try {
    // Convert PDF to images
    const images = await pdfToImages(pdfFile);

    // Determine API URL
    const apiUrl = import.meta.env.VITE_API_URL || 
                   (import.meta.env.PROD ? '/api' : 'http://localhost:3000/api');
    const endpoint = `${apiUrl}/documents/convert-pdf-to-json`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        images: images
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Server error: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();

    if (result.success) {
      return {
        success: true,
        data: result.data,
        model: result.model,
        usage: result.usage
      };
    } else {
      throw new Error(result.error || 'Failed to convert PDF to JSON');
    }
  } catch (error) {
    console.error('Error converting PDF to JSON:', error);
    return {
      success: false,
      error: error.message || 'Failed to convert PDF. Please try again.'
    };
  }
}

/**
 * Extract filled values from a scanned/filled form
 * @param {File} file - PDF, DOCX, or DOC file from file input
 * @param {Object} options - Optional configuration
 * @param {AbortController} options.abortController - AbortController for cancellation
 * @param {Function} options.onProgress - Progress callback: (stage, progress, message) => void
 * @param {Object} options.template - Optional template structure to guide extraction
 * @returns {Promise<Object>} Conversion result with extracted field values
 */
export async function extractFormValues(file, options = {}) {
  const abortController = options?.abortController;
  const onProgress = options?.onProgress;
  const template = options?.template;
  
  try {
    // Automatically detect file type and convert to images
    const fileName = file.name.toLowerCase();
    const fileType = file.type;
    
    const isPDF = fileType === 'application/pdf' || fileName.endsWith('.pdf');
    const isDOCX = fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || 
                   fileName.endsWith('.docx');
    const isDOC = fileType === 'application/msword' || fileName.endsWith('.doc');
    
    if (!isPDF && !isDOCX && !isDOC) {
      throw new Error('Unsupported file type. Please use PDF, DOCX, or DOC files.');
    }
    
    const fileTypeName = isPDF ? 'PDF' : (isDOCX ? 'DOCX' : 'DOC');
    if (onProgress) onProgress('converting', 0, `Converting ${fileTypeName} to images...`);
    
    const images = await fileToImages(file, { abortController, onProgress });
    
    if (abortController?.signal.aborted) {
      throw new Error('Conversion cancelled');
    }
    
    // Removed console image logging (not needed)
    
    if (onProgress) onProgress('converting', 30, `Converted ${fileTypeName} to ${images.length} image(s)`);

    // Determine API URL
    const apiUrl = import.meta.env.VITE_API_URL || 
                   (import.meta.env.PROD ? '/api' : 'http://localhost:3000/api');
    const endpoint = `${apiUrl}/documents/extract-form-values`;

    if (onProgress) onProgress('processing', 50, `Extracting values from filled form...`);
    
    const requestBody = {
      images: images,
      template: template || null
    };
    
    const controller = new AbortController();
    if (abortController) {
      abortController.signal.addEventListener('abort', () => controller.abort());
    }
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const result = await response.json();
    
    if (result.success && result.data) {
      if (onProgress) onProgress('complete', 100, 'Values extracted successfully!');
      return {
        success: true,
        data: result.data
      };
    } else {
      throw new Error(result.error || 'Failed to extract form values');
    }
  } catch (error) {
    console.error('Error extracting form values:', error);
    return {
      success: false,
      error: error.message || 'Failed to extract form values. Please try again.'
    };
  }
}

/**
 * Unified file converter - automatically handles PDF, DOCX, and DOC files
 * @param {File} file - PDF, DOCX, or DOC file from file input
 * @param {Object} options - Optional configuration
 * @param {AbortController} options.abortController - AbortController for cancellation
 * @param {Function} options.onProgress - Progress callback: (stage, progress, message) => void
 * @returns {Promise<Object>} Conversion result with schema data
 */
export async function convertFileToJSONSchema(file, options = {}) {
  const abortController = options?.abortController;
  const onProgress = options?.onProgress;
  
  try {
    // Automatically detect file type and convert to images
    const fileName = file.name.toLowerCase();
    const fileType = file.type;
    
    const isPDF = fileType === 'application/pdf' || fileName.endsWith('.pdf');
    const isDOCX = fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || 
                   fileName.endsWith('.docx');
    const isDOC = fileType === 'application/msword' || fileName.endsWith('.doc');
    
    if (!isPDF && !isDOCX && !isDOC) {
      throw new Error('Unsupported file type. Please use PDF, DOCX, or DOC files.');
    }
    
    // DOC files are now supported via server-side conversion
    
    const fileTypeName = isPDF ? 'PDF' : (isDOCX ? 'DOCX' : 'DOC');
    if (onProgress) onProgress('converting', 0, `Converting ${fileTypeName} to images...`);
    
    const images = await fileToImages(file, { abortController, onProgress });
    
    if (abortController?.signal.aborted) {
      throw new Error('Conversion cancelled');
    }
    
    if (onProgress) onProgress('converting', 30, `Converted ${fileTypeName} to ${images.length} image(s)`);

    // Determine API URL
    const apiUrl = import.meta.env.VITE_API_URL || 
                   (import.meta.env.PROD ? '/api' : 'http://localhost:3000/api');
    const endpoint = `${apiUrl}/documents/convert-pdf-to-json`;

    // Schema API expects data-URL strings; keep full image entries for position pass / save
    const { normalizeImageEntries } = await import('./measure-template-positions-client.js');
    const { offsetTemplatePositionPages } = await import('./template-field-paths.js');
    const imageEntries = normalizeImageEntries(images);
    const imageDataUrls = imageEntries.map((e) => e.dataUrl);

    // For large documents, batch images to avoid 413 errors
    // Vercel has a 4.5MB request body limit
    const BATCH_SIZE = 5; // Process 5 images at a time
    const allResults = [];
    let mergedSchema = {};

    if (imageDataUrls.length > BATCH_SIZE) {
      const totalBatches = Math.ceil(imageDataUrls.length / BATCH_SIZE);
      
      if (onProgress) onProgress('processing', 40, `Extracting fields from ${imageDataUrls.length} pages in ${totalBatches} batch(es)...`);
      
      for (let i = 0; i < imageDataUrls.length; i += BATCH_SIZE) {
        if (abortController?.signal.aborted) {
          throw new Error('Conversion cancelled');
        }
        
        const batch = imageDataUrls.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        const pageStart = i + 1;
        const pageEnd = Math.min(i + BATCH_SIZE, imageDataUrls.length);
        const progress = 40 + (batchNum / totalBatches) * 25; // 40-65% for schema
        
        if (onProgress) onProgress('processing', progress, `Extracting fields batch ${batchNum}/${totalBatches} (pages ${pageStart}-${pageEnd})...`);
        
        const controller = new AbortController();
        if (abortController) {
          abortController.signal.addEventListener('abort', () => controller.abort());
        }
        
        const requestBody = {
          images: batch,
          batchInfo: {
            batchNumber: batchNum,
            totalBatches: totalBatches,
            pageRange: `${pageStart}-${pageEnd}`
          }
        };
        
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal
        });

        if (abortController?.signal.aborted) {
          throw new Error('Conversion cancelled');
        }

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          console.error(`Batch ${batchNum} failed:`, errorData);
          throw new Error(errorData.error || `Server error: ${response.status} ${response.statusText}`);
        }

        const result = await response.json();
        
        if (result.success && result.data) {
          // Batches restart page at 0 — offset to absolute page indexes
          offsetTemplatePositionPages(result.data, i);
          for (const category in result.data) {
            if (!mergedSchema[category]) {
              mergedSchema[category] = {};
            }
            Object.assign(mergedSchema[category], result.data[category]);
          }
          allResults.push(result);
        } else {
          console.error(`Batch ${batchNum} failed:`, result.error);
          throw new Error(result.error || `Failed to convert batch ${batchNum}`);
        }
      }
      
      // Verify all pages were processed
      const expectedBatches = Math.ceil(imageDataUrls.length / BATCH_SIZE);
      const processedBatches = allResults.length;
      if (processedBatches !== expectedBatches) {
        console.warn(`WARNING: Expected ${expectedBatches} batches but only processed ${processedBatches}`);
      }
      
      // Combine usage stats from all batches
      const totalUsage = allResults.reduce((acc, r) => {
        if (r.usage) {
          acc.prompt_tokens = (acc.prompt_tokens || 0) + (r.usage.prompt_tokens || 0);
          acc.completion_tokens = (acc.completion_tokens || 0) + (r.usage.completion_tokens || 0);
          acc.total_tokens = (acc.total_tokens || 0) + (r.usage.total_tokens || 0);
        }
        return acc;
      }, {});

      const { measureAndApplyTemplatePositions } = await import(
        './measure-template-positions-client.js'
      );
      const measured = await measureAndApplyTemplatePositions(
        mergedSchema,
        imageEntries,
        {
          abortController,
          onProgress,
          pdfFile: isPDF ? file : null,
        }
      );
      
      if (onProgress) onProgress('complete', 100, 'Conversion complete!');
      return {
        success: true,
        data: measured.schema,
        model: allResults[0]?.model,
        usage: totalUsage,
        images: imageDataUrls,
        imageEntries,
        position_measure: measured.diagnostics,
      };
    } else {
      // Small document - send all images at once
      if (onProgress) onProgress('processing', 50, 'Extracting form fields...');
      
      const controller = new AbortController();
      if (abortController) {
        abortController.signal.addEventListener('abort', () => controller.abort());
      }
      
      const requestBody = { images: imageDataUrls };
      
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });

      if (abortController?.signal.aborted) {
        throw new Error('Conversion cancelled');
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('API request failed:', errorData);
        throw new Error(errorData.error || `Server error: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();

      if (result.success) {
        const { measureAndApplyTemplatePositions } = await import(
          './measure-template-positions-client.js'
        );
        const measured = await measureAndApplyTemplatePositions(
          result.data,
          imageEntries,
          {
            abortController,
            onProgress,
            pdfFile: isPDF ? file : null,
          }
        );
        if (onProgress) onProgress('complete', 100, 'Conversion complete!');
        return {
          success: true,
          data: measured.schema,
          model: result.model,
          usage: result.usage,
          images: imageDataUrls,
          imageEntries,
          position_measure: measured.diagnostics,
        };
      } else {
        throw new Error(result.error || `Failed to convert ${fileTypeName} to JSON`);
      }
    }
  } catch (error) {
    console.error('Error converting file to JSON:', error);
    return {
      success: false,
      error: error.message || 'Failed to convert file. Please try again.'
    };
  }
}
