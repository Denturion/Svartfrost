// Procedural WebAudio: no assets, just cold noise and low drones.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;
let volume = 0.7;

export function initAudio(): void {
  if (ctx) return;
  ctx = new AudioContext();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : volume;
  master.connect(ctx.destination);
  startDrone();
}

export function toggleMute(): boolean {
  muted = !muted;
  if (master && ctx) {
    master.gain.setTargetAtTime(muted ? 0 : volume, ctx.currentTime, 0.05);
  }
  return muted;
}

export function getVolume(): number {
  return volume;
}

/** Also un-mutes, since dragging the level back up is an unambiguous
 * "I want sound" — matches how a hardware volume knob behaves. */
export function setVolume(v: number): void {
  volume = Math.max(0, Math.min(1, v));
  muted = false;
  if (master && ctx) master.gain.setTargetAtTime(volume, ctx.currentTime, 0.05);
}

// --- ambient moods ----------------------------------------------------------
// The dungeon's drone shifts every five depths: same bleak language,
// different dialect. Each mood is a chord, a filter, a breathing rate, and
// an occasional far-off accent.

interface Mood {
  voices: [number, OscillatorType][];
  filter: number;
  gain: number;
  trem: number; // breathing rate (Hz) and depth
  tremDepth: number;
  accent: { min: number; max: number; play: () => void } | null;
}

const MOODS: Mood[] = [
  {
    // Depths 1-5 — the cold dark. Close-detuned A drone, wind above.
    voices: [[55, 'sawtooth'], [55.7, 'sawtooth'], [82.4, 'sawtooth']],
    filter: 160,
    gain: 0.045,
    trem: 0.09,
    tremDepth: 0.02,
    accent: { min: 14, max: 26, play: () => noiseBurst(2.2, 240, 0.05, 'lowpass') },
  },
  {
    // Depths 6-10 — the catacombs. A third lower, slower breath, a dead bell.
    voices: [[41.2, 'sawtooth'], [41.6, 'sawtooth'], [61.7, 'sawtooth'], [123.5, 'triangle']],
    filter: 120,
    gain: 0.05,
    trem: 0.06,
    tremDepth: 0.022,
    accent: {
      min: 11,
      max: 22,
      play: () => {
        thud(196, 1.8, 0.05);
        thud(147, 2.4, 0.04);
      },
    },
  },
  {
    // Depths 11-15 — the ice halls. Glassy overtones, quicker shimmer.
    voices: [[55, 'sawtooth'], [110.4, 'triangle'], [164.8, 'sine'], [220.6, 'sine']],
    filter: 320,
    gain: 0.038,
    trem: 0.16,
    tremDepth: 0.016,
    accent: { min: 9, max: 18, play: () => sweep(1319, 988, 1.4, 0.028) },
  },
  {
    // Depths 16-20 — the throne below. Tritone dread and a war drum.
    voices: [[49, 'sawtooth'], [49.4, 'sawtooth'], [69.3, 'sawtooth'], [98.9, 'triangle']],
    filter: 140,
    gain: 0.052,
    trem: 0.05,
    tremDepth: 0.026,
    accent: { min: 8, max: 15, play: () => thud(58, 0.8, 0.12) },
  },
];

let currentMood = 0;
let drone: { gain: GainNode; oscs: OscillatorNode[] } | null = null;
let accentTimer: ReturnType<typeof setTimeout> | null = null;

/** Pick the ambient mood for a depth; crossfades if it changed. */
export function setMusicDepth(depth: number): void {
  const m = Math.floor((depth - 1) / 5) % MOODS.length;
  if (m === currentMood && drone) return;
  currentMood = m;
  if (ctx) startDrone();
}

