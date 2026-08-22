import {
  placeAnchoredDropdown,
  anchoredDropdownStyle,
} from '../../src/utils/dropdown-placement.js';

describe('placeAnchoredDropdown', () => {
  test('opens below when there is room', () => {
    const placed = placeAnchoredDropdown(
      { top: 80, bottom: 120, left: 16, width: 280 },
      { maxHeight: 240, gap: 4, viewportHeight: 800, viewportWidth: 1024 }
    );
    expect(placed.placeAbove).toBe(false);
    expect(placed.top).toBe(124);
    expect(placed.bottom).toBeUndefined();
    expect(anchoredDropdownStyle(placed).top).toBe(124);
  });

  test('opens above when the field sits at the bottom of the viewport', () => {
    const placed = placeAnchoredDropdown(
      { top: 740, bottom: 780, left: 16, width: 280 },
      { maxHeight: 240, gap: 4, viewportHeight: 800, viewportWidth: 1024 }
    );
    expect(placed.placeAbove).toBe(true);
    expect(placed.bottom).toBe(64);
    expect(placed.top).toBeUndefined();
    expect(anchoredDropdownStyle(placed).bottom).toBe(64);
  });
});
