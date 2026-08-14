import {
  resolveTemplateFieldPosition,
  templateUsesImagePixelPositions,
} from '../../utils/template-field-position.js';
import { countFieldsWithPositions } from '../../utils/template-pdf-render.js';

describe('resolveTemplateFieldPosition', () => {
  const letter = { width: 612, height: 792 };

  test('converts 2x image pixel coords (top-left) to PDF points (bottom-left)', () => {
    // Mid-page blank on a 2x US Letter image: x=600px, y=800px from top
    const resolved = resolveTemplateFieldPosition(
      { page: 0, x: 600, y: 800 },
      letter
    );

    expect(resolved).toEqual({
      pageIndex: 0,
      x: 300,
      y: 792 - 400,
      convertedFromPixels: true,
    });
  });

  test('converts top-of-page pixel coords when forceImagePixels is set', () => {
    // Agreement_Date style: y=256px from top looks like a PDF point alone
    const resolved = resolveTemplateFieldPosition(
      { page: 0, x: 306.5458, y: 256 },
      letter,
      { forceImagePixels: true }
    );

    expect(resolved.convertedFromPixels).toBe(true);
    expect(resolved.x).toBeCloseTo(153.2729, 4);
    expect(resolved.y).toBeCloseTo(792 - 128, 4);
  });

  test('honors explicit space: image_2x', () => {
    const resolved = resolveTemplateFieldPosition(
      { page: 0, x: 306, y: 256, space: 'image_2x' },
      letter
    );
    expect(resolved.convertedFromPixels).toBe(true);
  });

  test('leaves small PDF-point coordinates unchanged', () => {
    const resolved = resolveTemplateFieldPosition(
      { page: 1, x: 72, y: 720 },
      letter
    );

    expect(resolved).toEqual({
      pageIndex: 1,
      x: 72,
      y: 720,
      convertedFromPixels: false,
    });
  });

  test('returns null for missing or invalid positions', () => {
    expect(resolveTemplateFieldPosition(null, letter)).toBeNull();
    expect(resolveTemplateFieldPosition({ x: 'a', y: 10 }, letter)).toBeNull();
    expect(resolveTemplateFieldPosition({ x: 10 }, letter)).toBeNull();
  });
});

describe('templateUsesImagePixelPositions', () => {
  test('detects 2x space from any large coordinate in the schema', () => {
    const schema = {
      Lease: {
        Agreement_Date: {
          type: 'string',
          position: { page: 0, x: 306, y: 256 },
        },
        Rent_Amount: {
          type: 'number',
          position: { page: 0, x: 303, y: 1096 },
        },
      },
    };
    expect(templateUsesImagePixelPositions(schema, { width: 612, height: 792 })).toBe(
      true
    );
  });
});

describe('countFieldsWithPositions', () => {
  test('counts nested fields with coordinates', () => {
    const count = countFieldsWithPositions({
      Lease: {
        Parties: {
          Lessor: {
            type: 'string',
            position: { page: 0, x: 100, y: 200 },
          },
        },
        Terms: {
          start_date: {
            type: 'date',
            position: { page: 0, x: 120, y: 400 },
          },
          note: { type: 'string', description: 'no position' },
        },
      },
    });
    expect(count).toBe(2);
  });
});
