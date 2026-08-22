import React, { useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  DEFAULT_DROPDOWN_MAX_HEIGHT,
  anchoredDropdownStyle,
  placeAnchoredDropdown,
} from '../utils/dropdown-placement.js';

/**
 * Renders children in a portal, flipped above the anchor when there is not
 * enough room below. Avoids overflow clipping inside scrollable forms.
 */
export default function AnchoredDropdown({
  open,
  anchorRef,
  children,
  className = '',
  maxHeight = DEFAULT_DROPDOWN_MAX_HEIGHT,
  updateKey,
}) {
  const [placement, setPlacement] = useState(null);

  useLayoutEffect(() => {
    if (!open) {
      setPlacement(null);
      return undefined;
    }

    const update = () => {
      const node = anchorRef?.current;
      if (!node || typeof node.getBoundingClientRect !== 'function') return;
      setPlacement(
        placeAnchoredDropdown(node.getBoundingClientRect(), { maxHeight })
      );
    };

    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, anchorRef, maxHeight, updateKey]);

  if (!open || !placement || typeof document === 'undefined') return null;

  return createPortal(
    <div className={className} style={anchoredDropdownStyle(placement)} role="listbox">
      {children}
    </div>,
    document.body
  );
}
