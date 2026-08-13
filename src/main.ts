import { Game } from './game';
import { Input } from './input';
import { render } from './render';
import { CURSOR_HAND, CURSOR_SWORD } from './cursor';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d', { alpha: false })!;

let cursor = '';
function setCursor(c: string): void {
  if (c !== cursor) {
    cursor = c;
    canvas.style.cursor = c;
  }
}
setCursor(CURSOR_HAND);

const view = { w: 0, h: 0 };

function resize(): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  view.w = window.innerWidth;
  view.h = window.innerHeight;
  canvas.width = Math.floor(view.w * dpr);
  canvas.height = Math.floor(view.h * dpr);
  canvas.style.width = `${view.w}px`;
  canvas.style.height = `${view.h}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', resize);
resize();

const game = new Game();
const input = new Input(canvas, game, view);

// Dev handle for driving/inspecting the game from the console or test scripts.
declare global {
  interface Window {
    game: Game;
  }
}
window.game = game;

let last = performance.now();
let fps = 0;
let fpsAcc = 0;
let fpsFrames = 0;

function frame(now: number): void {
  const rawDt = (now - last) / 1000;
  const dt = Math.min(0.05, rawDt);
  last = now;

  fpsAcc += rawDt;
  fpsFrames++;
  if (fpsAcc >= 0.5) {
    fps = Math.round(fpsFrames / fpsAcc);
    (window as unknown as { __fps: number }).__fps = fps;
    fpsAcc = 0;
    fpsFrames = 0;
  }

  input.update(dt);
  game.update(dt);
  setCursor(game.screen === 'playing' && game.hoverEnemy ? CURSOR_SWORD : CURSOR_HAND);
  render(ctx, game, { w: view.w, h: view.h, mouseX: input.mouseX, mouseY: input.mouseY, fps }, dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
