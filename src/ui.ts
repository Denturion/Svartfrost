// Layout shared between the renderer (drawing) and the game (click/tap hit
// testing) so the two can never disagree — this is the single source of
// truth for where every clickable HUD element actually is.

/** Shrinks the whole HUD on short viewports (phones in landscape) instead
 * of letting fixed desktop pixel sizes overwhelm the screen. 1 at desktop
 * heights, floored at 0.5 so nothing gets unreadably small. */
export function hudScale(viewW: number, viewH: number): number {
  return Math.max(0.5, Math.min(1, Math.min(viewW, viewH) / 900));
}

export interface HudLayout {
  scale: number;
  orbR: number;
  bezelR: number;
  healthCx: number;
  manaCx: number;
  orbY: number;
  potion: { x: number; y: number; r: number };
  killBadge: { x: number; y: number };
  satchelBtn: { x: number; y: number; r: number };
  pauseBtn: { x: number; y: number; r: number };
}

export function hudLayout(viewW: number, viewH: number): HudLayout {
  const scale = hudScale(viewW, viewH);
  const orbR = 60 * scale;
  const bezelR = orbR + 9 * scale;
  const healthCx = bezelR + 30 * scale;
  const manaCx = viewW - healthCx;
  const orbY = viewH - bezelR - 22 * scale;
  const btnR = 24 * scale;
  return {
    scale,
    orbR,
    bezelR,
    healthCx,
    manaCx,
    orbY,
    potion: { x: healthCx + bezelR + 40 * scale, y: orbY - 8 * scale, r: 26 * scale },
    killBadge: { x: manaCx - bezelR - 40 * scale, y: orbY - 8 * scale },
    // Top-left, clear of the depth plate (top-center) and satchel panel
    // (top-right) — the one corner nothing else already claims.
    satchelBtn: { x: btnR + 16 * scale, y: btnR + 16 * scale, r: btnR },
    pauseBtn: { x: btnR + 16 * scale, y: btnR * 3 + 30 * scale, r: btnR },
  };
}

// Satchel panel metrics, scaled the same way so it stays legible (and
// tappable) on a short phone-landscape viewport instead of overflowing it.
export interface InvMetrics {
  width: number;
  pad: number;
  rowH: number;
  headerH: number;
  top: number;
  right: number;
}

export function invMetrics(viewW: number, viewH: number): InvMetrics {
  const s = hudScale(viewW, viewH);
  return {
    width: 340 * s,
    pad: 18 * s,
    rowH: 36 * s,
    headerH: 156 * s,
    top: 84 * s,
    right: 24 * s,
  };
}

export interface TitleItem {
  id: 'new' | 'continue';
  label: string;
  hint: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Title-screen menu geometry, shared by the renderer and click hit-testing. */
export function titleMenu(w: number, h: number, continueLabel: string | null): TitleItem[] {
  const items: TitleItem[] = [
    { id: 'new', label: 'Descend', hint: 'Enter', x: w / 2 - 180, y: h * 0.56 - 26, w: 360, h: 44 },
  ];
  if (continueLabel) {
    items.push({ id: 'continue', label: continueLabel, hint: 'C', x: w / 2 - 180, y: h * 0.56 + 26, w: 360, h: 44 });
  }
  return items;
}

// Volume -/+ buttons on the pause screen — shared so a click and the drawn
// button can't drift apart.
export interface PauseVolumeLayout {
  cy: number;
  minus: { x: number; y: number; r: number };
  plus: { x: number; y: number; r: number };
}

export function pauseVolumeLayout(viewW: number, viewH: number): PauseVolumeLayout {
  const cy = viewH * 0.42 + 164;
  return {
    cy,
    minus: { x: viewW / 2 - 70, y: cy, r: 16 },
    plus: { x: viewW / 2 + 70, y: cy, r: 16 },
  };
}

export function invPanelRect(
  viewW: number,
  viewH: number,
  rows: number,
): { x: number; y: number; w: number; h: number } {
  const m = invMetrics(viewW, viewH);
  return {
    x: viewW - m.width - m.right,
    y: m.top,
    w: m.width,
    h: m.headerH + Math.max(1, rows) * m.rowH + m.pad,
  };
}
