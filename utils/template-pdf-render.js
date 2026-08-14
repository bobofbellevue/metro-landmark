/* eslint-env node */
/**
 * Load template page images / source PDF and render filled documents using
 * stored field positions (not the sequential no-template layout).
 *
 * Prefer PDF overlay first: the `canvas` native module is unreliable on Vercel
 * serverless, which previously caused silent fallback to the simple layout.
 */
import { overlayDataOnTemplatePDF } from '../api/utils/pdf-generator-overlay.js';
import { parseTemplateData } from '../src/utils/template-data.js';
import { analyzeTemplatePositionQuality } from '../src/utils/template-position-quality.js';

function normalizeStoragePath(path) {
  return String(path || '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
}

function createDiagnostics(templateId) {
  return {
    template_id: templateId || null,
    mode: null,
    images_listed: 0,
    images_loaded: 0,
    pdf_found: false,
    pdf_source: null,
    fields_with_positions: 0,
    position_quality: null,
    fallback_reason: null,
    errors: [],
  };
}

/**
 * Count schema fields that include position coordinates.
 * @param {object} templateData
 * @returns {number}
 */
export function countFieldsWithPositions(templateData) {
  let count = 0;
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.type && node.position && typeof node.position === 'object') {
      if (
        typeof node.position.x === 'number' &&
        typeof node.position.y === 'number'
      ) {
        count += 1;
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
  return count;
}

/**
 * @param {object} supabase
 * @param {number} templateId
 * @param {object} diagnostics
 * @returns {Promise<Buffer[]>}
 */
export async function loadTemplatePageImages(supabase, templateId, diagnostics = null) {
  if (!templateId) return [];

  const templateImagesPath = normalizeStoragePath(
    `templates/${templateId}/images`
  );
  const loaded = [];
  const seen = new Set();

  const pushImage = async (imagePath) => {
    if (seen.has(imagePath)) return;
    const { data: imageData, error: downloadError } = await supabase.storage
      .from('documents')
      .download(imagePath);
    if (downloadError || !imageData) {
      if (diagnostics && downloadError) {
        // Only record unexpected failures (missing page_* probes are normal)
        if (!/not.found|Object not found/i.test(downloadError.message || '')) {
          diagnostics.errors.push(`image download ${imagePath}: ${downloadError.message}`);
        }
      }
      return;
    }
    seen.add(imagePath);
    const arrayBuffer = await imageData.arrayBuffer();
    loaded.push({
      path: imagePath,
      buffer: Buffer.from(arrayBuffer),
      page: parseInt(imagePath.match(/page_(\d+)\.png$/i)?.[1] || '0', 10),
    });
  };

  // 1) List folder (no trailing slash — trailing slash can return empty)
  const { data: imageFiles, error: listError } = await supabase.storage
    .from('documents')
    .list(templateImagesPath, { limit: 100 });

  if (listError) {
    console.warn(
      `[RENDER_DIAG] list images failed path=${templateImagesPath}:`,
      listError.message || listError
    );
    if (diagnostics) {
      diagnostics.errors.push(`list images: ${listError.message || listError}`);
    }
  } else {
    const named = (imageFiles || []).filter(
      (file) =>
        file?.name &&
        file.name.startsWith('page_') &&
        file.name.toLowerCase().endsWith('.png')
    );
    if (diagnostics) diagnostics.images_listed = named.length;
    console.log(
      `[RENDER_DIAG] listed ${named.length} page_*.png under ${templateImagesPath} (raw entries=${(imageFiles || []).length})`
    );
    for (const imageFile of named) {
      await pushImage(`${templateImagesPath}/${imageFile.name}`);
    }
  }

  // 2) Brute-force common page names in case list is empty/wrong
  if (loaded.length === 0) {
    for (let page = 1; page <= 20; page++) {
      await pushImage(`${templateImagesPath}/page_${page}.png`);
    }
  }

  loaded.sort((a, b) => a.page - b.page);
  if (diagnostics) diagnostics.images_loaded = loaded.length;
  console.log(
    `[RENDER_DIAG] loaded ${loaded.length} template image(s) for template ${templateId}`
  );
  return loaded.map((item) => item.buffer);
}

/**
 * @param {object} supabase
 * @param {number} templateId
 * @param {object} diagnostics
 * @returns {Promise<Uint8Array|null>}
 */
export async function loadTemplateSourcePdf(supabase, templateId, diagnostics = null) {
  if (!templateId) return null;

  const { data: docs, error: docsError } = await supabase
    .from('documents')
    .select('storage_path, file_path, file_name, document_id')
    .eq('template_id', templateId)
    .eq('document_type', 'template_document')
    .limit(10);

  if (docsError) {
    console.warn(
      '[RENDER_DIAG] template_document lookup failed:',
      docsError.message || docsError
    );
    if (diagnostics) {
      diagnostics.errors.push(`template_document: ${docsError.message || docsError}`);
    }
  } else {
    console.log(
      `[RENDER_DIAG] template_document rows for template ${templateId}: ${(docs || []).length}`
    );
  }

  for (const doc of docs || []) {
    const path = normalizeStoragePath(doc.storage_path || doc.file_path);
    if (!path) continue;
    const { data, error } = await supabase.storage.from('documents').download(path);
    if (!error && data) {
      if (diagnostics) {
        diagnostics.pdf_found = true;
        diagnostics.pdf_source = `documents:${path}`;
      }
      console.log(`[RENDER_DIAG] loaded template PDF from documents.storage_path=${path}`);
      return new Uint8Array(await data.arrayBuffer());
    }
    console.warn(
      `[RENDER_DIAG] Failed to download template PDF ${path}:`,
      error?.message || error
    );
    if (diagnostics) {
      diagnostics.errors.push(`pdf download ${path}: ${error?.message || error}`);
    }
  }

  // Fallback: any PDF under templates/{id}/
  const folder = normalizeStoragePath(`templates/${templateId}`);
  const { data: files, error: listError } = await supabase.storage
    .from('documents')
    .list(folder, { limit: 50 });

  if (listError) {
    console.warn(
      '[RENDER_DIAG] Failed to list template folder:',
      listError.message || listError
    );
    if (diagnostics) {
      diagnostics.errors.push(`list template folder: ${listError.message || listError}`);
    }
    return null;
  }

  console.log(
    `[RENDER_DIAG] template folder ${folder} entries: ${(files || []).map((f) => f.name).join(', ') || '(none)'}`
  );

  for (const file of files || []) {
    if (!file?.name || !file.name.toLowerCase().endsWith('.pdf')) continue;
    const path = `${folder}/${file.name}`;
    const { data, error } = await supabase.storage.from('documents').download(path);
    if (!error && data) {
      if (diagnostics) {
        diagnostics.pdf_found = true;
        diagnostics.pdf_source = `storage:${path}`;
      }
      console.log(`[RENDER_DIAG] loaded template PDF from storage folder path=${path}`);
      return new Uint8Array(await data.arrayBuffer());
    }
  }

  return null;
}

/**
 * Render a filled template PDF using stored field positions.
 *
 * @returns {Promise<{ pdfBytes: Uint8Array|null, diagnostics: object }>}
 */
export async function renderFilledTemplatePdf({
  supabase,
  template,
  formData,
  documentData = {},
}) {
  const templateId = template?.template_id || null;
  const diagnostics = createDiagnostics(templateId);

  if (!templateId) {
    diagnostics.fallback_reason = 'missing_template_id';
    return { pdfBytes: null, diagnostics };
  }

  // Prefer template_data_raw (has positions from import) over possibly stale JSONB
  const templateData = parseTemplateData(template);
  if (!templateData || typeof templateData !== 'object' || !Object.keys(templateData).length) {
    diagnostics.fallback_reason = 'empty_template_data';
    console.warn(`[RENDER_DIAG] template ${templateId} has empty template_data/raw`);
    return { pdfBytes: null, diagnostics };
  }

  diagnostics.fields_with_positions = countFieldsWithPositions(templateData);
  const positionQuality = analyzeTemplatePositionQuality(templateData);
  diagnostics.position_quality = {
    synthetic: positionQuality.synthetic,
    reason: positionQuality.reason,
    shared_x: positionQuality.sharedX,
    sample: positionQuality.sample,
  };
  console.log(
    `[RENDER_DIAG] template ${templateId}: fields_with_positions=${diagnostics.fields_with_positions}`,
    diagnostics.position_quality
  );

  if (diagnostics.fields_with_positions === 0) {
    diagnostics.fallback_reason = 'no_field_positions_in_template';
    console.warn(
      `[RENDER_DIAG] template ${templateId} schema has no position coordinates — cannot place values on template`
    );
    return { pdfBytes: null, diagnostics };
  }

  // Reject invented vertical columns (same X, stepped Y in PDF points).
  // Overlaying those on the form PDF looks like the old no-template stack.
  if (positionQuality.synthetic) {
    diagnostics.fallback_reason = 'synthetic_field_positions';
    console.warn(
      `[RENDER_DIAG] template ${templateId} has synthetic column positions (${positionQuality.reason}) — refusing overlay; re-extract template field positions from page images`
    );
    return { pdfBytes: null, diagnostics };
  }

  // 1) PDF overlay first (no native canvas dependency — reliable on Vercel)
  try {
    const templatePdfBytes = await loadTemplateSourcePdf(
      supabase,
      templateId,
      diagnostics
    );
    if (templatePdfBytes) {
      console.log(
        `[RENDER_DIAG] Using PDF overlay for template ${templateId}`
      );
      const pdfBytes = await overlayDataOnTemplatePDF(
        templatePdfBytes,
        templateData,
        formData,
        documentData
      );
      diagnostics.mode = 'pdf_overlay';
      return { pdfBytes, diagnostics };
    }
  } catch (overlayError) {
    const message = overlayError?.message || String(overlayError);
    console.warn('[RENDER_DIAG] PDF overlay failed:', message);
    diagnostics.errors.push(`pdf_overlay: ${message}`);
  }

  // 2) Image-based (requires canvas native module)
  try {
    const templateImages = await loadTemplatePageImages(
      supabase,
      templateId,
      diagnostics
    );
    if (templateImages.length > 0) {
      const { generatePDFFromTemplateImages } = await import(
        './pdf-generator-image-based.js'
      );
      console.log(
        `[RENDER_DIAG] Using image-based generation for template ${templateId} (${templateImages.length} page(s))`
      );
      const pdfBytes = await generatePDFFromTemplateImages(
        templateImages,
        templateData,
        formData,
        documentData
      );
      diagnostics.mode = 'image_based';
      return { pdfBytes, diagnostics };
    }
  } catch (imageError) {
    const message = imageError?.message || String(imageError);
    console.warn('[RENDER_DIAG] Image-based generation failed:', message);
    diagnostics.errors.push(`image_based: ${message}`);
  }

  diagnostics.fallback_reason =
    diagnostics.fallback_reason ||
    (!diagnostics.pdf_found && diagnostics.images_loaded === 0
      ? 'no_template_assets'
      : 'render_failed');
  console.warn(
    `[RENDER_DIAG] positioned render unavailable for template ${templateId}: ${diagnostics.fallback_reason}`,
    diagnostics
  );
  return { pdfBytes: null, diagnostics };
}
