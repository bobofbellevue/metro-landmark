import {
  buildOfficialFormReferralLines,
  buildRequiredNoticeLanguageLines,
  copyrightedFormsDisclaimer,
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

  test('recommends joining the pack preferred landlord association', () => {
    const lines = buildOfficialFormReferralLines({
      preferredLandlordAssociation: {
        id: 'rhawa',
        name: 'Rental Housing Association of Washington (RHAWA)',
        membershipUrl: 'https://www.rhawa.org/',
        formsUrl: 'https://www.rhawa.org/rent-increase-notices',
        recommendation:
          'Join RHAWA and import their current city-specific rent-increase templates into Documents.',
      },
      productName: 'Salish Landmark',
    });
    expect(lines.some((l) => l.includes('Join RHAWA'))).toBe(true);
    expect(lines.some((l) => l.includes('rhawa.org'))).toBe(true);
    expect(lines.some((l) => l.includes(copyrightedFormsDisclaimer('Salish Landmark')))).toBe(
      true
    );
    expect(lines.some((l) => /we do not ship/i.test(l))).toBe(false);
  });
});

describe('buildRequiredNoticeLanguageLines', () => {
  test('can omit the official-form heading for the tenant page', () => {
    const withHeading = buildRequiredNoticeLanguageLines({
      packDisplayName: 'City of Seattle',
      requiredNoticeLanguage: ['Call the helpline.'],
    });
    expect(withHeading.some((l) => l.includes('required language'))).toBe(true);

    const tenantPage = buildRequiredNoticeLanguageLines({
      packDisplayName: 'City of Seattle',
      requiredNoticeLanguage: ['Call the helpline.'],
      includeHeading: false,
    });
    expect(tenantPage).toEqual(['Call the helpline.']);
    expect(tenantPage.some((l) => l.includes('required language'))).toBe(false);
  });
});