function startDrone(): void {
  if (!ctx || !master) return;
  const now = ctx.currentTime;
  // Fade the old mood out under the new one.
  if (drone) {
    const old = drone;
    old.gain.gain.setTargetAtTime(0, now, 0.8);
    for (const o of old.oscs) o.stop(now + 4);
  }
  if (accentTimer !== null) clearTimeout(accentTimer);

  const mood = MOODS[currentMood];
  const gain = ctx.createGain();
  gain.gain.value = 0;
  gain.gain.setTargetAtTime(mood.gain, now + 0.4, 1.4);
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = mood.filter;
  filter.connect(gain);
  gain.connect(master);

  const oscs: OscillatorNode[] = [];
  for (const [freq, type] of mood.voices) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    osc.connect(filter);
    osc.start();
    oscs.push(osc);
  }
  // Slow tremolo so the drone breathes.
  const lfo = ctx.createOscillator();
  lfo.frequency.value = mood.trem;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = mood.tremDepth;
  lfo.connect(lfoGain);
  lfoGain.connect(gain.gain);
  lfo.start();
  oscs.push(lfo);
  drone = { gain, oscs };

  if (mood.accent) {
    const acc = mood.accent;
    const schedule = () => {
      accentTimer = setTimeout(() => {
        acc.play();
        schedule();
      }, (acc.min + Math.random() * (acc.max - acc.min)) * 1000);
    };
    schedule();
  }
}

function noiseBurst(duration: number, filterFreq: number, gainVal: number, type: BiquadFilterType = 'bandpass'): void {
  if (!ctx || !master) return;
  const frames = Math.ceil(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  }
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = filterFreq;
  const gain = ctx.createGain();
  gain.gain.value = gainVal;
  src.connect(filter);
  filter.connect(gain);
  gain.connect(master);
  src.start();
}

function thud(freq: number, duration: number, gainVal: number): void {
  if (!ctx || !master) return;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq * 0.4), ctx.currentTime + duration);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(gainVal, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  osc.connect(gain);
  gain.connect(master);
  osc.start();
  osc.stop(ctx.currentTime + duration);
}

function sweep(
  from: number,
  to: number,
  duration: number,
  gainVal: number,
  type: OscillatorType = 'sine',
): void {
  if (!ctx || !master) return;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(from, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), ctx.currentTime + duration);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(gainVal, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  osc.connect(gain);
  gain.connect(master);
  osc.start();
  osc.stop(ctx.currentTime + duration);
}

export const sfx = {
  swing: () => noiseBurst(0.08, 1400, 0.12, 'highpass'),
  hit: () => {
    noiseBurst(0.12, 700, 0.18);
    thud(110, 0.12, 0.15);
  },
  playerHurt: () => {
    noiseBurst(0.15, 400, 0.2);
    thud(70, 0.25, 0.25);
  },
  enemyDie: () => {
    noiseBurst(0.3, 300, 0.2);
    thud(90, 0.4, 0.2);
  },
  stairs: () => thud(45, 1.0, 0.4),
  nova: () => {
    noiseBurst(0.35, 2200, 0.12, 'highpass');
    sweep(1400, 180, 0.45, 0.1);
  },
  firenova: () => {
    noiseBurst(0.4, 500, 0.22, 'lowpass');
    thud(120, 0.5, 0.3);
  },
  fireball: () => noiseBurst(0.25, 900, 0.12, 'bandpass'),
  fireboom: () => {
    noiseBurst(0.35, 400, 0.25, 'lowpass');
    thud(80, 0.4, 0.3);
  },
  lightning: () => {
    noiseBurst(0.12, 3500, 0.2, 'highpass');
    thud(150, 0.15, 0.18);
  },
  blight: () => {
    noiseBurst(0.5, 220, 0.16, 'lowpass');
    sweep(90, 55, 0.6, 0.1, 'sawtooth');
  },
  blightTick: () => noiseBurst(0.08, 260, 0.06, 'lowpass'),
  bloodrite: () => {
    noiseBurst(0.18, 600, 0.14, 'bandpass');
    thud(160, 0.3, 0.22);
  },
  potion: () => {
    thud(300, 0.12, 0.1);
    noiseBurst(0.08, 500, 0.06);
  },
  pickup: () => thud(520, 0.07, 0.08),
  drop: () => thud(180, 0.12, 0.1),
  levelup: () => {
    sweep(240, 480, 0.4, 0.1);
    sweep(360, 720, 0.4, 0.06);
  },
  bossRoar: () => {
    sweep(140, 40, 1.3, 0.28, 'sawtooth');
    noiseBurst(0.5, 150, 0.2, 'lowpass');
  },
  playerDie: () => {
    noiseBurst(0.6, 200, 0.25);
    thud(50, 1.6, 0.4);
  },
};
