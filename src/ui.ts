// Inventory panel layout, shared between the renderer (drawing) and the
// game (click hit-testing) so the two can never disagree.
export const INV = {
  width: 280,
  pad: 14,
  rowH: 30,
  headerH: 132,
  top: 76,
  right: 16,
};

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
    { id: 'new', label: 'Descend', hint: 'Enter', x: w / 2 - 160, y: h * 0.56 - 24, w: 320, h: 38 },
  ];
  if (continueLabel) {
    items.push({ id: 'continue', label: continueLabel, hint: 'C', x: w / 2 - 160, y: h * 0.56 + 20, w: 320, h: 38 });
  }
  return items;
}

export function invPanelRect(
  viewW: number,
  rows: number,
): { x: number; y: number; w: number; h: number } {
  return {
    x: viewW - INV.width - INV.right,
    y: INV.top,
    w: INV.width,
    h: INV.headerH + Math.max(1, rows) * INV.rowH + INV.pad,
  };
}
