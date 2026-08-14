/**
 * Catalog of known document_type values.
 *
 * `documents.document_type` is a free-form string. This catalog gives stable
 * labels, categories, and audience hints so admin Documents and contextual
 * DocumentManagement panels can group/filter consistently as more types appear
 * (notices, bids, work authorizations, multi-type templates, etc.).
 *
 * Template *source files* use document_type `template_document` and link via
 * `template_id`. The template's own kind lives on `templates.template_type`
 * (Application, Lease, …) — not on document_type.
 */

export const DOCUMENT_TYPE_CATEGORIES = {
  applications: 'Applications',
  leases: 'Leases',
  notices: 'Notices & Compliance',
  maintenance: 'Maintenance',
  templates: 'Template Sources',
  other: 'Other',
};

/** @type {Record<string, { label: string, category: keyof typeof DOCUMENT_TYPE_CATEGORIES, audiences?: string[] }>} */
export const DOCUMENT_TYPE_CATALOG = {
  rental_application: {
    label: 'Rental Application',
    category: 'applications',
    audiences: ['admin', 'landlord', 'applicant', 'tenant'],
  },
  filled_application: {
    label: 'Filled Application',
    category: 'applications',
    audiences: ['admin', 'landlord', 'applicant'],
  },
  lease_document: {
    label: 'Lease',
    category: 'leases',
    audiences: ['admin', 'landlord', 'tenant'],
  },
  signed_lease: {
    label: 'Signed Lease',
    category: 'leases',
    audiences: ['admin', 'landlord', 'tenant'],
  },
  lease_renewal: {
    label: 'Lease Renewal',
    category: 'leases',
    audiences: ['admin', 'landlord', 'tenant'],
  },
  rent_increase_notice: {
    label: 'Rent Increase Notice',
    category: 'notices',
    audiences: ['admin', 'landlord', 'tenant'],
  },
  eviction_notice: {
    label: 'Eviction Notice',
    category: 'notices',
    audiences: ['admin', 'landlord', 'tenant'],
  },
  lease_violation_notice: {
    label: 'Lease Violation Notice',
    category: 'notices',
    audiences: ['admin', 'landlord', 'tenant'],
  },
  lease_termination_notice: {
    label: 'Lease Termination Notice',
    category: 'notices',
    audiences: ['admin', 'landlord', 'tenant'],
  },
  entry_notice: {
    label: 'Entry Notice',
    category: 'notices',
    audiences: ['admin', 'landlord', 'tenant'],
  },
  work_authorization: {
    label: 'Work Authorization',
    category: 'maintenance',
    audiences: ['admin', 'landlord', 'vendor'],
  },
  vendor_bid: {
    label: 'Vendor Bid',
    category: 'maintenance',
    audiences: ['admin', 'landlord', 'vendor'],
  },
  template_document: {
    label: 'Template Source File',
    category: 'templates',
    audiences: ['admin'],
  },
};

/**
 * @param {string | null | undefined} documentType
 * @returns {string}
 */
export function formatDocumentTypeLabel(documentType) {
  if (!documentType) return 'Unknown';
  const known = DOCUMENT_TYPE_CATALOG[documentType];
  if (known) return known.label;
  return String(documentType)
    .split('_')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Build filter options: all catalog types plus any extra types found in data.
 * @param {string[]} [discoveredTypes]
 * @returns {{ value: string, label: string, category: string }[]}
 */
export function buildDocumentTypeFilterOptions(discoveredTypes = []) {
  const seen = new Set();
  const options = [];

  for (const [value, meta] of Object.entries(DOCUMENT_TYPE_CATALOG)) {
    seen.add(value);
    options.push({
      value,
      label: meta.label,
      category: meta.category,
    });
  }

  for (const value of discoveredTypes) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    options.push({
      value,
      label: formatDocumentTypeLabel(value),
      category: 'other',
    });
  }

  return options.sort((a, b) => a.label.localeCompare(b.label));
}
