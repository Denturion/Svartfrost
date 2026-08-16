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
  // A sparse, quiet music-box motif that drifts over the drone every
  // minute or two — a few plucked notes, never a loop the player can
  // predict. `at` is seconds from the phrase's own start; `variants`
  // holds a couple of different phrases so the same one doesn't repeat
  // every time.
  melody: { variants: { freq: number; at: number }[][]; gain: number };
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
    melody: {
      variants: [
        [
          { freq: 220, at: 0 }, // A3
          { freq: 233.1, at: 0.65 }, // Bb3 — minor 2nd
          { freq: 196, at: 1.4 }, // G3
          { freq: 311.1, at: 2.3 }, // Eb4 — tritone off the A root
        ],
        [
          { freq: 311.1, at: 0 }, // Eb4
          { freq: 220, at: 0.55 }, // A3
          { freq: 233.1, at: 1.5 }, // Bb3
          { freq: 196, at: 2.2 }, // G3
        ],
      ],
      gain: 0.015,
    },
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
    melody: {
      variants: [
        [
          { freq: 164.8, at: 0 }, // E3
          { freq: 174.6, at: 0.8 }, // F3 — minor 2nd creep
          { freq: 146.8, at: 1.75 }, // D3
          { freq: 155.6, at: 2.85 }, // Eb3
        ],
        [
          { freq: 146.8, at: 0 }, // D3
          { freq: 155.6, at: 0.7 }, // Eb3
          { freq: 164.8, at: 1.6 }, // E3
          { freq: 174.6, at: 2.6 }, // F3
        ],
      ],
      gain: 0.016,
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
    melody: {
      variants: [
        [
          { freq: 440, at: 0 }, // A4
          { freq: 466.2, at: 0.45 }, // Bb4
          { freq: 622.3, at: 0.95 }, // D#5 — tritone
          { freq: 415.3, at: 1.55 }, // Ab4
        ],
        [
          { freq: 622.3, at: 0 }, // D#5
          { freq: 440, at: 0.4 }, // A4
          { freq: 415.3, at: 0.85 }, // Ab4
          { freq: 466.2, at: 1.35 }, // Bb4
        ],
      ],
      gain: 0.013,
    },
  },
  {
    // Depths 16-20 — the throne below. Tritone dread and a war drum.
    voices: [[49, 'sawtooth'], [49.4, 'sawtooth'], [69.3, 'sawtooth'], [98.9, 'triangle']],
    filter: 140,
    gain: 0.052,
    trem: 0.05,
    tremDepth: 0.026,
    accent: { min: 8, max: 15, play: () => thud(58, 0.8, 0.12) },
    melody: {
      variants: [
        [
          { freq: 196, at: 0 }, // G3
          { freq: 207.7, at: 0.9 }, // Ab3
          { freq: 277.2, at: 1.9 }, // C#4 — tritone off the G root
          { freq: 185, at: 3.1 }, // F#3
        ],
        [
          { freq: 277.2, at: 0 }, // C#4
          { freq: 185, at: 1.0 }, // F#3
          { freq: 196, at: 2.0 }, // G3
          { freq: 207.7, at: 3.0 }, // Ab3
        ],
      ],
      gain: 0.017,
    },
  },
];

let currentMood = 0;
let drone: { gain: GainNode; oscs: OscillatorNode[] } | null = null;
let accentTimer: ReturnType<typeof setTimeout> | null = null;
let melodyTimer: ReturnType<typeof setTimeout> | null = null;

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
  if (melodyTimer !== null) clearTimeout(melodyTimer);
  // Safety net: a floor change always ends any boss fight's music, even
  // if the player slipped past the boss without killing it.
  stopBossMusic();

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

  // Sparse and slow — a phrase every 60-120s, so it reads as something
  // half-heard drifting past rather than a loop the player can clock.
  const scheduleMelody = () => {
    melodyTimer = setTimeout(() => {
      playMelody(pick(mood.melody.variants), mood.melody.gain);
      scheduleMelody();
    }, (60 + Math.random() * 60) * 1000);
  };
  scheduleMelody();
}

function pick<T>(arr: T[]): T {
  return arr[(Math.random() * arr.length) | 0];
}

/** One voice of a plucked, bell-like tone — sharp attack, long decay,
 * muffled through a lowpass so it never reads as close (`brightness` < 1
 * darkens it further, used for the echo tail). */
function bellVoice(freq: number, time: number, gainVal: number, brightness: number): void {
  if (!ctx || !master) return;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 1200 * brightness;
  filter.connect(master);

  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, time);
  g.gain.linearRampToValueAtTime(gainVal, time + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0008, time + 1.6);
  osc.connect(g);
  g.connect(filter);
  osc.start(time);
  osc.stop(time + 1.7);

  const overtone = ctx.createOscillator();
  overtone.type = 'sine';
  overtone.frequency.value = freq * 2.01;
  const og = ctx.createGain();
  og.gain.setValueAtTime(0, time);
  og.gain.linearRampToValueAtTime(gainVal * 0.3, time + 0.02);
  og.gain.exponentialRampToValueAtTime(0.0008, time + 1.0);
  overtone.connect(og);
  og.connect(filter);
  overtone.start(time);
  overtone.stop(time + 1.2);
}

/** A single note plus one faint, later, darker repeat — a cheap stand-in
 * for a reverb tail so the phrase reads as coming from far off instead of
 * ringing right next to the player. */
function bellNote(freq: number, time: number, gainVal: number): void {
  bellVoice(freq, time, gainVal, 1);
  bellVoice(freq * 0.999, time + 0.42, gainVal * 0.3, 0.55);
}

