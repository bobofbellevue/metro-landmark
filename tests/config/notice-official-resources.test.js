import {
  buildOfficialFormReferralLines,
  wrapNoticeText,
} from '../../src/utils/notice-official-resources.js';

describe('wrapNoticeText', () => {
  test('wraps long strings on word boundaries', () => {
    const lines = wrapNoticeText('one two three four five', 10);
    expect(lines.every((line) => line.length <= 10)).toBe(true);
    expect(lines.join(' ')).toBe('one two three four five');
  });
});

describe('buildOfficialFormReferralLines', () => {
  test('says the worksheet is not the statutory form and lists official URLs', () => {
    const lines = buildOfficialFormReferralLines({
      packDisplayName: 'City of Seattle',
      officialFormUrls: [
        {
          label: 'RCW 59.18.720',
          href: 'https://app.leg.wa.gov/RCW/default.aspx?cite=59.18.720',
        },
      ],
      requiredNoticeLanguage: [
        'If you need help understanding this notice, call the Renting in Seattle Helpline at (206) 684-5700.',
      ],
    });
    expect(lines.some((l) => l.includes('not the statutory'))).toBe(true);
    expect(lines).toContain('RCW 59.18.720');
    expect(
      lines.some((l) => l.includes('app.leg.wa.gov/RCW/default.aspx?cite=59.18.720'))
    ).toBe(true);
    expect(lines.some((l) => l.includes('Renting in Seattle Helpline'))).toBe(true);
    expect(lines.some((l) => l.includes('City of Seattle required language'))).toBe(
      true
    );
  });
});
