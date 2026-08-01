// Procedural sound effects via Web Audio API — no asset files, everything
// synthesised from noise buffers + oscillators at runtime.
//
// Old-hardware notes (this runs on the 2010 MacBook Air):
//  * One AudioContext, one master chain, one shared noise buffer.
//  * Each sound = 2–4 short nodes that free themselves when the envelope
//    finishes. The graph is built lazily and only when actually sounding.
//  * Voices are capped: if too many are in flight, new ones are skipped.
//    This keeps GC + DSP cost predictable even during fast mining.
//  * Footstep cadence is driven by the caller (main.js) using a distance
//    accumulator — we never sample per frame here.
let ctx = null;
let masterGain = null;
let masterCompressor = null;
let muted = false;
let masterVolume = 0.9;
let noiseBuf = null;
let brownNoiseBuf = null;

// Track active voices so a burst of mining can't pile up nodes faster than
// the engine can free them. Each voice increments on start and decrements in
// a stop() callback.
let activeVoices = 0;
const MAX_VOICES = 12;

function ensureCtx() {
  if (ctx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) { console.warn("[sfx] no AudioContext available"); return; }
  ctx = new AC();
  // A soft limiter on the master bus stops clipped summations from sounding
  // harsh on small laptop speakers when several SFX overlap.
  masterCompressor = ctx.createDynamicsCompressor();
  masterCompressor.threshold.value = -10;
  masterCompressor.knee.value = 12;
  masterCompressor.ratio.value = 6;
  masterCompressor.attack.value = 0.003;
  masterCompressor.release.value = 0.18;
  masterGain = ctx.createGain();
  masterGain.gain.value = muted ? 0 : masterVolume;
  masterGain.connect(masterCompressor).connect(ctx.destination);
  // Half a second of white noise reused by every percussion-style sound.
  noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  // 1.5s of brownish noise for wind/ambient — softer low-end character than
  // white noise, so the loop doesn't buzz on a tiny speaker.
  brownNoiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 1.5), ctx.sampleRate);
  const bd = brownNoiseBuf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < bd.length; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    bd[i] = last * 3.5;
  }
}

// Wrap a voice in active-voice accounting. Returns true if the caller should
// proceed, false if we're at the cap (caller bails silently).
function claimVoice() {
  if (activeVoices >= MAX_VOICES) return false;
  activeVoices++;
  return true;
}
function releaseVoice() { if (activeVoices > 0) activeVoices--; }

