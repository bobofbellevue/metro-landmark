/**
 * Deny patterns for the Metro Landmark clean export.
 * Keep in sync with docs/EXPORT_DENY_LIST.md.
 */

/** Exact relative paths (posix) that must never ship. */
export const DENY_EXACT = new Set([
  'docs/METRO_LANDMARK_OSS_TRANSITION_PLAN.md',
  'docs/EXPORT_DENY_LIST.md',
  'docs/EXPORT_CHECKLIST.md',
  'docs/SECRET_ROTATION_CHECKLIST.md',
  'docs/PRODUCT_COMPLETION_PLAN.md',
  'docs/PRODUCT_COMPLETION_PLAN_REVIEW.md',
  'docs/IMPLEMENTATION_PROMPTS.md',
  'docs/COMPLIANCE_PROCESSES_IMPLEMENTATION_PROMPTS.md',
  'docs/PENDING_FIXES_SUMMARY.md',
  'docs/IMPLEMENTATION_STRATEGY.md',
  'docs/SERVICE_RECOMMENDATIONS_AND_ACCOUNTS.md',
  'docs/APPOINTMENTS_IMPLEMENTATION_PROMPT.md',
  'docs/Michigan Section 236 Lease Agreement.doc',
  'AGENTS.md',
  'TESTING_PLAN.md',
  'MODEL_TRAINING_GUIDE.md',
  'MODEL_TESTING_GUIDE.md',
  'CURRENT_SYSTEM_PROMPT.txt',
  'SIMPLIFIED_SYSTEM_PROMPT.txt',
  '.cursorrules',
  '.db-environments.json',
  'scripts/current-environment.json',
  'problem.txt',
  'problem_checker_results.md',
]);

/** Directory names that are skipped entirely when encountered. */
export const DENY_DIR_NAMES = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.cursor',
  '.opencode',
  '.vscode',
  '.idea',
  'coverage',
  '.turbo',
  '.next',
]);

/**
 * Basename / path glob-like matchers (functions).
 * @type {Array<(relPath: string, base: string) => boolean>}
 */
export const DENY_MATCHERS = [
  (rel, base) => base === '.env' || base.startsWith('.env.'),
  (rel, base) => base.endsWith('.pem') || base.endsWith('.key'),
  (rel, base) => base.startsWith('opencode.') || base.endsWith('.opencode.json.un~'),
  (rel, base) => base === '.add' || base.endsWith('.swp') || base.endsWith('.swo'),
  (rel, base) => base === '.DS_Store' || base === 'Thumbs.db',
  (rel) => /^docs\/.*PROMPT/i.test(rel),
  (rel) => /^docs\/Blueprint /i.test(rel),
  (rel) => /^docs\/Functional Specification/i.test(rel),
  (rel) => /^docs\/Salish Landmark_/i.test(rel),
  (rel) => /^docs\/Michigan /i.test(rel),
  (rel) => /^docs\/Washington Property Management Service_/i.test(rel),
  // Transition / private export hygiene (also listed exact)
  (rel) => rel === 'docs/EXPORT_DENY_LIST.md' || rel === 'docs/EXPORT_CHECKLIST.md',
];

/**
 * @param {string} relPath posix relative path from repo root
 * @returns {boolean}
 */
export function shouldDenyExportPath(relPath) {
  const normalized = String(relPath || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '');
  if (!normalized || normalized === '.') return true;

  const parts = normalized.split('/');
  for (const part of parts) {
    if (DENY_DIR_NAMES.has(part)) return true;
  }

  if (DENY_EXACT.has(normalized)) return true;

  const base = parts[parts.length - 1] || '';
  for (const match of DENY_MATCHERS) {
    if (match(normalized, base)) return true;
  }

  return false;
}

/**
 * Post-copy sanity: paths that must exist in a healthy export.
 */
export const REQUIRE_PRESENT = [
  'README.md',
  'LICENSE',
  'CONTRIBUTING.md',
  'CODE_OF_CONDUCT.md',
  'SECURITY.md',
  'ROADMAP.md',
  'DEPLOYMENT_SETUP.md',
  'DEPLOYMENT.md',
  '.db-environments.example.json',
  'package.json',
  'src/main.jsx',
  'api',
];
