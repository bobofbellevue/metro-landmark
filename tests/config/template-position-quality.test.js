import {
  analyzeTemplatePositionQuality,
  collectFieldPositions,
  hasSyntheticTemplatePositions,
} from '../../src/utils/template-position-quality.js';

function columnSchema() {
  // Matches the Helvetica overlay measured from lease_renewal_67_…pdf
  const ys = [700, 650, 600, 550, 400, 350, 250, 200];
  const fields = {};
  ys.forEach((y, i) => {
    fields[`Field_${i}`] = {
      type: 'string',
      description: `Field ${i}`,
      position: { page: 0, x: 250, y },
    };
  });
  return { Lease: fields };
}

describe('template position quality', () => {
  test('collects leaf positions', () => {
    const positions = collectFieldPositions({
      A: {
        b: { type: 'string', position: { page: 0, x: 10, y: 20 } },
        nested: {
          c: { type: 'date', position: { page: 1, x: 30, y: 40 } },
        },
      },
    });
    expect(positions).toHaveLength(2);
  });

  test('flags the invented vertical PDF-point column', () => {
    const analysis = analyzeTemplatePositionQuality(columnSchema());
    expect(analysis.synthetic).toBe(true);
    expect(analysis.sharedX).toBe(250);
    expect(analysis.reason).toMatch(/vertical_column/);
    expect(hasSyntheticTemplatePositions(columnSchema())).toBe(true);
  });

  test('accepts spread 2x-pixel blank positions', () => {
    const schema = {
      Parties: {
        Agreement_Date: {
          type: 'date',
          position: { page: 0, x: 420, y: 210 },
        },
        Lessor: {
          type: 'string',
          position: { page: 0, x: 380, y: 246 },
        },
        Tenant: {
          type: 'string',
          position: { page: 0, x: 520, y: 278 },
        },
        Property: {
          type: 'string',
          position: { page: 0, x: 410, y: 320 },
        },
        County: {
          type: 'string',
          position: { page: 0, x: 180, y: 352 },
        },
        Rent: {
          type: 'number',
          position: { page: 0, x: 290, y: 980 },
        },
      },
    };
    const analysis = analyzeTemplatePositionQuality(schema);
    expect(analysis.synthetic).toBe(false);
  });

  test('does not flag sparse real layouts', () => {
    const schema = {
      A: {
        a: { type: 'string', position: { page: 0, x: 100, y: 700 } },
        b: { type: 'string', position: { page: 0, x: 200, y: 650 } },
      },
    };
    expect(hasSyntheticTemplatePositions(schema)).toBe(false);
  });
});
