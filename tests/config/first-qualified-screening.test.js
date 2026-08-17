import {
  evaluateFirstQualifiedScreening,
  pendingApplicationsInOrder,
} from '../../src/utils/first-qualified-screening.js';

const queue = [
  { application_id: 1, status: 'pending', applied_at: '2026-08-01T10:00:00Z' },
  { application_id: 2, status: 'pending', applied_at: '2026-08-02T10:00:00Z' },
  { application_id: 3, status: 'approved', applied_at: '2026-07-01T10:00:00Z' },
];

describe('pendingApplicationsInOrder', () => {
  test('orders open applications by applied_at and skips decided rows', () => {
    expect(pendingApplicationsInOrder(queue).map((row) => row.application_id)).toEqual([
      1, 2,
    ]);
  });
});

describe('evaluateFirstQualifiedScreening', () => {
  test('Seattle blocks approving a later pending applicant', () => {
    const result = evaluateFirstQualifiedScreening({
      jurisdiction: 'seattle',
      queue,
      selectedApplicationId: 2,
      decision: 'approved',
    });
    expect(result.firstQualifiedApplicant).toBe(true);
    expect(result.writtenCriteriaRequired).toBe(true);
    expect(result.blocked).toBe(true);
    expect(result.earlierPendingCount).toBe(1);
  });

  test('Seattle allows approving the earliest pending applicant', () => {
    const result = evaluateFirstQualifiedScreening({
      jurisdiction: 'seattle',
      queue,
      selectedApplicationId: 1,
      decision: 'approved',
    });
    expect(result.blocked).toBe(false);
  });

  test('rejecting a later applicant is not a first-qualified skip', () => {
    const result = evaluateFirstQualifiedScreening({
      jurisdiction: 'seattle',
      queue,
      selectedApplicationId: 2,
      decision: 'rejected',
    });
    expect(result.blocked).toBe(false);
  });

  test('Washington pack does not enforce first-qualified order', () => {
    const result = evaluateFirstQualifiedScreening({
      jurisdiction: 'washington_state',
      queue,
      selectedApplicationId: 2,
      decision: 'approved',
    });
    expect(result.firstQualifiedApplicant).toBe(false);
    expect(result.blocked).toBe(false);
  });
});
