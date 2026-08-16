import type { Game } from './game';
import { getCamOffset, screenToWorldTile } from './render';
import { initAudio, toggleMute, getVolume, setVolume } from './sound';
import { pauseVolumeLayout } from './ui';

export interface ViewSize {
  w: number;
  h: number;
}

// Mouse and touch share this one code path via Pointer Events. The only
// touch-specific branch is "armed spell" (game.spellArmed) — touch has no
// right-click, so tapping the mana orb arms the spell and the next tap on
// the field casts it there; see uiClick() in game.ts for the orb/button hit
// testing that sets spellArmed. The known-spell picker is a plain HUD
// button (game.ts's uiClick, layout.spellBtn) above the orb, so it needs
// no special-casing here — a click/tap on it goes through uiClick like any
// other button.
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
    canvas.addEventListener('pointermove', (ev) => {
      this.mouseX = ev.clientX;
      this.mouseY = ev.clientY;
    });
    canvas.addEventListener('pointerdown', (ev) => {
      initAudio();
      const g = this.game;
      if (g.screen === 'title') {
        if (ev.button === 0) g.titleClick(ev.clientX, ev.clientY, this.view.w, this.view.h);
        return;
      }
      if (g.screen === 'paused') {
        if (ev.button !== 0) return;
        const layout = pauseVolumeLayout(this.view.w, this.view.h);
        if (Math.hypot(ev.clientX - layout.minus.x, ev.clientY - layout.minus.y) < layout.minus.r) {
          setVolume(getVolume() - 0.1);
        } else if (Math.hypot(ev.clientX - layout.plus.x, ev.clientY - layout.plus.y) < layout.plus.r) {
          setVolume(getVolume() + 0.1);
        } else {
          // Touch has no Esc key — tapping anywhere else on the pause
          // screen resumes, same as the volume buttons do the opposite job.
          g.togglePause();
        }
        return;
      }
      if (g.screen !== 'playing') return;
      if (ev.button === 2) {
        if (!g.uiRightClick(ev.clientX, ev.clientY, this.view.w, this.view.h)) {
          const tp = this.mouseTile();
          g.castSpell(tp.x, tp.y);
        }
        return;
      }
      if (ev.button !== 0) return;
      ev.preventDefault();
      if (g.uiClick(ev.clientX, ev.clientY, this.view.w, this.view.h)) return;
      if (g.spellArmed) {
        g.spellArmed = false;
        const tp = this.mouseTile();
        g.castSpell(tp.x, tp.y);
        return;
      }
      this.held = true;
      this.holdT = 0.15;
      const tp = this.mouseTile();
      g.clickAt(tp.x, tp.y);
    });
    window.addEventListener('pointerup', (ev) => {
      if (ev.button === 0) this.held = false;
    });
    window.addEventListener('pointercancel', () => {
      this.held = false;
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
        if (k === 'arrowup' || k === '+' || k === '=') setVolume(getVolume() + 0.1);
        if (k === 'arrowdown' || k === '-') setVolume(getVolume() - 0.1);
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
      if (k === 'e') g.cycleSpell();
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
    return screenToWorldTile(this.mouseX, this.mouseY, offX, offY, this.view.w, this.view.h);
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
