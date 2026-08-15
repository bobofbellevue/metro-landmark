/**
 * Proof-of-service uploads: photos or PDFs attached to a compliance workflow.
 */

export const PROOF_OF_SERVICE_DOCUMENT_TYPE = 'proof_of_service';

export const PROOF_OF_SERVICE_ACCEPT = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
];

const ALLOWED_EXTENSIONS = [
  '.pdf',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.heic',
  '.heif',
];

/**
 * @param {{ type?: string, name?: string }|null|undefined} file
 * @returns {boolean}
 */
export function isAllowedProofOfServiceFile(file) {
  if (!file) return false;
  const type = String(file.type || '').toLowerCase();
  if (PROOF_OF_SERVICE_ACCEPT.includes(type)) return true;
  const name = String(file.name || '').toLowerCase();
  return ALLOWED_EXTENSIONS.some((ext) => name.endsWith(ext));
}

/**
 * @param {object|string|null|undefined} value
 * @returns {string}
 */
export function proofOfServiceFileLabel(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.trim();
  return String(value.file_name || value.document_name || '').trim();
}
