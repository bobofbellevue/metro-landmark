import {
  detectBlanksFromTextItems,
  invitesNextLineBlank,
} from '../../src/utils/detect-pdf-blanks.js';
import {
  matchBlanksToFields,
  scoreFieldBlankMatch,
} from '../../src/utils/match-blanks-to-fields.js';

describe('detectBlanksFromTextItems', () => {
  test('finds gaps after form labels on a lease header line', () => {
    const items = [
      { str: 'This Agreement dated', x: 75.6, y: 663.8, w: 74.7 },
      { str: ',', x: 240, y: 663.8, w: 3 },
      { str: 'is made and entered into between', x: 75.6, y: 647.8, w: 116 },
      { str: '(“Lessor”),', x: 485, y: 647.8, w: 33 },
      { str: 'for the “Property” commonly known as', x: 75.6, y: 615.8, w: 128 },
      { str: '4', x: 530, y: 615.8, w: 8 },
      { str: 'The rent is', x: 89, y: 243.6, w: 58 },
      { str: 'per month, payable in advance', x: 210, y: 243.6, w: 140 },
    ];

    const blanks = detectBlanksFromTextItems(items, {
      pageIndex: 0,
      pageWidth: 612,
      pageHeight: 792,
      scale: 2,
    });

    expect(blanks.length).toBeGreaterThanOrEqual(3);

    const dated = blanks.find((b) => /dated/i.test(b.leftLabel));
    expect(dated).toBeTruthy();
    expect(dated.xPx).toBeGreaterThan(150);
    expect(dated.yPx).toBeCloseTo((792 - 663.8) * 2, 0);

    const property = blanks.find((b) => /commonly known as/i.test(b.leftLabel));
    expect(property).toBeTruthy();
    expect(property.rightLabel).toBe('[line#]');

    const rent = blanks.find((b) => /rent is/i.test(b.leftLabel));
    expect(rent).toBeTruthy();
  });

  test('skips NWMLS header chrome', () => {
    const items = [
      { str: 'NWMLS Form No. 68', x: 75, y: 706, w: 80 },
      { str: '© Copyright 1998', x: 450, y: 706, w: 80 },
    ];
    const blanks = detectBlanksFromTextItems(items, {
      pageHeight: 792,
      scale: 2,
    });
    expect(blanks).toHaveLength(0);
  });

  test('places NSF fee in the mid-line blank, not after the paragraph', () => {
    const items = [
      {
        str: 'Tenant agrees to pay a charge',
        x: 72,
        y: 400,
        w: 140,
      },
      {
        str: 'of for each NSF check given by Tenant to Lessor. Lessor shall have no',
        x: 280,
        y: 400,
        w: 280,
      },
      {
        str: 'obligation to redeposit any check returned NSF.',
        x: 72,
        y: 386,
        w: 250,
      },
    ];

    const blanks = detectBlanksFromTextItems(items, {
      pageWidth: 612,
      pageHeight: 792,
      scale: 2,
    });

    const nsfGap = blanks.find(
      (b) =>
        b.kind === 'mid_gap' &&
        /charge/i.test(b.leftLabel) &&
        /nsf/i.test(b.rightLabel)
    );
    expect(nsfGap).toBeTruthy();
    expect(nsfGap.xPdf).toBeGreaterThan(200);
    expect(nsfGap.xPdf).toBeLessThan(280);

    const trailingNsf = blanks.find(
      (b) =>
        (b.kind === 'trailing' || b.rightLabel === '[margin]') &&
        /returned NSF/i.test(b.leftLabel)
    );
    expect(trailingNsf).toBeFalsy();

    const fields = [
      {
        path: 'Lease.NSF_Fee',
        description: 'NSF check charge',
        type: 'number',
      },
    ];
    const matches = matchBlanksToFields(fields, blanks, { minScore: 10 });
    expect(matches).toHaveLength(1);
    expect(matches[0].kind).toBe('mid_gap');
    expect(matches[0].position.x).toBe(nsfGap.xPx);
  });

  test('places occupancy names on the next underscore line', () => {
    expect(
      invitesNextLineBlank(
        'OCCUPANCY/SUBLETTING. The Property is rented as a private residence only for the following named persons:'
      )
    ).toBe(true);

    const items = [
      {
        str: 'OCCUPANCY/SUBLETTING. The Property is rented as a private residence only for the following named persons:',
        x: 72,
        y: 500,
        w: 420,
      },
      {
        str: '________________________________________________',
        x: 72,
        y: 486,
        w: 400,
      },
    ];

    const blanks = detectBlanksFromTextItems(items, {
      pageWidth: 612,
      pageHeight: 792,
      scale: 2,
    });

    const nextLine = blanks.find(
      (b) =>
        (b.kind === 'next_line' || b.kind === 'underscore') &&
        /named persons/i.test(b.leftLabel)
    );
    expect(nextLine).toBeTruthy();
    expect(nextLine.yPdf).toBeLessThan(500);

    const trailingOnLabel = blanks.find(
      (b) =>
        b.yPdf === 500 &&
        (b.kind === 'trailing' || b.rightLabel === '[margin]') &&
        /named persons/i.test(b.leftLabel)
    );
    expect(trailingOnLabel).toBeFalsy();

    const fields = [
      {
        path: 'Lease.Occupancy_Persons',
        description: 'Named persons allowed to occupy',
        type: 'string',
      },
    ];
    const matches = matchBlanksToFields(fields, blanks, { minScore: 10 });
    expect(matches[0]).toBeTruthy();
    expect(['next_line', 'underscore']).toContain(matches[0].kind);
    expect(matches[0].position.y).toBeGreaterThan((792 - 500) * 2);
  });
});

