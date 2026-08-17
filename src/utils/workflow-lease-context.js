/**
 * Lease / unit / property fields for compliance workflow rows and list labels.
 */

/**
 * Nested select so Active Workflows can label a row from the lease even when
 * unit_id / property_id were never copied onto compliance_workflows.
 */
export const ACTIVE_WORKFLOW_LIST_SELECT = `
  *,
  lease:leases(
    lease_id,
    unit_id,
    units(
      unit_id,
      unit_number,
      properties(
        property_id,
        property_name
      )
    )
  ),
  unit:units(unit_id, unit_number),
  property:properties(property_id, property_name)
`;

function firstRelation(value) {
  if (Array.isArray(value)) return value[0] || null;
  return value && typeof value === 'object' ? value : null;
}

function present(value) {
  return value != null && value !== '';
}

/**
 * Unit / property / landlord ids from an enriched lease picker row (or a
 * leases query that embeds units).
 *
 * @param {Record<string, unknown> | null | undefined} lease
 * @returns {{ unit_id: unknown, property_id: unknown, landlord_id: unknown }}
 */
export function leaseScopeFields(lease = {}) {
  const unitRow = firstRelation(lease?.units) || firstRelation(lease?.unit) || {};
  const propertyRow =
    firstRelation(unitRow.properties) || firstRelation(unitRow.property) || {};
  return {
    unit_id: unitRow.unit_id ?? lease?.unit_id ?? null,
    property_id:
      propertyRow.property_id ?? unitRow.property_id ?? lease?.property_id ?? null,
    landlord_id: lease?.landlord_id ?? propertyRow.landlord_id ?? null,
  };
}

/**
 * Fill missing scope columns from a lease row. Caller values win when present.
 *
 * @param {Record<string, unknown>} fields
 * @param {Record<string, unknown> | null} [lease]
 */
export function fillWorkflowLeaseScope(fields = {}, lease = null) {
  const scope = lease ? leaseScopeFields(lease) : {};
  return {
    lease_id: present(fields.lease_id) ? fields.lease_id : (lease?.lease_id ?? null),
    unit_id: present(fields.unit_id) ? fields.unit_id : (scope.unit_id ?? null),
    property_id: present(fields.property_id)
      ? fields.property_id
      : (scope.property_id ?? null),
    landlord_id: present(fields.landlord_id)
      ? fields.landlord_id
      : (scope.landlord_id ?? null),
  };
}

/**
 * Patch to write when the operator picks (or clears) a lease.
 *
 * @param {number|string|null|undefined} leaseId
 * @param {Record<string, unknown> | null | undefined} selected
 */
export function workflowLeaseSelectionPatch(leaseId, selected = null) {
  if (!present(leaseId)) {
    return {
      lease_id: null,
      unit_id: null,
      property_id: null,
      landlord_id: null,
    };
  }
  const scope = leaseScopeFields(selected || {});
  return {
    lease_id: leaseId,
    unit_id: scope.unit_id,
    property_id: scope.property_id,
    landlord_id: scope.landlord_id,
  };
}

/**
 * Stamp lease scope onto workflow_data through updateField.
 *
 * @param {(fieldId: string, value: unknown) => void} updateField
 * @param {number|string|null|undefined} leaseId
 * @param {Record<string, unknown> | null | undefined} selected
 */
export function stampLeaseSelection(updateField, leaseId, selected) {
  const patch = workflowLeaseSelectionPatch(leaseId, selected);
  Object.entries(patch).forEach(([key, value]) => updateField(key, value));
}

/**
 * Property + unit subtitle for Active Workflows (and similar lists).
 *
 * @param {Record<string, unknown> | null | undefined} workflow
 * @returns {string}
 */
export function activeWorkflowLocationLabel(workflow) {
  const nestedUnit =
    firstRelation(workflow?.lease?.units) || firstRelation(workflow?.lease?.unit);
  const nestedProperty =
    firstRelation(nestedUnit?.properties) || firstRelation(nestedUnit?.property);
  const propertyName =
    workflow?.property?.property_name || nestedProperty?.property_name || null;
  const unitNumber =
    workflow?.unit?.unit_number || nestedUnit?.unit_number || null;

  if (propertyName) {
    return `${propertyName} - Unit ${unitNumber ?? '—'}`;
  }

  const leaseId = workflow?.lease_id ?? workflow?.workflow_data?.lease_id;
  if (present(leaseId)) {
    return unitNumber ? `Unit ${unitNumber}` : 'Lease selected';
  }
  return 'No lease selected yet';
}
