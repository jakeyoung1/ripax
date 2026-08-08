/**
 * Rip sounds, synthesised at runtime. No audio files: everything here is
 * filtered noise and a couple of oscillators, which keeps the payload at zero
 * bytes and avoids shipping recordings of someone else's foil wrappers.
 *
 * Browsers refuse to start audio before a user gesture, so the context is
 * created lazily on the first sound and resumed if it was suspended.
 */

const STORAGE_KEY = 'packrip.muted.v1';

let ctx = null;
let master = null;
let muted = readMuted();

function readMuted() {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function isMuted() {
  return muted;
}

export function toggleMute() {
  muted = !muted;
  try {
    localStorage.setItem(STORAGE_KEY, muted ? '1' : '0');
  } catch {
    /* preference is nice-to-have */
  }
  if (master) master.gain.value = muted ? 0 : 1;
  return muted;
}

function audio() {
  if (muted) return null;
  if (!ctx) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 1;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

/** Shared noise buffer — regenerating white noise per sound is wasteful. */
let noiseBuffer = null;
function noise(context) {
  if (!noiseBuffer || noiseBuffer.sampleRate !== context.sampleRate) {
    const length = context.sampleRate * 2;
    noiseBuffer = context.createBuffer(1, length, context.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
  }
  const source = context.createBufferSource();
  source.buffer = noiseBuffer;
  source.loop = true;
  return source;
}

/**
 * Filtered noise burst — the basis of every paper/foil sound here.
 * `sweep` slides the filter frequency, which is what separates a short "slide"
 * from a long "tear".
 */
function burst(context, { duration, from, to, peak, q = 1, type = 'bandpass', delay = 0 }) {
  const start = context.currentTime + delay;
  const source = noise(context);
  const filter = context.createBiquadFilter();
  const gain = context.createGain();

  filter.type = type;
  filter.Q.value = q;
  filter.frequency.setValueAtTime(from, start);
  filter.frequency.exponentialRampToValueAtTime(Math.max(to, 40), start + duration);

  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + duration * 0.18);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  source.connect(filter).connect(gain).connect(master);
  source.start(start);
  source.stop(start + duration + 0.05);
}

function tone(context, { freq, duration, peak, type = 'sine', delay = 0, glide = null }) {
  const start = context.currentTime + delay;
  const osc = context.createOscillator();
  const gain = context.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (glide) osc.frequency.exponentialRampToValueAtTime(glide, start + duration);

  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  osc.connect(gain).connect(master);
  osc.start(start);
  osc.stop(start + duration + 0.05);
}

/**
 * One short crackle of foil giving way, fired repeatedly while the tear is
 * being dragged. The single long `playTear` sweep is the sound of the wrapper
 * coming off; this is the sound of it resisting on the way there, so the audio
 * tracks the hand instead of arriving all at once at the end.
 *
 * Pitch and level rise with progress, and each crackle is jittered slightly —
 * identical repeats read as a synthesiser, not as foil.
 */
export function playCrinkle(progress = 0) {
  const context = audio();
  if (!context) return;
  const p = Math.max(0, Math.min(1, progress));
  burst(context, {
    duration: 0.07 + Math.random() * 0.05,
    from: 1500 + p * 2700,
    to: 850 + p * 1900,
    peak: 0.025 + p * 0.045,
    q: 1.5 + Math.random() * 1.2,
  });
}

/** Foil wrapper tearing: a long, bright, crackling sweep. */
export function playTear() {
  const context = audio();
  if (!context) return;
  burst(context, { duration: 0.42, from: 1200, to: 5200, peak: 0.16, q: 0.7 });
  burst(context, { duration: 0.3, from: 3000, to: 900, peak: 0.1, q: 1.4, delay: 0.06 });
}

/** One card sliding off the stack. Short, dry, slightly random so it never loops. */
export function playSlide() {
  const context = audio();
  if (!context) return;
  const jitter = 0.85 + Math.random() * 0.3;
  burst(context, { duration: 0.16, from: 2600 * jitter, to: 700, peak: 0.075, q: 0.9 });
}

/** Card landing on the pile. */
export function playLand() {
  const context = audio();
  if (!context) return;
  burst(context, { duration: 0.1, from: 500, to: 160, peak: 0.06, q: 1.2, type: 'lowpass' });
}

/**
 * Something good turned over. Intensity 0..1 scales how triumphant it gets, so a
 * plain holo gets a chime and a secret rare gets a chord.
 */
export function playHit(intensity = 0.5) {
  const context = audio();
  if (!context) return;

  const peak = 0.05 + intensity * 0.09;
  tone(context, { freq: 660, duration: 0.5, peak, type: 'triangle' });
  tone(context, { freq: 990, duration: 0.6, peak: peak * 0.8, type: 'sine', delay: 0.05 });

  if (intensity > 0.55) {
    tone(context, { freq: 1320, duration: 0.75, peak: peak * 0.7, type: 'sine', delay: 0.12 });
    burst(context, { duration: 0.5, from: 6000, to: 12000, peak: 0.05, q: 0.5, delay: 0.05 });
  }
  if (intensity > 0.8) {
    tone(context, { freq: 1760, duration: 1.0, peak: peak * 0.65, type: 'sine', delay: 0.2 });
    tone(context, { freq: 2640, duration: 1.1, peak: peak * 0.4, type: 'sine', delay: 0.28 });
  }
}

/** Pulling a fresh pack out of the box. */
export function playPackPull() {
  const context = audio();
  if (!context) return;
  burst(context, { duration: 0.22, from: 900, to: 2600, peak: 0.09, q: 0.8 });
}

/**
 * The building rumble under a big pull's tell. Held open until stopRumble(), so
 * the tension lasts exactly as long as the user takes to pull the card.
 */
let rumble = null;

export function startRumble(intensity = 0.5) {
  const context = audio();
  if (!context) return;
  stopRumble();

  const source = noise(context);
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  const now = context.currentTime;

  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(90, now);
  filter.frequency.linearRampToValueAtTime(190 + intensity * 220, now + 1.1);

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.035 + intensity * 0.075, now + 0.5);

  source.connect(filter).connect(gain).connect(master);
  source.start(now);
  rumble = { source, gain };
}

export function stopRumble() {
  if (!rumble || !ctx) return;
  const { source, gain } = rumble;
  rumble = null;
  const now = ctx.currentTime;
  try {
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value || 0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    source.stop(now + 0.22);
  } catch {
    /* already stopped */
  }
}

/** Walkout fanfare: a rising chord over a bright swell. */
export function playFanfare() {
  const context = audio();
  if (!context) return;

  // Major triad arriving in sequence, then an octave on top.
  const chord = [523.25, 659.25, 783.99, 1046.5];
  chord.forEach((freq, i) => {
    tone(context, { freq, duration: 1.5 - i * 0.1, peak: 0.075, type: 'triangle', delay: i * 0.09 });
    tone(context, { freq: freq * 2, duration: 1.2, peak: 0.03, type: 'sine', delay: i * 0.09 + 0.04 });
  });

  // Sub thump for weight, plus a shimmer sweep.
  tone(context, { freq: 110, duration: 0.9, peak: 0.11, type: 'sine', glide: 55 });
  burst(context, { duration: 1.1, from: 5000, to: 14000, peak: 0.045, q: 0.5, delay: 0.06 });
}

/** Cardboard box flaps opening. */
export function playBoxOpen() {
  const context = audio();
  if (!context) return;
  burst(context, { duration: 0.5, from: 320, to: 90, peak: 0.13, q: 0.8, type: 'lowpass' });
  burst(context, { duration: 0.24, from: 1500, to: 400, peak: 0.07, q: 1.1, delay: 0.1 });
}
