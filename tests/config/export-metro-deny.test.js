import {
  shouldDenyExportPath,
  REQUIRE_PRESENT,
} from '../../scripts/export-metro-deny.js';

describe('export-metro-deny', () => {
  test('denies secrets, transition docs, and agent scaffolding', () => {
    expect(shouldDenyExportPath('.env.local')).toBe(true);
    expect(shouldDenyExportPath('.db-environments.json')).toBe(true);
    expect(shouldDenyExportPath('scripts/current-environment.json')).toBe(true);
    expect(shouldDenyExportPath('docs/METRO_LANDMARK_OSS_TRANSITION_PLAN.md')).toBe(
      true
    );
    expect(shouldDenyExportPath('docs/EXPORT_DENY_LIST.md')).toBe(true);
    expect(shouldDenyExportPath('docs/EXPORT_CHECKLIST.md')).toBe(true);
    expect(shouldDenyExportPath('AGENTS.md')).toBe(true);
    expect(shouldDenyExportPath('docs/IMPLEMENTATION_PROMPTS.md')).toBe(true);
    expect(
      shouldDenyExportPath('docs/Michigan Section 236 Lease Agreement.doc')
    ).toBe(true);
    expect(shouldDenyExportPath('node_modules/lodash/index.js')).toBe(true);
    expect(shouldDenyExportPath('.git/config')).toBe(true);
    expect(shouldDenyExportPath('.cursorrules')).toBe(true);
  });

  test('allows public product surface', () => {
    expect(shouldDenyExportPath('README.md')).toBe(false);
    expect(shouldDenyExportPath('LICENSE')).toBe(false);
    expect(shouldDenyExportPath('src/main.jsx')).toBe(false);
    expect(shouldDenyExportPath('docs/FUTURE_FEATURES.md')).toBe(false);
    expect(shouldDenyExportPath('docs/RLS_SETUP_GUIDE.md')).toBe(false);
    expect(shouldDenyExportPath('.db-environments.example.json')).toBe(false);
    expect(shouldDenyExportPath('public/templates/NWMLS Lease 2001.pdf')).toBe(
      false
    );
  });

  test('require-present list includes core public files', () => {
    expect(REQUIRE_PRESENT).toContain('README.md');
    expect(REQUIRE_PRESENT).toContain('LICENSE');
    expect(REQUIRE_PRESENT).toContain('package.json');
  });
});
