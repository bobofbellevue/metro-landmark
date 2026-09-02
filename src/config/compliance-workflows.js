/**
 * Compliance Center workflows in tenancy-lifecycle order.
 * Numbers are operator-facing two-digit codes (01–12), not database ids.
 */

export const COMPLIANCE_LIFECYCLE_STAGES = Object.freeze([
  { id: 'start', label: 'Start of tenancy' },
  { id: 'occupancy', label: 'During occupancy' },
  { id: 'end', label: 'End of tenancy' },
]);

export const COMPLIANCE_WORKFLOW_CATALOG = Object.freeze([
  {
    id: 'tenant_screening',
    number: 1,
    stage: 'start',
    title: 'Tenant Screening Compliance',
    description:
      'Screen the applicant queue in received order. Seattle first-qualified: decide earlier pending applications first.',
  },
  {
    id: 'move_in',
    number: 2,
    stage: 'start',
    title: 'Move-In Process',
    description:
      'Record the unit condition at move-in and save a checklist PDF in Documents.',
  },
  {
    id: 'entry_notice',
    number: 3,
    stage: 'occupancy',
    title: 'Entry Notices',
    description:
      'Generate a two-day written entry notice (one day for showings), or record an emergency exception.',
  },
  {
    id: 'rent_increase',
    number: 4,
    stage: 'occupancy',
    title: 'Rent Increase Notice',
    description:
      'Calculate the notice period, generate the PDF, then print or email it and record service (or save for later).',
  },
  {
    id: 'lease_renewal',
    number: 5,
    stage: 'occupancy',
    title: 'Lease Renewal',
    description:
      'Generate renewal offer with proper notice period and track acceptance.',
  },
  {
    id: 'habitability',
    number: 6,
    stage: 'occupancy',
    title: 'Habitability Issues',
    description:
      'Record a defective condition, the commence-repair window, and an optional work order, then save a worksheet in Documents.',
  },
  {
    id: 'lease_violation',
    number: 7,
    stage: 'occupancy',
    title: 'Lease Violation Notices',
    description:
      'Generate a comply-or-vacate worksheet from the 10- or 20-day notice type, then print or email it and record service.',
  },
  {
    id: 'collections',
    number: 8,
    stage: 'occupancy',
    title: 'Collections Process',
    description:
      'Record the amount owed, then start a 3-day pay-or-vacate notice in Eviction or save a payment-plan outcome.',
  },
  {
    id: 'lease_termination',
    number: 9,
    stage: 'end',
    title: 'Lease Termination Notices',
    description:
      'End a tenancy with jurisdiction notice days, just-cause / renewal-offer checks, then generate a worksheet and record service.',
  },
  {
    id: 'eviction',
    number: 10,
    stage: 'end',
    title: 'Eviction Process',
    description:
      'Generate the eviction notice, then print or email it and record service (or save for later).',
  },
  {
    id: 'move_out',
    number: 11,
    stage: 'end',
    title: 'Move-Out Process',
    description:
      'Inspect at move-out, compare to move-in, and list deductions for the deposit statement.',
  },
  {
    id: 'security_deposit',
    number: 12,
    stage: 'end',
    title: 'Security Deposit Return',
    description:
      'Itemize deductions and generate a deposit return statement within 30 days after the tenant vacates.',
  },
]);

export const COMPLIANCE_WORKFLOW_TITLES = Object.freeze(
  Object.fromEntries(COMPLIANCE_WORKFLOW_CATALOG.map((item) => [item.id, item.title]))
);

/**
 * @param {number|string} number
 * @returns {string}
 */
export function formatComplianceWorkflowNumber(number) {
  const n = Number(number);
  if (!Number.isFinite(n) || n < 1) return '';
  return String(Math.trunc(n)).padStart(2, '0');
}

export function getComplianceWorkflow(workflowType) {
  if (!workflowType) return null;
  return COMPLIANCE_WORKFLOW_CATALOG.find((item) => item.id === workflowType) || null;
}

export function complianceWorkflowTitle(workflowType) {
  if (!workflowType) return '';
  return COMPLIANCE_WORKFLOW_TITLES[workflowType] || '';
}

export function complianceWorkflowNumber(workflowType) {
  const item = getComplianceWorkflow(workflowType);
  return item ? formatComplianceWorkflowNumber(item.number) : '';
}

/**
 * Operator label with lifecycle number, e.g. "04 Rent Increase Notice".
 * @param {string} workflowType
 * @returns {string}
 */
export function labeledComplianceWorkflow(workflowType) {
  if (workflowType === 'rent_control') return 'Rent Control (removed)';
  const title = complianceWorkflowTitle(workflowType);
  if (!title) return workflowType || '';
  const number = complianceWorkflowNumber(workflowType);
  return number ? `${number} ${title}` : title;
}

export function complianceWorkflowCardId(workflowTypeOrNumber) {
  const item =
    typeof workflowTypeOrNumber === 'number'
      ? COMPLIANCE_WORKFLOW_CATALOG.find((row) => row.number === workflowTypeOrNumber)
      : getComplianceWorkflow(workflowTypeOrNumber);
  if (!item) return '';
  return `compliance-workflow-${formatComplianceWorkflowNumber(item.number)}`;
}

function normalizeSearchQuery(query) {
  return String(query || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function numberTokens(item) {
  const padded = formatComplianceWorkflowNumber(item.number);
  return [padded, String(item.number), `${padded}.`];
}

/**
 * Filter the catalog by two-digit number, name, or description.
 * @param {string} query
 * @param {typeof COMPLIANCE_WORKFLOW_CATALOG} [catalog]
 */
export function searchComplianceWorkflows(query, catalog = COMPLIANCE_WORKFLOW_CATALOG) {
  const q = normalizeSearchQuery(query);
  if (!q) return [...catalog];
  const isNumericQuery = /^\d+\.?$/.test(q);
  return catalog.filter((item) => {
    const tokens = numberTokens(item);
    if (tokens.some((token) => token === q || token.startsWith(q))) return true;
    if (isNumericQuery) return false;
    const hay = `${item.title} ${item.description} ${item.id.replace(/_/g, ' ')}`.toLowerCase();
    return hay.includes(q);
  });
}

/**
 * Choose a workflow to jump to from a search query.
 * Exact number wins; otherwise a single remaining match.
 * @param {string} query
 * @param {Array<{ id: string, number: number }>} [matches]
 */
export function pickComplianceWorkflowForJump(
  query,
  matches = searchComplianceWorkflows(query)
) {
  const q = normalizeSearchQuery(query);
  if (!q || !matches.length) return null;
  const exact = matches.find((item) =>
    numberTokens(item).some((token) => token === q)
  );
  if (exact) return exact;
  if (matches.length === 1) return matches[0];
  return null;
}
