// Touch-capable devices get a few extra on-screen affordances (satchel and
// pause buttons) that desktop already has as keyboard shortcuts for, so
// this gate keeps the desktop HUD uncluttered.
export const isTouchDevice: boolean =
  typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);