function playMelody(notes: { freq: number; at: number }[], gainVal: number): void {
  if (!ctx) return;
  const now = ctx.currentTime;
  for (const n of notes) bellNote(n.freq, now + n.at, gainVal);
}

// --- boss fight ---------------------------------------------------------
// A tremolo-picked dyad — a fast square-wave gate chopping a detuned
// sawtooth pair — starts the moment the boss's health bar appears
// (aggro) and cuts out the instant it dies. The dyad's root retunes to a
// new note every few seconds (see scheduleRiffShift), so it reads as a
// riff lurching between chord shapes rather than one held drone chord.

let bossTremolo: {
  steady: GainNode;
  root: OscillatorNode;
  second: OscillatorNode;
  lfo: OscillatorNode;
  rootFreq: number;
} | null = null;
let bossRiffTimer: ReturnType<typeof setTimeout> | null = null;

// Semitone jumps the riff can take from its current root — mostly small
// chromatic creep with the occasional tritone lurch, the way a black
// metal riff walks a scale instead of holding one chord for a whole fight.
const RIFF_STEPS = [-2, -1, -1, 1, 1, 2, 2, -3, 6];

function scheduleRiffShift(): void {
  bossRiffTimer = setTimeout(() => {
    if (!ctx || !bossTremolo) return;
    const step = RIFF_STEPS[(Math.random() * RIFF_STEPS.length) | 0];
    let next = bossTremolo.rootFreq * Math.pow(2, step / 12);
    if (next < 150) next *= 2; // keep the riff in a growl register —
    if (next > 320) next /= 2; // neither buried nor squealing.
    bossTremolo.rootFreq = next;
    const now = ctx.currentTime;
    bossTremolo.root.frequency.setTargetAtTime(next, now, 0.02);
    bossTremolo.second.frequency.setTargetAtTime(next * 1.0595, now, 0.02); // minor 2nd stays fixed
    scheduleRiffShift();
  }, (2 + Math.random() * 4) * 1000);
}

function startBossMusic(): void {
  if (!ctx || !master || bossTremolo) return;
  const now = ctx.currentTime;

  const steady = ctx.createGain();
  steady.gain.value = 0;
  steady.gain.setTargetAtTime(0.05, now, 0.5);

  const trem = ctx.createGain();
  trem.gain.value = 0.5;

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 780;
  filter.Q.value = 1.4;

  filter.connect(trem);
  trem.connect(steady);
  steady.connect(master);

  const rootFreq = 220;
  const root = ctx.createOscillator();
  root.type = 'sawtooth';
  root.frequency.value = rootFreq;
  root.connect(filter);
  root.start();

  const second = ctx.createOscillator();
  second.type = 'sawtooth';
  second.frequency.value = rootFreq * 1.0595;
  second.connect(filter);
  second.start();

  const lfo = ctx.createOscillator();
  lfo.type = 'square';
  lfo.frequency.value = 7.5;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 0.4;
  lfo.connect(lfoGain);
  lfoGain.connect(trem.gain);
  lfo.start();

  bossTremolo = { steady, root, second, lfo, rootFreq };
  scheduleRiffShift();
}

function stopBossMusic(): void {
  if (bossRiffTimer !== null) {
    clearTimeout(bossRiffTimer);
    bossRiffTimer = null;
  }
  if (!ctx || !bossTremolo) return;
  const now = ctx.currentTime;
  const t = bossTremolo;
  t.steady.gain.cancelScheduledValues(now);
  t.steady.gain.setTargetAtTime(0, now, 0.35);
  for (const o of [t.root, t.second, t.lfo]) o.stop(now + 1);
  bossTremolo = null;
}

/** A pitch-diving, resonant shriek plus a raspy noise layer — the closest
 * a procedural-only sound engine gets to a scream. */
function scream(): void {
  if (!ctx || !master) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(1300, now);
  osc.frequency.exponentialRampToValueAtTime(210, now + 0.9);
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = 6;
  filter.frequency.setValueAtTime(2000, now);
  filter.frequency.exponentialRampToValueAtTime(380, now + 0.9);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.24, now + 0.06);
  gain.gain.exponentialRampToValueAtTime(0.0005, now + 1.0);
  osc.connect(filter);
  filter.connect(gain);
  gain.connect(master);
  osc.start(now);
  osc.stop(now + 1.05);
  noiseBurst(0.8, 1600, 0.1, 'highpass');
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
    // A pure sine sweep with no low end read as a toy "boop" — this keeps
    // the icy crack up top but gives it a body: a sawtooth sweep for real
    // harmonic weight, a second one an octave down for thickness, and a
    // sub thud (missing entirely before) for the actual blast impact.
    noiseBurst(0.3, 2600, 0.1, 'highpass');
    sweep(1100, 140, 0.5, 0.16, 'sawtooth');
    sweep(550, 90, 0.55, 0.1, 'triangle');
    thud(85, 0.5, 0.22);
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
    startBossMusic();
  },
  bossDie: () => {
    stopBossMusic();
    scream();
  },
  playerDie: () => {
    // Dying to a boss otherwise leaves its music running forever: the
    // setMusicDepth() safety net only stops it on an actual mood-bucket
    // change, and restarting from death always re-enters depth 1, which
    // is the same mood bucket as any death within depths 1-5.
    stopBossMusic();
    noiseBurst(0.6, 200, 0.25);
    thud(50, 1.6, 0.4);
  },
};
