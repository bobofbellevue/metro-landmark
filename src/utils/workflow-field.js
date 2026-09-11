/**
 * Layout helpers for shared compliance workflow fields.
 */

export function workflowFieldWidthClass(width = 'full') {
  switch (width) {
    case 'sm':
      return 'w-44 max-w-full';
    case 'md':
      return 'w-64 max-w-full';
    case 'lg':
      return 'w-[32rem] max-w-full';
    default:
      return 'w-full';
  }
}

/**
 * Wrapper classes for a single workflow field.
 * @param {{ layout?: 'stack' | 'inline', width?: string }} field
 */
export function workflowFieldShellClass(field = {}) {
  const widthClass = workflowFieldWidthClass(field.width);
  if (field.layout === 'inline') {
    return `flex items-center gap-2 ${widthClass}`;
  }
  return widthClass;
}
