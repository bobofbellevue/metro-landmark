/**
 * Client: assign blank positions after schema import.
 * Prefers deterministic PDF text-gap geometry; falls back to vision per page.
 */
import {
  applyMeasuredPositions,
  listTemplateLeafFields,
} from './template-field-paths.js';
import { analyzeTemplatePositionQuality } from './template-position-quality.js';
import { clearTemplatePositions } from './clear-template-positions.js';
import { detectBlanksFromPdf } from './detect-pdf-blanks.js';
import { matchBlanksToFields } from './match-blanks-to-fields.js';

function apiBase() {
  return (
    import.meta.env.VITE_API_URL ||
    (import.meta.env.PROD ? '/api' : 'http://localhost:3000/api')
  );
}

/**
 * Normalize images to { dataUrl, width, height }.
 * @param {Array<string|{dataUrl:string,width?:number,height?:number}>} images
 */
export function normalizeImageEntries(images) {
  return (images || []).map((img) => {
    if (typeof img === 'string') {
      return { dataUrl: img, width: 1224, height: 1584 };
    }
    return {
      dataUrl: img.dataUrl || img.url || '',
      width: Number(img.width) || 1224,
      height: Number(img.height) || 1584,
    };
  });
}

function isPdfFile(file) {
  if (!file) return false;
  const name = String(file.name || '').toLowerCase();
  const type = String(file.type || '');
  return type === 'application/pdf' || name.endsWith('.pdf');
}

async function measureOnePage({
  entry,
  pageIndex,
  fields,
  abortController,
  retry = false,
}) {
  const controller = new AbortController();
  if (abortController) {
    abortController.signal.addEventListener('abort', () => controller.abort());
  }

  const response = await fetch(`${apiBase()}/documents/measure-field-positions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image: entry.dataUrl,
      pageIndex,
      width: entry.width,
      height: entry.height,
      fields,
      retry,
    }),
    signal: controller.signal,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(
      errorData.error ||
        `Position measure failed for page ${pageIndex + 1}: ${response.status}`
    );
  }

  return response.json();
}

/**
 * @param {object} schema
 * @param {Array} images
 * @param {object} options
 * @param {File} [options.pdfFile]
 * @returns {Promise<{ schema: object, diagnostics: object }>}
 */
export async function measureAndApplyTemplatePositions(
  schema,
  images,
  options = {}
) {
  const { abortController, onProgress, pdfFile } = options;
  const entries = normalizeImageEntries(images);
  const fields = listTemplateLeafFields(schema);
  const diagnostics = {
    fields_total: fields.length,
    pages: entries.length,
    method: null,
    blanks_detected: 0,
    geometric_matches: 0,
    measurements_applied: 0,
    page_results: [],
    synthetic_after: false,
    synthetic_reason: null,
  };

  if (!fields.length) {
    return { schema, diagnostics };
  }

  // 1) Geometric blanks from PDF text gaps (no LLM)
  if (isPdfFile(pdfFile)) {
    try {
      if (onProgress) {
        onProgress('measuring', 70, 'Detecting blanks from PDF text geometry...');
      }
      if (abortController?.signal.aborted) {
        throw new Error('Conversion cancelled');
      }

      const blanks = await detectBlanksFromPdf(pdfFile, { scale: 2 });
      diagnostics.blanks_detected = blanks.length;
      const matches = matchBlanksToFields(fields, blanks, { minScore: 10 });
      diagnostics.geometric_matches = matches.length;
      diagnostics.match_sample = matches.slice(0, 8).map((m) => ({
        path: m.path,
        score: m.score,
        leftLabel: m.leftLabel,
        position: m.position,
      }));

      console.log('[MEASURE_POS] geometric blanks', {
        blanks: blanks.length,
        matches: matches.length,
        sample: diagnostics.match_sample,
      });

      const minNeeded = Math.min(5, Math.max(3, Math.ceil(fields.length * 0.25)));
      if (matches.length >= minNeeded) {
        clearTemplatePositions(schema);
        const measurements = matches.map((m) => ({
          path: m.path,
          position: m.position,
        }));
        const { applied, templateData } = applyMeasuredPositions(
          schema,
          measurements
        );
        diagnostics.method = 'pdf_text_gaps';
        diagnostics.measurements_applied = applied;

        const quality = analyzeTemplatePositionQuality(templateData);
        diagnostics.synthetic_after = quality.synthetic;
        diagnostics.synthetic_reason = quality.reason;
        diagnostics.position_quality = {
          synthetic: quality.synthetic,
          reason: quality.reason,
          shared_x: quality.sharedX,
          sample: quality.sample,
        };

        // If somehow still synthetic, fall through to vision
        if (!quality.synthetic) {
          return { schema: templateData, diagnostics };
        }
        console.warn(
          '[MEASURE_POS] geometric result looked synthetic; falling back to vision'
        );
      } else {
        console.warn(
          `[MEASURE_POS] only ${matches.length} geometric matches (need ${minNeeded}); falling back to vision`
        );
      }
    } catch (geoError) {
      console.warn(
        '[MEASURE_POS] geometric detection failed:',
        geoError?.message || geoError
      );
      diagnostics.geometric_error = geoError?.message || String(geoError);
    }
  }

  // 2) Vision fallback (per page)
  if (!entries.length) {
    return { schema, diagnostics };
  }

  diagnostics.method = diagnostics.method
    ? `${diagnostics.method}+vision_fallback`
    : 'vision_per_page';

  const allMeasurements = [];
  for (let pageIndex = 0; pageIndex < entries.length; pageIndex += 1) {
    if (abortController?.signal.aborted) {
      throw new Error('Conversion cancelled');
    }

    const pct = 70 + ((pageIndex + 1) / entries.length) * 25;
    if (onProgress) {
      onProgress(
        'measuring',
        pct,
        `Vision-measuring blank positions on page ${pageIndex + 1}/${entries.length}...`
      );
    }

    let result = await measureOnePage({
      entry: entries[pageIndex],
      pageIndex,
      fields,
      abortController,
      retry: false,
    });

    if (result.position_quality?.synthetic) {
      console.warn(
        `[MEASURE_POS client] page ${pageIndex} synthetic (${result.position_quality.reason}); retrying`
      );
      result = await measureOnePage({
        entry: entries[pageIndex],
        pageIndex,
        fields,
        abortController,
        retry: true,
      });
    }

    const pageSynthetic = Boolean(result.position_quality?.synthetic);
    diagnostics.page_results.push({
      pageIndex,
      count: result.measurements?.length || 0,
      synthetic: pageSynthetic,
      reason: result.position_quality?.reason || null,
    });

    if (!pageSynthetic && Array.isArray(result.measurements)) {
      allMeasurements.push(...result.measurements);
    }
  }

  if (allMeasurements.length) {
    clearTemplatePositions(schema);
  }
  const { applied, templateData } = applyMeasuredPositions(
    schema,
    allMeasurements
  );
  diagnostics.measurements_applied = applied;

  const quality = analyzeTemplatePositionQuality(templateData);
  diagnostics.synthetic_after = quality.synthetic;
  diagnostics.synthetic_reason = quality.reason;
  diagnostics.position_quality = {
    synthetic: quality.synthetic,
    reason: quality.reason,
    shared_x: quality.sharedX,
    sample: quality.sample,
  };

  return { schema: templateData, diagnostics };
}