// Filtered noise burst — the workhorse for footsteps, mining taps, crunches.
// `dur` seconds, bandpass/lowpass at `freq` with quality `q`, peak gain `peak`.
function noiseHit(dur, freq, q, peak, buffer = noiseBuf) {
  if (!ctx) return;
  if (!claimVoice()) return;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = q > 0 ? "bandpass" : "lowpass";
  filter.frequency.value = freq;
  if (q > 0) filter.Q.value = q;
  const gain = ctx.createGain();
  const t = ctx.currentTime;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(peak, t + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(filter).connect(gain).connect(masterGain);
  src.start();
  src.stop(t + dur + 0.02);
  src.onended = releaseVoice;
}

// Surface-aware footsteps. Each surface gets a different low-pass centre and
// short envelope so stone reads as a tap, dirt/sand as a soft scuff, wood as
// a hollow knock. A tiny pitch jitter keeps repetitive steps from feeling
// mechanical.
const FOOTSTEPS = {
  step:  { freq: 220, dur: 0.10, peak: 0.32 },
  grass: { freq: 240, dur: 0.11, peak: 0.32 },
  dirt:  { freq: 180, dur: 0.12, peak: 0.36 },
  stone: { freq: 320, dur: 0.08, peak: 0.36 },
  wood:  { freq: 380, dur: 0.10, peak: 0.36 },
  sand:  { freq: 160, dur: 0.13, peak: 0.34 },
  leaves:{ freq: 280, dur: 0.10, peak: 0.24 },
  metal: { freq: 520, dur: 0.07, peak: 0.32 },
  glass: { freq: 600, dur: 0.07, peak: 0.28 },
};
export function footstep(surface = "step") {
  ensureCtx(); if (muted || !ctx) return;
  const s = FOOTSTEPS[surface] || FOOTSTEPS.step;
  const jitter = (Math.random() - 0.5) * 40;
  noiseHit(s.dur, s.freq + jitter, 0, s.peak);
}

// Mining tap: sharp, frequency depends on what we're hitting. The crack
// stage hook in main.js calls this each time the crack texture advances, so
// the player hears a chip-chip-chip that rises in pitch as they get close to
// breaking through.
export function mineHit(material = "stone", stage = 0) {
  ensureCtx(); if (muted || !ctx) return;
  const base = material === "wood"   ? 480
            : material === "dirt"    ? 340
            : material === "sand"    ? 280
            : material === "metal"   ? 900
            : material === "glass"   ? 1100
            : 880; // stone/ore
  const jitter = (Math.random() - 0.5) * 80;
  // Later stages = higher pitch + slightly louder, sells "about to break".
  const stageBoost = Math.min(stage, 9) * 25;
  noiseHit(0.06, base + jitter + stageBoost, 3, 0.36);
}

// Block break: low sine thud (the body) + noise crunch (the debris). Material
// sets the thud pitch — wood is bright, dirt is dull, stone is in between.
export function blockBreak(material = "stone") {
  ensureCtx(); if (muted || !ctx) return;
  if (!claimVoice()) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = "sine";
  const f0 = material === "wood"   ? 220
           : material === "dirt"   ? 130
           : material === "sand"   ? 120
           : material === "glass"  ? 320
           : material === "metal"  ? 280
           : 120;
  osc.frequency.setValueAtTime(f0, t);
  osc.frequency.exponentialRampToValueAtTime(40, t + 0.18);
  const og = ctx.createGain();
  og.gain.setValueAtTime(0.55, t);
  og.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
  osc.connect(og).connect(masterGain);
  osc.start();
  osc.stop(t + 0.24);
  osc.onended = releaseVoice;
  // Glass breaks ring longer with a brighter crunch.
  if (material === "glass") {
    noiseHit(0.22, 2600, 1.5, 0.40);
    noiseHit(0.10, 4200, 2, 0.28);
  } else {
    noiseHit(0.14, 1100, 0, 0.36);
  }
}

// Block place: short triangle-wave tonal tap, slightly brighter than the
// break thud so the two never blur together.
export function place() {
  ensureCtx(); if (muted || !ctx) return;
  if (!claimVoice()) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(480, t);
  osc.frequency.exponentialRampToValueAtTime(240, t + 0.08);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.42, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.10);
  osc.connect(gain).connect(masterGain);
  osc.start();
  osc.stop(t + 0.12);
  osc.onended = releaseVoice;
  // A faint scuff layered under the tone so placement has weight.
  noiseHit(0.06, 300, 0, 0.20);
}

// Door: two-position cue so open/close sound different. Closed = a heavier
// clack; open = a brighter clack. A short noise burst + a square-wave thump.
export function door(open) {
  ensureCtx(); if (muted || !ctx) return;
  if (!claimVoice()) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = "square";
  osc.frequency.setValueAtTime(open ? 180 : 120, t);
  osc.frequency.exponentialRampToValueAtTime(open ? 90 : 60, t + 0.10);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.32, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
  osc.connect(g).connect(masterGain);
  osc.start();
  osc.stop(t + 0.14);
  osc.onended = releaseVoice;
  noiseHit(0.08, open ? 1600 : 700, 0, 0.22);
}

// Chest/trader panel: wooden creak + small latch click.
export function uiPanel() {
  ensureCtx(); if (muted || !ctx) return;
  if (!claimVoice()) return;
  const t = ctx.currentTime;
  // Creak: low triangle sweeping down.
  const osc = ctx.createOscillator();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(280, t);
  osc.frequency.exponentialRampToValueAtTime(140, t + 0.16);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.24, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
  osc.connect(g).connect(masterGain);
  osc.start();
  osc.stop(t + 0.20);
  osc.onended = releaseVoice;
  // Latch: short high tick a moment later.
  setTimeout(() => noiseHit(0.04, 2400, 4, 0.18), 70);
}

