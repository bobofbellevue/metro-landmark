/** Default menu height matches Tailwind max-h-60 (15rem). */
export const DEFAULT_DROPDOWN_MAX_HEIGHT = 240;
export const DEFAULT_DROPDOWN_GAP = 4;

/**
 * Place a fixed dropdown below its anchor, or above when there is not enough
 * room below. Used so combobox lists are not clipped by overflow containers.
 *
 * @param {{ top: number, bottom: number, left: number, width: number }} anchorRect
 * @param {{ maxHeight?: number, gap?: number, viewportHeight?: number, viewportWidth?: number }} [options]
 */
export function placeAnchoredDropdown(anchorRect, options = {}) {
  const maxHeight = options.maxHeight ?? DEFAULT_DROPDOWN_MAX_HEIGHT;
  const gap = options.gap ?? DEFAULT_DROPDOWN_GAP;
  const viewportHeight =
    options.viewportHeight ?? (typeof window !== 'undefined' ? window.innerHeight : 0);
  const viewportWidth =
    options.viewportWidth ?? (typeof window !== 'undefined' ? window.innerWidth : 0);

  const spaceBelow = Math.max(0, viewportHeight - anchorRect.bottom - gap);
  const spaceAbove = Math.max(0, anchorRect.top - gap);
  const placeAbove = spaceBelow < maxHeight && spaceAbove > spaceBelow;
  const available = placeAbove ? spaceAbove : spaceBelow;
  const height = Math.min(maxHeight, available);

  const width = Math.max(0, anchorRect.width || 0);
  const left = Math.min(Math.max(0, anchorRect.left || 0), Math.max(0, viewportWidth - width));

  return {
    placeAbove,
    maxHeight: height,
    left,
    width,
    top: placeAbove ? undefined : (anchorRect.bottom || 0) + gap,
    bottom: placeAbove ? viewportHeight - (anchorRect.top || 0) + gap : undefined,
  };
}

export function anchoredDropdownStyle(placement) {
  const style = {
    position: 'fixed',
    left: placement.left,
    width: placement.width,
    maxHeight: placement.maxHeight,
    zIndex: 80,
  };
  if (placement.placeAbove) {
    style.bottom = placement.bottom;
  } else {
    style.top = placement.top;
  }
  return style;
}
