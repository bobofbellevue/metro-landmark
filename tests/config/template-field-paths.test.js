import {
  applyMeasuredPositions,
  listTemplateLeafFields,
  offsetTemplatePositionPages,
  setFieldPositionByPath,
} from '../../src/utils/template-field-paths.js';

describe('template-field-paths', () => {
  const schema = () => ({
    Lease: {
      Agreement_Date: {
        type: 'string',
        description: 'Date',
        position: { page: 0, x: 220, y: 120 },
      },
      Lessor: {
        type: 'string',
        description: 'Lessor name',
        position: { page: 0, x: 220, y: 160 },
      },
      Applicants: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            First_Name: {
              type: 'string',
              description: 'First name',
              position: { page: 0, x: 100, y: 200 },
            },
          },
        },
      },
    },
  });

  test('lists leaf fields including array item properties', () => {
    const fields = listTemplateLeafFields(schema());
    const paths = fields.map((f) => f.path).sort();
    expect(paths).toEqual([
      'Lease.Agreement_Date',
      'Lease.Applicants[].First_Name',
      'Lease.Lessor',
    ]);
  });

  test('applies measured positions by path', () => {
    const data = schema();
    const { applied } = applyMeasuredPositions(data, [
      {
        path: 'Lease.Lessor',
        position: { page: 0, x: 410, y: 246 },
      },
      {
        path: 'Lease.Applicants[].First_Name',
        position: { page: 0, x: 210, y: 312 },
      },
    ]);
    expect(applied).toBe(2);
    expect(data.Lease.Lessor.position).toEqual({ page: 0, x: 410, y: 246 });
    expect(data.Lease.Applicants.items.properties.First_Name.position).toEqual({
      page: 0,
      x: 210,
      y: 312,
    });
  });

  test('offsets page indexes after batched schema merge', () => {
    const data = schema();
    offsetTemplatePositionPages(data, 5);
    expect(data.Lease.Agreement_Date.position.page).toBe(5);
    expect(data.Lease.Applicants.items.properties.First_Name.position.page).toBe(
      5
    );
  });

  test('setFieldPositionByPath merges width, height, and space', () => {
    const data = schema();
    expect(
      setFieldPositionByPath(data, 'Lease.Lessor', {
        page: 0,
        x: 410,
        y: 246,
        width: 200,
        height: 30,
        space: 'image_2x',
      })
    ).toBe(true);
    expect(data.Lease.Lessor.position).toEqual({
      page: 0,
      x: 410,
      y: 246,
      width: 200,
      height: 30,
      space: 'image_2x',
    });
  });
});