// Eating: two quick wet thuds + a tiny finish crunch. Played in sequence by
// the caller's eat() handler so it always reads as "bite, bite, done".
export function eat() {
  ensureCtx(); if (muted || !ctx) return;
  noiseHit(0.07, 220, 0, 0.32);
  setTimeout(() => { ensureCtx(); if (!muted && ctx) noiseHit(0.07, 200, 0, 0.28); }, 140);
}

// Fall-impact: a single low thump. Caller triggers it on landing after a
// sizeable drop (and can scale `intensity` with drop height).
export function land(intensity = 1) {
  ensureCtx(); if (muted || !ctx) return;
  if (!claimVoice()) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(140, t);
  osc.frequency.exponentialRampToValueAtTime(45, t + 0.18);
  const g = ctx.createGain();
  const peak = Math.min(0.7, 0.3 + intensity * 0.4);
  g.gain.setValueAtTime(peak, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
  osc.connect(g).connect(masterGain);
  osc.start();
  osc.stop(t + 0.24);
  osc.onended = releaseVoice;
  noiseHit(0.10, 380, 0, 0.32);
}

// Hurt: short harsh tick — bandpass noise with a quick decay so it doesn't
// mask the heart-beat style ambient.
export function hurt() {
  ensureCtx(); if (muted || !ctx) return;
  noiseHit(0.10, 700, 1.5, 0.42);
}

// Portal hum: low sine drone with slow vibrato, fades over ~1.2s.
export function humm() {
  ensureCtx(); if (muted || !ctx) return;
  const now = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = "sine";
  o.frequency.setValueAtTime(110, now);
  o.frequency.linearRampToValueAtTime(140, now + 0.4);
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 5;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 6;
  lfo.connect(lfoGain).connect(o.frequency);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(0.32, now + 0.1);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 1.2);
  o.connect(g).connect(masterGain);
  o.start(now); lfo.start(now);
  o.stop(now + 1.3); lfo.stop(now + 1.3);
}

// Ambient wind: a looping brown-noise bed whose gain gently swells. Started
// once on game boot and left running — the master gain handles muting. The
// node graph is built once and modulated, so it costs ~1 BiquadFilter + 1
// Gain + 1 BufferSource for the lifetime of the session.
let windSrc = null, windGain = null, windLfo = null;
export function startAmbient() {
  ensureCtx();
  if (!ctx || windSrc) return;
  windSrc = ctx.createBufferSource();
  windSrc.buffer = brownNoiseBuf;
  windSrc.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 420;
  filter.Q.value = 0.4;
  windGain = ctx.createGain();
  windGain.gain.value = 0.0;
  windSrc.connect(filter).connect(windGain).connect(masterGain);
  // Slow LFO on the filter so the wind "breathes" instead of droning flat.
  windLfo = ctx.createOscillator();
  windLfo.frequency.value = 0.07;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 180;
  windLfo.connect(lfoGain).connect(filter.frequency);
  windSrc.start();
  windLfo.start();
}
// Smoothly set ambient level — call from the day/night hook with dayFactor.
export function setAmbient(level) {
  ensureCtx();
  if (!windGain || !ctx) return;
  const v = Math.max(0, Math.min(0.18, level));
  windGain.gain.setTargetAtTime(v, ctx.currentTime, 1.2);
}

export function setMuted(m) {
  muted = m;
  ensureCtx();
  if (masterGain) masterGain.gain.value = m ? 0 : masterVolume;
}
export function setVolume(v) {
  masterVolume = v;
  ensureCtx();
  if (masterGain && !muted) masterGain.gain.value = v;
}

// Browsers require a user gesture before audio can play. Call on the first
// click/keydown so the AudioContext is allowed to start.
export function resume() {
  ensureCtx();
  if (ctx && ctx.state === "suspended") ctx.resume();
}
