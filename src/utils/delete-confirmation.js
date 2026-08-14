/**
 * Typed confirmation helpers for permanent delete dialogs.
 * Require at least the first N characters of the entity name.
 * Longer typed input is OK up to the full name when it still matches.
 * Input must not exceed the full name length.
 *
 * The required prefix never ends with whitespace: if character N is a space,
 * the prefix extends to include the next non-space character(s). Otherwise
 * trimming would shrink "Lease for " (10) to "Lease for" (9) and break matching.
 */

export const DELETE_CONFIRM_PREFIX_LENGTH = 10;

/**
 * @param {string} name
 * @returns {string}
 */
function trimmedName(name) {
  return String(name || '').trim();
}

/**
 * Required confirmation prefix. At least `maxLen` characters, or the full
 * name when shorter. Never ends with whitespace.
 *
 * @param {string} name
 * @param {number} [maxLen]
 * @returns {string}
 */
export function getDeleteConfirmationTarget(name, maxLen = DELETE_CONFIRM_PREFIX_LENGTH) {
  const trimmed = trimmedName(name);
  if (!trimmed) return '';
  if (trimmed.length <= maxLen) return trimmed;

  let end = maxLen;
  // If the N-char cut lands on trailing spaces, extend into the next word.
  while (end < trimmed.length && /\s/.test(trimmed[end - 1])) {
    end += 1;
  }
  return trimmed.slice(0, end);
}

/**
 * Maximum characters the user may type (the full entity name).
 * @param {string} name
 * @returns {number}
 */
export function getDeleteConfirmationMaxLength(name) {
  return trimmedName(name).length;
}

/**
 * Clamp typed confirmation to at most the full name length.
 * @param {string} input
 * @param {string} name
 * @returns {string}
 */
export function clampDeleteConfirmationInput(input, name) {
  const fullName = trimmedName(name);
  const raw = String(input || '');
  if (!fullName) return '';
  return raw.slice(0, fullName.length);
}

/**
 * Accepts the required prefix, or any longer prefix of the entity name
 * up to the full string. Longer than the name is never accepted.
 *
 * @param {string} input
 * @param {string} name
 * @param {number} [maxLen]
 * @returns {boolean}
 */
export function matchesDeleteConfirmation(input, name, maxLen = DELETE_CONFIRM_PREFIX_LENGTH) {
  const fullName = trimmedName(name);
  const target = getDeleteConfirmationTarget(fullName, maxLen);
  if (!fullName || !target) return false;

  // Ignore accidental leading spaces only. Do not trimEnd before the
  // length check in a way that reintroduces the "Lease for " → 9-char bug;
  // instead require a prefix of fullName of length >= target.
  const typed = String(input ?? '').trimStart().trimEnd();
  if (!typed) return false;
  if (typed.length > fullName.length) return false;
  if (!fullName.startsWith(typed)) return false;
  if (typed.length < target.length) return false;
  return true;
}
