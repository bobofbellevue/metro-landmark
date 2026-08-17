import {
  activeWorkflowLocationLabel,
  fillWorkflowLeaseScope,
  leaseScopeFields,
  workflowLeaseSelectionPatch,
} from '../../src/utils/workflow-lease-context.js';

const selectedLease = {
  lease_id: 42,
  landlord_id: 9,
  units: {
    unit_id: 3,
    unit_number: '4B',
    properties: {
      property_id: 8,
      property_name: 'Oak Street',
    },
  },
};

describe('leaseScopeFields', () => {
  test('reads unit and property from an enriched picker row', () => {
    expect(leaseScopeFields(selectedLease)).toEqual({
      unit_id: 3,
      property_id: 8,
      landlord_id: 9,
    });
  });

  test('reads unit_id from the lease row when units is not embedded', () => {
    expect(leaseScopeFields({ lease_id: 1, unit_id: 5, landlord_id: 2 })).toEqual({
      unit_id: 5,
      property_id: null,
      landlord_id: 2,
    });
  });
});

describe('fillWorkflowLeaseScope', () => {
  test('fills missing unit and property from the lease', () => {
    expect(
      fillWorkflowLeaseScope({ lease_id: 42 }, selectedLease)
    ).toEqual({
      lease_id: 42,
      unit_id: 3,
      property_id: 8,
      landlord_id: 9,
    });
  });

  test('keeps caller unit_id and property_id', () => {
    expect(
      fillWorkflowLeaseScope(
        { lease_id: 42, unit_id: 99, property_id: 77 },
        selectedLease
      )
    ).toMatchObject({ unit_id: 99, property_id: 77 });
  });
});

describe('workflowLeaseSelectionPatch', () => {
  test('stamps scope ids from the selected lease', () => {
    expect(workflowLeaseSelectionPatch(42, selectedLease)).toEqual({
      lease_id: 42,
      unit_id: 3,
      property_id: 8,
      landlord_id: 9,
    });
  });

  test('clears scope ids when the lease is cleared', () => {
    expect(workflowLeaseSelectionPatch(null, selectedLease)).toEqual({
      lease_id: null,
      unit_id: null,
      property_id: null,
      landlord_id: null,
    });
  });
});

describe('activeWorkflowLocationLabel', () => {
  test('uses the property join when property_id was saved', () => {
    expect(
      activeWorkflowLocationLabel({
        property: { property_name: 'Oak Street' },
        unit: { unit_number: '4B' },
      })
    ).toBe('Oak Street - Unit 4B');
  });

  test('falls back to the nested lease join when property_id is missing', () => {
    expect(
      activeWorkflowLocationLabel({
        lease_id: 42,
        property: null,
        unit: null,
        lease: {
          units: {
            unit_number: '4B',
            properties: { property_name: 'Oak Street' },
          },
        },
      })
    ).toBe('Oak Street - Unit 4B');
  });

  test('does not claim no lease when lease_id is set but joins are empty', () => {
    expect(activeWorkflowLocationLabel({ lease_id: 42 })).toBe('Lease selected');
    expect(activeWorkflowLocationLabel({})).toBe('No lease selected yet');
  });
});
