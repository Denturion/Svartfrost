import type { Game } from './game';
import { screenToTile } from './iso';
import { getCamOffset } from './render';
import { initAudio, toggleMute } from './sound';

export interface ViewSize {
  w: number;
  h: number;
}

export class Input {
  mouseX = 0;
  mouseY = 0;
  private keys = new Set<string>();
  private held = false;
  private holdT = 0;

  constructor(
    canvas: HTMLCanvasElement,
    private game: Game,
    private view: ViewSize,
  ) {
    canvas.addEventListener('mousemove', (ev) => {
      this.mouseX = ev.clientX;
      this.mouseY = ev.clientY;
    });
    canvas.addEventListener('mousedown', (ev) => {
      initAudio();
      const g = this.game;
      if (g.screen === 'title') {
        if (ev.button === 0) g.titleClick(ev.clientX, ev.clientY, this.view.w, this.view.h);
        return;
      }
      if (g.screen !== 'playing') return;
      if (ev.button === 2) {
        if (!g.uiRightClick(ev.clientX, ev.clientY, this.view.w)) {
          const tp = this.mouseTile();
          g.castSpell(tp.x, tp.y);
        }
        return;
      }
      if (ev.button !== 0) return;
      if (g.uiClick(ev.clientX, ev.clientY, this.view.w)) return;
      this.held = true;
      this.holdT = 0.15;
      const tp = this.mouseTile();
      g.clickAt(tp.x, tp.y);
    });
    window.addEventListener('mouseup', (ev) => {
      if (ev.button === 0) this.held = false;
    });
    canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());
    window.addEventListener('keydown', (ev) => {
      const k = ev.key.toLowerCase();
      const g = this.game;
      if (k === 'm') toggleMute();
      if (k === 'p') g.showFps = !g.showFps;
      if (g.screen === 'title') {
        if (ev.key === 'Enter') g.startNewRun();
        if (k === 'c') g.continueRun();
        return;
      }
      if (g.screen === 'dead') {
        if (k === 'r') g.restart();
        if (k === 'escape') g.toTitle();
        return;
      }
      if (g.screen === 'paused') {
        if (k === 'escape') g.togglePause();
        if (k === 't') g.toTitle();
        return;
      }
      // playing
      if (k === 'escape') {
        if (g.invOpen) g.invOpen = false;
        else g.togglePause();
        return;
      }
      if (k === 'q' || k === '1') g.drinkPotion();
      if (k === 'f') {
        const tp = this.mouseTile();
        g.castSpell(tp.x, tp.y);
      }
      if (k === 'i') g.invOpen = !g.invOpen;
      if (MOVE_KEYS.has(k)) {
        this.keys.add(k);
        ev.preventDefault();
      }
    });
    window.addEventListener('keyup', (ev) => {
      this.keys.delete(ev.key.toLowerCase());
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.held = false;
    });
  }

  private mouseTile(): { x: number; y: number } {
    const { offX, offY } = getCamOffset(this.game, this.view.w, this.view.h);
    return screenToTile(this.mouseX - offX, this.mouseY - offY);
  }

  update(dt: number): void {
    if (this.game.screen !== 'playing') {
      this.game.hoverEnemy = null;
      return;
    }
    const tp = this.mouseTile();
    this.game.hoverEnemy = this.game.enemyAt(tp.x, tp.y);

    // Held button keeps the player walking toward the cursor.
    if (this.held) {
      this.holdT -= dt;
      if (this.holdT <= 0) {
        this.holdT = 0.15;
        this.game.holdMove(tp.x, tp.y);
      }
    }

    if (this.keys.size === 0) return;
    // WASD moves in screen directions; convert to tile-space steps.
    const vert = (this.has('s', 'arrowdown') ? 1 : 0) - (this.has('w', 'arrowup') ? 1 : 0);
    const horiz = (this.has('d', 'arrowright') ? 1 : 0) - (this.has('a', 'arrowleft') ? 1 : 0);
    if (vert === 0 && horiz === 0) return;
    const dx = Math.max(-1, Math.min(1, vert + horiz));
    const dy = Math.max(-1, Math.min(1, vert - horiz));
    this.game.keyMove(dx, dy);
  }

  private has(...names: string[]): boolean {
    return names.some((n) => this.keys.has(n));
  }
}

const MOVE_KEYS = new Set(['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']);
