import {
  addTemplateField,
  applyBoxDelta,
  clientPointToImageCoords,
  cloneTemplateData,
  defaultPlacementParentPath,
  isPlacementApproved,
  listPlacementFields,
  markPlacementApproved,
  normalizePlacementBox,
  placeFieldAtPoint,
  removeFieldByPath,
  renameFieldByPath,
  sanitizeFieldKey,
  setFieldMetaByPath,
} from '../../src/utils/template-field-placement.js';
import { listTemplateLeafFields } from '../../src/utils/template-field-paths.js';

function schema() {
  return {
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
    },
  };
}

describe('template field placement', () => {
  test('sanitizeFieldKey turns a label into a schema key', () => {
    expect(sanitizeFieldKey('Tenant name')).toBe('Tenant_name');
    expect(sanitizeFieldKey('  2nd floor  ')).toBe('F_2nd_floor');
    expect(sanitizeFieldKey('')).toBe('Field');
  });

  test('skips _placement when listing fields', () => {
    const data = schema();
    markPlacementApproved(data, new Date('2026-08-31T00:00:00.000Z'));
    const paths = listTemplateLeafFields(data).map((f) => f.path).sort();
    expect(paths).toEqual(['Lease.Agreement_Date', 'Lease.Lessor']);
    expect(isPlacementApproved(data)).toBe(true);
  });

  test('adds a field under the default section', () => {
    const data = schema();
    expect(defaultPlacementParentPath(data)).toBe('Lease');
    const added = addTemplateField(data, { key: 'County', type: 'string' });
    expect(added.path).toBe('Lease.County');
    expect(data.Lease.County.type).toBe('string');
  });

  test('renames, retypes, and removes a field', () => {
    const data = schema();
    const renamed = renameFieldByPath(data, 'Lease.Lessor', 'Owner');
    expect(renamed).toBe('Lease.Owner');
    expect(data.Lease.Lessor).toBeUndefined();
    expect(data.Lease.Owner.description).toBe('Lessor name');
    expect(setFieldMetaByPath(data, 'Lease.Owner', { type: 'date' })).toBe(true);
    expect(data.Lease.Owner.type).toBe('date');
    expect(removeFieldByPath(data, 'Lease.Owner')).toBe(true);
    expect(data.Lease.Owner).toBeUndefined();
  });

  test('refuses duplicate or reserved rename keys', () => {
    const data = schema();
    expect(renameFieldByPath(data, 'Lease.Lessor', 'Agreement_Date')).toBeNull();
    expect(renameFieldByPath(data, 'Lease.Lessor', 'type')).toBeNull();
  });

  test('places an unplaced field at a click point', () => {
    const data = schema();
    addTemplateField(data, { key: 'Rent', type: 'number' });
    expect(placeFieldAtPoint(data, 'Lease.Rent', { page: 1, x: 40, y: 80 })).toBe(
      true
    );
    expect(data.Lease.Rent.position).toMatchObject({
      page: 1,
      x: 40,
      y: 80,
      space: 'image_2x',
    });
  });

  test('normalizePlacementBox fills default size', () => {
    expect(normalizePlacementBox({ page: 0, x: 10, y: 20 }, 'string')).toEqual({
      page: 0,
      x: 10,
      y: 20,
      width: 180,
      height: 28,
      space: 'image_2x',
    });
    expect(normalizePlacementBox(null)).toBeNull();
  });

  test('applyBoxDelta moves and clamps to the page', () => {
    const moved = applyBoxDelta(
      { page: 0, x: 10, y: 10, width: 40, height: 20 },
      'move',
      5,
      -3,
      200,
      200
    );
    expect(moved).toMatchObject({ x: 15, y: 7, width: 40, height: 20 });
    const offPage = applyBoxDelta(
      { page: 0, x: 10, y: 10, width: 40, height: 20 },
      'move',
      1000,
      1000,
      200,
      200
    );
    expect(offPage.x).toBe(160);
    expect(offPage.y).toBe(180);
  });

  test('applyBoxDelta resizes from the south-east handle', () => {
    const resized = applyBoxDelta(
      { page: 0, x: 10, y: 10, width: 40, height: 20 },
      'se',
      10,
      8,
      200,
      200
    );
    expect(resized).toMatchObject({ x: 10, y: 10, width: 50, height: 28 });
  });

  test('clientPointToImageCoords maps display space onto the page image', () => {
    const pt = clientPointToImageCoords(
      150,
      80,
      { left: 100, top: 50, width: 200, height: 100 },
      1000,
      500
    );
    expect(pt).toEqual({ x: 250, y: 150 });
  });

  test('listPlacementFields includes boxes and clone is detached', () => {
    const data = schema();
    const fields = listPlacementFields(data);
    expect(fields.find((f) => f.path === 'Lease.Lessor').box.x).toBe(220);
    const copy = cloneTemplateData(data);
    copy.Lease.Lessor.description = 'changed';
    expect(data.Lease.Lessor.description).toBe('Lessor name');
  });
});
