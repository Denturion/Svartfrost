// AI-generated stone photography, warped onto the existing iso tile geometry
// in render.ts. Kept optional: every call site falls back to the original
// procedural fill until (or unless) these finish loading.

function load(src: string): HTMLImageElement {
  const img = new Image();
  img.src = src;
  return img;
}

export const wallStoneImg = load('/textures/wall-stone.png');
export const wallFrostImg = load('/textures/wall-frost.png');
export const floorImg = load('/textures/floor-flagstone.png');

export const playerClothImg = load('/textures/player-cloth.png');
export const playerSkinImg = load('/textures/player-skin.png');
export const playerSteelImg = load('/textures/player-steel.png');

function loaded(img: HTMLImageElement): boolean {
  return img.complete && img.naturalWidth > 0;
}

export function texturesReady(): boolean {
  return loaded(wallStoneImg) && loaded(wallFrostImg) && loaded(floorImg);
}

export function playerTexturesReady(): boolean {
  return loaded(playerClothImg) && loaded(playerSkinImg) && loaded(playerSteelImg);
}
