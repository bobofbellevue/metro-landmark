/**
 * Security deposit return statement math and tenant-facing PDF lines.
 * Deadline is 30 days after termination and vacation (RCW 59.18.280), not a
 * notice-before-effective-date clock.
 */

function money(amount) {
  const n = Number(amount);
  const value = Number.isFinite(n) ? n : 0;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * @param {Array<{ reason?: string, amount?: number|string }>|null|undefined} rows
 * @returns {{ reason: string, amount: number }[]}
 */
export function normalizeDepositDeductions(rows) {
  return (rows || [])
    .map((row) => ({
      reason: String(row?.reason || '').trim(),
      amount: Number(row?.amount),
    }))
    .filter((row) => row.reason && Number.isFinite(row.amount) && row.amount !== 0);
}

/**
 * @param {Array<{ reason?: string, amount?: number|string }>|null|undefined} rows
 * @returns {number}
 */
export function sumDepositDeductions(rows) {
  return normalizeDepositDeductions(rows).reduce((sum, row) => sum + row.amount, 0);
}

/**
 * @param {{ securityDeposit?: number|string|null, petDeposit?: number|string|null }} amounts
 * @returns {number}
 */
export function heldDepositTotal({ securityDeposit = 0, petDeposit = 0 } = {}) {
  return (Number(securityDeposit) || 0) + (Number(petDeposit) || 0);
}

/**
 * @param {number} held
 * @param {Array<{ reason?: string, amount?: number|string }>|null|undefined} deductions
 * @returns {number}
 */
export function depositReturnAmount(held, deductions) {
  return Number(held || 0) - sumDepositDeductions(deductions);
}

/**
 * @param {Record<string, unknown>} data
 * @returns {string}
 */
export function depositReturnFingerprint(data = {}) {
  const deductions = normalizeDepositDeductions(data.deductions)
    .map((row) => `${row.reason}:${row.amount}`)
    .join(';');
  return [
    data.lease_id,
    data.vacation_date,
    data.original_deposit ?? data.security_deposit,
    data.pet_deposit || 0,
    deductions,
  ].join('|');
}

/**
 * Tenant-facing body for the deposit return statement PDF.
 * @param {object} data
 * @returns {string[]}
 */
export function buildDepositReturnStatementLines(data = {}) {
  const unit = String(data.unitNumber || '').trim();
  const deductions = normalizeDepositDeductions(data.deductions);
  const held = heldDepositTotal({
    securityDeposit: data.securityDeposit,
    petDeposit: data.petDeposit,
  });
  const returned = depositReturnAmount(held, deductions);
  const lines = [
    `To: ${data.tenantNames || 'Tenant'}`,
    '',
    `Property: ${data.propertyName || 'N/A'}`,
  ];
  if (unit) lines.push(`Unit: ${unit}`);
  lines.push(
    '',
    `Security deposit held: ${money(data.securityDeposit)}`
  );
  if (Number(data.petDeposit) > 0) {
    lines.push(`Pet deposit held: ${money(data.petDeposit)}`);
  }
  lines.push(`Total held: ${money(held)}`, '');
  if (deductions.length) {
    lines.push('Deductions:');
    for (const row of deductions) {
      lines.push(`${row.reason}: ${money(row.amount)}`);
    }
    lines.push(`Total deductions: ${money(sumDepositDeductions(deductions))}`, '');
  } else {
    lines.push('Deductions: none', '');
  }
  lines.push(
    `Amount to return: ${money(returned)}`,
    `Termination and vacation date: ${data.vacationDateLabel || ''}`,
    `Statement due by: ${data.dueByLabel || ''}`,
    '',
    'Not legal advice. See RCW 59.18.280.'
  );
  return lines;
}
