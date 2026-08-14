/* eslint-env node */
import OpenAI from 'openai';
import { analyzeTemplatePositionQuality } from '../../src/utils/template-position-quality.js';

/**
 * Second-pass vision: measure blank/checkbox coordinates on ONE page image.
 *
 * Schema extraction invents neat vertical columns; this endpoint asks only for
 * geometry with known image dimensions and a known field list.
 *
 * POST /api/documents/measure-field-positions
 * Body: {
 *   image: data:image/... URL,
 *   pageIndex: number,
 *   width: number,
 *   height: number,
 *   fields: [{ path, type, description }]
 * }
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed. Use POST.' });
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_KEY;
    if (!apiKey) {
      return res.status(500).json({
        success: false,
        error: 'OpenAI API key not configured.',
      });
    }

    const {
      image,
      pageIndex = 0,
      width,
      height,
      fields,
      retry = false,
    } = req.body || {};

    if (!image || typeof image !== 'string' || !image.startsWith('data:image/')) {
      return res.status(400).json({
        success: false,
        error: 'image must be a data:image/... URL',
      });
    }
    if (!Array.isArray(fields) || fields.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'fields array is required',
      });
    }

    const imgW = Number(width) || 1224;
    const imgH = Number(height) || 1584;
    const page = Number.isFinite(Number(pageIndex)) ? Number(pageIndex) : 0;

    const openai = new OpenAI({ apiKey });
    const model = process.env.OPENAI_MODEL || 'gpt-4o';
    const visionModel = model.includes('o1')
      ? 'gpt-4o'
      : model.includes('gpt-4')
        ? model
        : 'gpt-4o';

    const fieldList = fields
      .map(
        (f, i) =>
          `${i + 1}. path=${JSON.stringify(f.path)} type=${f.type || 'string'} — ${f.description || f.path}`
      )
      .join('\n');

    const retryExtra = retry
      ? `
RETRY — previous answer was REJECTED because every blank shared the same X (invented column).
You MUST look at the actual underline locations. Lessor, tenant, county, rent, deposit blanks
are at DIFFERENT horizontal positions on a real lease form. Return spread X values.`
      : '';

    const systemMessage = `You measure fill-in blank locations on a single form page image.
Return ONLY JSON: { "measurements": [ { "path": string, "x": number, "y": number } ] }

Coordinate system (MANDATORY):
- Units: image pixels
- Origin: TOP-LEFT of this image (0,0)
- X increases right; Y increases DOWN
- This image is EXACTLY ${imgW} pixels wide by ${imgH} pixels tall
- Every x must be between 0 and ${imgW}; every y between 0 and ${imgH}

How to measure:
- Find the visible blank line, underscore, checkbox, or input box for each field
- x = pixel distance from the LEFT edge to where typed text should START on that blank
- y = pixel distance from the TOP edge to the blank's baseline (center of the underscore)
- Measure EACH blank independently by looking at the image — do not invent a grid
- If a label ends with a colon or "named persons" and the underscore is on the NEXT line, place x/y on that underscore line — NOT at the end of the label sentence
- For mid-sentence blanks ("a charge ______ of for each NSF check"), place the value in the underscore gap — NOT after the paragraph

Hard bans:
- Do NOT invent a vertical column (same x for many fields with evenly stepped y)
- Do NOT use PDF points (page width 612). Use the pixel size above.
- Do NOT multiply guessed PDF points by 2. Look at the pixels in the image.
- Do NOT place values at the end of a sentence when a blank/underscore exists earlier on the line or on the line below
- Omit fields that are not visible on THIS page
- Include checkboxes only if the box itself is on this page

Output paths MUST be copied exactly from the provided field list.`;

    const userText = `Page index ${page} (0-based). Image size ${imgW}×${imgH} px (top-left origin).
${retryExtra}

Fields that may appear on this page (omit any not visible here):
${fieldList}

Return JSON: { "measurements": [ { "path": "...", "x": 380, "y": 246 }, ... ] }
Use real measured pixel coordinates with DIFFERENT x values for blanks on different parts of the line.`;

    console.log(
      `[MEASURE_POS] page=${page} fields=${fields.length} size=${imgW}x${imgH} retry=${Boolean(retry)} model=${visionModel}`
    );

    const response = await openai.chat.completions.create({
      model: visionModel,
      messages: [
        { role: 'system', content: systemMessage },
        {
          role: 'user',
          content: [
            { type: 'text', text: userText },
            {
              type: 'image_url',
              image_url: { url: image, detail: 'high' },
            },
          ],
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 2500,
    });

    let parsed;
    try {
      parsed = JSON.parse(response.choices[0].message.content);
    } catch {
      return res.status(500).json({
        success: false,
        error: 'Failed to parse position measurement JSON',
        raw: response.choices[0].message.content?.substring(0, 500),
      });
    }

    const rawList = Array.isArray(parsed?.measurements)
      ? parsed.measurements
      : Array.isArray(parsed?.positions)
        ? parsed.positions
        : Array.isArray(parsed)
          ? parsed
          : [];

    const knownPaths = new Set(fields.map((f) => f.path));
    const measurements = [];
    for (const item of rawList) {
      const path = item?.path || item?.field_path || item?.name;
      const x = Number(item?.x ?? item?.position?.x);
      const y = Number(item?.y ?? item?.position?.y);
      if (!path || !knownPaths.has(path)) continue;
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < 0 || y < 0 || x > imgW || y > imgH) continue;
      measurements.push({
        path,
        position: { page, x, y },
      });
    }

    // Build a mini schema for quality analysis of THIS page's measurements
    const probe = { Page: {} };
    measurements.forEach((m, i) => {
      probe.Page[`f${i}`] = {
        type: 'string',
        position: m.position,
      };
    });
    const quality = analyzeTemplatePositionQuality(probe, { minFields: 5 });

    console.log(
      `[MEASURE_POS] page=${page} kept=${measurements.length} synthetic=${quality.synthetic} reason=${quality.reason}`
    );

    return res.status(200).json({
      success: true,
      pageIndex: page,
      measurements,
      position_quality: {
        synthetic: quality.synthetic,
        reason: quality.reason,
        shared_x: quality.sharedX,
        sample: quality.sample,
      },
      usage: response.usage,
      model: visionModel,
    });
  } catch (error) {
    console.error('[MEASURE_POS] error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
    });
  }
}