describe('matchBlanksToFields', () => {
  test('maps NWMLS-style labels to lease fields', () => {
    const fields = [
      {
        path: 'Lease.Agreement_Date',
        description: 'Date of the agreement',
        type: 'string',
      },
      {
        path: 'Lease.Lessor',
        description: 'Name of the lessor',
        type: 'string',
      },
      {
        path: 'Lease.Property_Known_As',
        description: 'Property known as',
        type: 'string',
      },
      {
        path: 'Lease.Rent_Amount',
        description: 'Monthly rent amount',
        type: 'number',
      },
      {
        path: 'Lease.Security_Deposit_Amount',
        description: 'Amount of security deposit',
        type: 'number',
      },
    ];

    const blanks = [
      {
        page: 0,
        xPx: 310,
        yPx: 256,
        leftLabel: 'This Agreement dated',
        rightLabel: ',',
        kind: 'mid_gap',
      },
      {
        page: 0,
        xPx: 380,
        yPx: 288,
        leftLabel: 'is made and entered into between',
        rightLabel: '(“Lessor”),',
        kind: 'mid_gap',
      },
      {
        page: 0,
        xPx: 420,
        yPx: 352,
        leftLabel: 'for the “Property” commonly known as',
        rightLabel: '[margin]',
        kind: 'trailing',
      },
      {
        page: 0,
        xPx: 300,
        yPx: 1096,
        leftLabel: 'The rent is',
        rightLabel: 'per month, payable in advance',
        kind: 'mid_gap',
      },
      {
        page: 0,
        xPx: 720,
        yPx: 472,
        leftLabel: 'Lessor acknowledges receipt from Tenant of the sum of',
        rightLabel: ', which is being',
        kind: 'mid_gap',
      },
    ];

    expect(
      scoreFieldBlankMatch(fields[0], blanks[0])
    ).toBeGreaterThanOrEqual(10);

    const matches = matchBlanksToFields(fields, blanks, { minScore: 10 });
    const byPath = Object.fromEntries(matches.map((m) => [m.path, m]));

    expect(byPath['Lease.Agreement_Date']).toBeTruthy();
    expect(byPath['Lease.Lessor']).toBeTruthy();
    expect(byPath['Lease.Property_Known_As']).toBeTruthy();
    expect(byPath['Lease.Rent_Amount']).toBeTruthy();
    expect(byPath['Lease.Security_Deposit_Amount']).toBeTruthy();

    const xs = new Set(matches.map((m) => m.position.x));
    expect(xs.size).toBeGreaterThan(1);
  });

  test('prefers mid-gap NSF blank over trailing margin blank', () => {
    const field = {
      path: 'Lease.NSF_Fee',
      description: 'NSF check fee',
      type: 'number',
    };
    const mid = {
      page: 0,
      xPx: 400,
      yPx: 800,
      leftLabel: 'Tenant agrees to pay a charge',
      rightLabel: 'of for each NSF check given by Tenant to Lessor.',
      kind: 'mid_gap',
      widthPdf: 60,
    };
    const trailing = {
      page: 0,
      xPx: 900,
      yPx: 828,
      leftLabel: 'obligation to redeposit any check returned NSF.',
      rightLabel: '[margin]',
      kind: 'trailing',
      widthPdf: 120,
    };
    expect(scoreFieldBlankMatch(field, mid)).toBeGreaterThan(
      scoreFieldBlankMatch(field, trailing)
    );
    const matches = matchBlanksToFields([field], [trailing, mid], {
      minScore: 10,
    });
    expect(matches[0].position.x).toBe(400);
    expect(matches[0].kind).toBe('mid_gap');
  });
});
