import {
  convertDateToOrdinalWord,
  describeLeaseTerm,
} from '../../src/utils/date-ordinal.js';

describe('date-ordinal', () => {
  test('converts YYYY-MM-DD to ordinal words', () => {
    expect(convertDateToOrdinalWord('2026-01-01')).toBe('first');
    expect(convertDateToOrdinalWord('2026-01-15')).toBe('fifteenth');
    expect(convertDateToOrdinalWord('2026-01-31')).toBe('last');
  });

  test('describes lease term length', () => {
    expect(describeLeaseTerm('2026-01-01', '2027-01-01')).toBe('1 year');
    expect(describeLeaseTerm('2026-01-01', '2026-07-01')).toBe('6 months');
    expect(describeLeaseTerm('2026-01-01', null)).toBe('Month-to-Month');
  });
});
