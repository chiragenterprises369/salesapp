/**
 * 44 px touch targets in absolute pixels. The kit's `touch` / `icon-touch` sizes use h-11 / size-11,
 * which is 38.5 px here because the root font size is 14 px (Tailwind spacing is rem-based).
 * Apply these next to the kit sizes on touch layouts (compact density, coarse pointers).
 */
export const TOUCH_ICON = 'size-[44px]';
export const TOUCH_BUTTON = 'h-[44px] min-w-[44px]';
/** For containers of kit buttons we do not render ourselves (LeadQuickActions). */
export const TOUCH_CHILDREN = '[&_button]:size-[44px]';
