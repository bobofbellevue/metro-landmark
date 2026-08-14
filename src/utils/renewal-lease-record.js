/**
 * Pure helpers for creating a renewed lease row from an existing lease.
 */

import { todayWorkflowDate } from './workflow-date.js';

/**
 * Build the leases insert payload for a renewal.
 * Identity FKs (unit, landlord, pmc, clients) stay on the original parties;
 * term/rent come from the renewal workflow.
 *
 * @param {object} originalLease
 * @param {{
 *   start_date: string,
 *   end_date?: string|null,
 *   monthly_rent_amount: number,
 *   date_of_agreement?: string|null,
 *   template_id?: number|null,
 *   document_data?: object|null,
 *   status?: string,
 * }} renewal
 * @returns {object}
 */
export function buildRenewalLeaseInsert(originalLease, renewal = {}) {
  if (!originalLease?.unit_id) {
    throw new Error('Original lease is missing unit_id');
  }
  if (!renewal.start_date) {
    throw new Error('Renewal start_date is required');
  }

  const rent = Number(renewal.monthly_rent_amount);
  if (Number.isNaN(rent)) {
    throw new Error('Renewal monthly_rent_amount is required');
  }

  return {
    unit_id: originalLease.unit_id,
    landlord_id: originalLease.landlord_id ?? null,
    pmc_id: originalLease.pmc_id ?? null,
    start_date: renewal.start_date,
    end_date: renewal.end_date || null,
    monthly_rent_amount: rent,
    status: renewal.status || 'active',
    date_of_agreement: renewal.date_of_agreement || todayWorkflowDate(),
    security_deposit_amount: originalLease.security_deposit_amount ?? null,
    pet_deposit_amount: originalLease.pet_deposit_amount ?? null,
    other_fee_amount: originalLease.other_fee_amount ?? null,
    dependent_names: originalLease.dependent_names ?? null,
    pets: originalLease.pets ?? null,
    comment: originalLease.comment ?? null,
    template_id:
      renewal.template_id != null
        ? renewal.template_id
        : originalLease.template_id ?? null,
    document_data: renewal.document_data ?? null,
  };
}

/**
 * Collect client_ids linked to the original lease for lease_clients copy.
 * @param {object} originalLease
 * @returns {number[]}
 */
export function collectOriginalLeaseClientIds(originalLease) {
  const rows = originalLease?.lease_clients || [];
  const ids = rows
    .map((lc) => lc.client_id || lc.client?.client_id || lc.clients?.client_id)
    .filter((id) => id != null);
  return [...new Set(ids)];
}
