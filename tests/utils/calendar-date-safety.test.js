import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

const UTC_ISO_DATE_PARSE = /new Date\(\s*(['"`])\d{4}-\d{2}-\d{2}\1/;
const UTC_FROM_ISO_VAR =
  /new Date\(\s*(effectiveDate|noticeDate|requiredNoticeDate|start|end|startDate|endDate|isoDate)\s*\)/;
const ISO_SLICE = /\.toISOString\(\)\s*\.slice\(\s*0\s*,\s*10\s*\)/;

/**
 * Guard against the usual 03/01 → 02/28 class of bugs: parsing a calendar
 * date as UTC midnight, then displaying it in a US timezone.
 */
describe('calendar date safety (notice math)', () => {
  test.each([
    'src/utils/compliance-calculator.js',
    'src/components/NoticePeriodCalculator.jsx',
    'src/utils/workflow-date.js',
  ])('%s does not parse YYYY-MM-DD as UTC Date', (relativePath) => {
    const source = readFileSync(join(root, relativePath), 'utf8');
    expect(source).not.toMatch(UTC_ISO_DATE_PARSE);
    expect(source).not.toMatch(UTC_FROM_ISO_VAR);
    expect(source).not.toMatch(ISO_SLICE);
  });
});
