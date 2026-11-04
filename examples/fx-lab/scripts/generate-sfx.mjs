#!/usr/bin/env node
/**
 * Deterministic SFX synthesizer for the liosvideo FX playbook.
 *
 * Every sound is generated from seeded noise + oscillators, so the WAV files are
 * reproducible, royalty-free and carry no attribution requirements.
 *
 *   node scripts/generate-sfx.mjs
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SR = 48000;
const TAU = Math.PI * 2;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SFX_DIR = join(ROOT, "assets", "audio", "sfx");
const MUSIC_DIR = join(ROOT, "assets", "audio", "music");

// ---------------------------------------------------------------- utilities

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function silence(seconds) {
  return new Float32Array(Math.round(seconds * SR));
}

function normalize(buf, peak = 0.9) {
  let max = 0;
  for (const v of buf) max = Math.max(max, Math.abs(v));
  if (max === 0) return buf;
  const g = peak / max;
  for (let i = 0; i < buf.length; i++) buf[i] *= g;
  return buf;
}

function mixInto(dst, src, offsetSec, gain = 1) {
  const start = Math.round(offsetSec * SR);
  for (let i = 0; i < src.length; i++) {
    const j = start + i;
    if (j < 0 || j >= dst.length) continue;
    dst[j] += src[i] * gain;
  }
}

/** Chamberlin state-variable filter. Returns band/low/high taps. */
class SVF {
  constructor() {
    this.low = 0;
    this.band = 0;
  }
  process(x, cutoff, damping = 0.4) {
    const f = 2 * Math.sin((Math.PI * clamp(cutoff, 20, SR * 0.42)) / SR);
    const d = clamp(damping, 0.05, 1.5);
    this.low += f * this.band;
    const high = x - this.low - d * this.band;
    this.band += f * high;
    return { low: this.low, band: this.band, high };
  }
}

class OnePole {
  constructor() {
    this.y = 0;
  }
  process(x, cutoff) {
    const a = 1 - Math.exp((-TAU * clamp(cutoff, 20, SR * 0.45)) / SR);
    this.y += a * (x - this.y);
    return this.y;
  }
}

const saw = (phase) => 2 * (phase - Math.floor(phase + 0.5));
const softClip = (x) => Math.tanh(x * 1.6) * 0.85;

function writeWav(file, samples) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.round(clamp(samples[i], -1, 1) * 32767), 44 + i * 2);
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, buf);
  return buf.length;
}

// ------------------------------------------------------------------ sounds

function whoosh({ duration = 0.42, from = 420, peak = 2100, to = 620, q = 0.42, seed = 11 }) {
  const out = silence(duration);
  const noise = rng(seed);
  const svf = new SVF();
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    const p = t / duration;
    const fc = p < 0.55
      ? from + (peak - from) * Math.sin((p / 0.55) * Math.PI * 0.5) ** 1.3
      : peak + (to - peak) * ((p - 0.55) / 0.45) ** 1.4;
    const { band } = svf.process(noise() * 2 - 1, fc, q);
    const amp = Math.sin(Math.PI * p) ** 1.5;
    out[i] = band * amp;
  }
  return normalize(out, 0.82);
}

function impactThud({ duration = 1.0, f0 = 78, f1 = 40, seed = 3 }) {
  const out = silence(duration);
  const noise = rng(seed);
  const svf = new SVF();
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    const f = f1 + (f0 - f1) * Math.exp(-t * 10);
    phase += f / SR;
    const body = Math.sin(TAU * phase) * Math.exp(-t * 4.4);
    const sub = Math.sin(TAU * phase * 0.5) * Math.exp(-t * 2.2) * 0.55;
    const { high } = svf.process(noise() * 2 - 1, 2600, 0.7);
    const crack = high * Math.exp(-t * 80) * 0.55;
    out[i] = softClip((body + sub + crack) * 1.25);
  }
  return normalize(out, 0.92);
}

function bubblePop({ duration = 0.2, seed = 7 }) {
  const out = silence(duration);
  const noise = rng(seed);
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    const f = 280 + 900 * Math.exp(-t * 26);
    phase += f / SR;
    const env = Math.exp(-t * 19);
    const click = (noise() * 2 - 1) * Math.exp(-t * 220) * 0.4;
    out[i] = (Math.sin(TAU * phase) * 1.05 + click) * env;
  }
  return normalize(out, 0.72);
}

function uiClick({ duration = 0.07, seed = 5 }) {
  const out = silence(duration);
  const noise = rng(seed);
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    phase += 2900 / SR;
    const ping = Math.sin(TAU * phase) * Math.exp(-t * 95);
    const tick = (noise() * 2 - 1) * Math.exp(-t * 320);
    out[i] = ping * 0.6 + tick * 0.5;
  }
  return normalize(out, 0.55);
}

function bell({ duration = 1.6, base = 740, seed = 9 }) {
  const out = silence(duration);
  const noise = rng(seed);
  const partials = [
    [1, 1, 1.5],
    [2.01, 0.55, 2.2],
    [2.76, 0.34, 3.1],
    [4.07, 0.2, 4.4],
    [5.42, 0.12, 5.6],
  ];
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    let v = 0;
    for (const [mul, amp, decay] of partials) {
      v += Math.sin(TAU * base * mul * t) * amp * Math.exp(-t * decay);
    }
    v += (noise() * 2 - 1) * Math.exp(-t * 120) * 0.12;
    out[i] = v * Math.min(1, t * 400);
  }
  return normalize(out, 0.78);
}

function typewriterRun({ duration = 1.25 }) {
  const out = silence(duration);
  const hits = [0.0, 0.095, 0.19, 0.29, 0.385, 0.48, 0.575, 0.665, 0.76, 0.855];
  hits.forEach((at, index) => {
    const key = silence(0.09);
    const noise = rng(41 + index * 17);
    const svf = new SVF();
    let phase = 0;
    for (let i = 0; i < key.length; i++) {
      const t = i / SR;
      phase += 168 / SR;
      const { high } = svf.process(noise() * 2 - 1, 2700, 0.75);
      key[i] =
        high * Math.exp(-t * 130) * 0.85 +
        Math.sin(TAU * phase) * Math.exp(-t * 65) * 0.4;
    }
    normalize(key, 0.5);
    mixInto(out, key, at, 1);
  });
  // carriage return ding
  const ding = bell({ duration: 0.5, base: 1760, seed: 12 });
  normalize(ding, 0.28);
  mixInto(out, ding, 0.98, 1);
  return normalize(out, 0.72);
}

function paperTear({ duration = 0.62 }) {
  const out = silence(duration);
  const noise = rng(23);
  const svf = new SVF();
  let gate = 1;
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    if (i % 420 === 0) gate = 0.12 + noise() * 0.95;
    const raw = noise() * 2 - 1;
    const { high, band } = svf.process(raw, 2400 + noise() * 900, 0.62);
    const env = Math.min(1, t / 0.045) * (1 - t / duration) ** 0.55;
    out[i] = (high * 0.55 + band * 0.7) * env * gate;
  }
  return normalize(out, 0.74);
}

function cameraShutter({ duration = 0.26 }) {
  const out = silence(duration);
  const noise = rng(31);
  const click = (at, gain) => {
    for (let i = Math.round(at * SR); i < out.length && i < Math.round((at + 0.05) * SR); i++) {
      const t = (i / SR) - at;
      out[i] += (noise() * 2 - 1) * Math.exp(-t * 260) * gain;
      out[i] += Math.sin(TAU * 1900 * t) * Math.exp(-t * 180) * gain * 0.5;
    }
  };
  click(0, 0.9);
  click(0.052, 0.65);
  return normalize(out, 0.8);
}

function glitch({ duration = 0.36 }) {
  const out = silence(duration);
  const noise = rng(53);
  let hold = 0;
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    if (i % 156 === 0) hold = Math.round((noise() * 2 - 1) * 5) / 5;
    phase += (260 - t * 420) / SR;
    const blip = Math.sign(Math.sin(TAU * phase)) * 0.45;
    const gateOn = Math.floor(t * 24) % 3 !== 0;
    const env = Math.min(1, t / 0.01) * (1 - t / duration) ** 0.4;
    out[i] = (hold * 0.75 + blip) * (gateOn ? 1 : 0.18) * env;
  }
  return normalize(out, 0.7);
}

function riser({ duration = 1.5, from = 150, to = 1350 }) {
  const out = silence(duration);
  const noise = rng(67);
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    const p = t / duration;
    const f = from * (to / from) ** p;
    phase += f / SR;
    const wobble = 1 + Math.sin(TAU * 6 * t) * 0.012;
    const tone = Math.sin(TAU * phase * wobble) * 0.5;
    const air = (noise() * 2 - 1) * 0.12 * p;
    const env = p ** 1.7;
    const fadeOut = t > duration - 0.06 ? (duration - t) / 0.06 : 1;
    out[i] = (tone + air) * env * fadeOut;
  }
  return normalize(out, 0.7);
}

function heartbeat({ duration = 0.85 }) {
  const out = silence(duration);
  const thump = (at, gain) => {
    let phase = 0;
    const start = Math.round(at * SR);
    for (let i = start; i < Math.min(out.length, start + Math.round(0.22 * SR)); i++) {
      const t = (i - start) / SR;
      const f = 38 + 26 * Math.exp(-t * 18);
      phase += f / SR;
      out[i] += Math.sin(TAU * phase) * Math.exp(-t * 13) * gain;
    }
  };
  thump(0.01, 1);
  thump(0.27, 0.72);
  return normalize(out, 0.9);
}

function kaching({ duration = 0.9 }) {
  const out = silence(duration);
  const first = bell({ duration: 0.85, base: 2093, seed: 71 });
  const second = bell({ duration: 0.7, base: 3136, seed: 73 });
  normalize(first, 0.55);
  normalize(second, 0.4);
  mixInto(out, first, 0.0, 1);
  mixInto(out, second, 0.09, 1);
  const noise = rng(79);
  for (let i = 0; i < Math.round(0.08 * SR); i++) {
    const t = i / SR;
    out[i] += (noise() * 2 - 1) * Math.exp(-t * 120) * 0.25;
  }
  return normalize(out, 0.8);
}

function braam({ duration = 2.4 }) {
  const out = silence(duration);
  const noise = rng(83);
  const lp = new OnePole();
  const freqs = [55, 55.45, 82.5];
  const phases = freqs.map(() => 0);
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    const p = t / duration;
    let v = 0;
    for (let k = 0; k < freqs.length; k++) {
      phases[k] += freqs[k] / SR;
      v += saw(phases[k]) * (k === 2 ? 0.35 : 0.6);
    }
    v += (noise() * 2 - 1) * 0.28;
    const cutoff = 900 * (1 - Math.min(1, p * 0.85)) + 80;
    const filtered = lp.process(v, cutoff);
    const attack = Math.min(1, t / 0.22);
    const release = t > duration - 0.5 ? (duration - t) / 0.5 : 1;
    out[i] = softClip(filtered * 2.2) * attack * release;
  }
  return normalize(out, 0.88);
}

function stamp({ duration = 0.42 }) {
  const out = silence(duration);
  const noise = rng(97);
  const svf = new SVF();
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    phase += (46 + 52 * Math.exp(-t * 22)) / SR;
    const body = Math.sin(TAU * phase) * Math.exp(-t * 11);
    const { high } = svf.process(noise() * 2 - 1, 2100, 0.7);
    const paper = high * Math.exp(-t * 34) * 0.5;
    out[i] = softClip(body * 1.3 + paper);
  }
  return normalize(out, 0.9);
}

function tapeStop({ duration = 0.75 }) {
  const out = silence(duration);
  const noise = rng(101);
  let phase = 0;
  const svf = new SVF();
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    const p = t / duration;
    const f = 540 * Math.exp(-3.4 * p) * (1 + Math.sin(TAU * 3.2 * t) * 0.02);
    phase += f / SR;
    const { band } = svf.process(noise() * 2 - 1, 1400, 0.5);
    const env = (1 - p) ** 1.3;
    out[i] = (Math.sin(TAU * phase) * 0.6 + band * 0.35) * env;
  }
  return normalize(out, 0.7);
}

function softSwoosh({ duration = 0.65 }) {
  const out = silence(duration);
  const noise = rng(103);
  const svf = new SVF();
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    const p = t / duration;
    const fc = 320 + 1150 * Math.sin(Math.PI * p) ** 1.2;
    const { band } = svf.process(noise() * 2 - 1, fc, 0.75);
    out[i] = band * Math.sin(Math.PI * p) ** 1.2;
  }
  return normalize(out, 0.55);
}

function tick({ duration = 0.11, base = 1900, seed = 107 }) {
  const out = silence(duration);
  const noise = rng(seed);
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    phase += base / SR;
    out[i] =
      Math.sin(TAU * phase) * Math.exp(-t * 90) * 0.55 +
      (noise() * 2 - 1) * Math.exp(-t * 260) * 0.45;
  }
  return normalize(out, 0.55);
}

function ambientBed({ duration = 24 }) {
  const out = silence(duration);
  const noise = rng(109);
  const lp = new OnePole();
  const lp2 = new OnePole();
  const voices = [
    [55, 0.3, 0.061],
    [82.41, 0.2, 0.043],
    [110, 0.13, 0.031],
    [164.81, 0.07, 0.023],
    [220, 0.035, 0.017],
  ];
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    let v = 0;
    for (const [f, amp, lfo] of voices) {
      v += Math.sin(TAU * f * t + Math.sin(TAU * lfo * t) * 0.6) * amp * (0.7 + 0.3 * Math.sin(TAU * lfo * 0.5 * t));
    }
    const air = lp2.process(lp.process(noise() * 2 - 1, 320), 900) * 0.5;
    const fadeIn = Math.min(1, t / 2.5);
    const fadeOut = Math.min(1, (duration - t) / 2.5);
    out[i] = (v + air) * fadeIn * fadeOut;
  }
  return normalize(out, 0.5);
}

// -------------------------------------------------------------------- build

const SOUNDS = {
  "whoosh_fast": () => whoosh({ duration: 0.4, from: 420, peak: 2400, to: 700, seed: 11 }),
  "whoosh_deep": () => {
    const out = silence(0.78);
    const n = whoosh({ duration: 0.78, from: 120, peak: 760, to: 240, q: 0.34, seed: 13 });
    normalize(n, 0.7);
    mixInto(out, n, 0, 1);
    let phase = 0;
    for (let i = 0; i < out.length; i++) {
      const t = i / SR;
      phase += (38 + 22 * Math.exp(-t * 6)) / SR;
      out[i] += Math.sin(TAU * phase) * Math.exp(-t * 3.4) * 0.32;
    }
    return normalize(out, 0.86);
  },
  "impact_thud": () => impactThud({}),
  "impact_sub": () => impactThud({ duration: 1.4, f0: 62, f1: 34, seed: 8 }),
  "pop": () => bubblePop({}),
  "ui_click": () => uiClick({}),
  "bell": () => bell({}),
  "bell_round": () => bell({ duration: 2.2, base: 560, seed: 10 }),
  "typewriter_run": () => typewriterRun({}),
  "paper_tear": () => paperTear({}),
  "camera_shutter": () => cameraShutter({}),
  "glitch": () => glitch({}),
  "riser": () => riser({}),
  "heartbeat": () => heartbeat({}),
  "kaching": () => kaching({}),
  "braam": () => braam({}),
  "stamp": () => stamp({}),
  "tape_stop": () => tapeStop({}),
  "soft_swoosh": () => softSwoosh({}),
  "tick": () => tick({}),
  "tock": () => tick({ base: 1250, seed: 113 }),
  "ambient_bed": () => ambientBed({}),
};

const sfxNames = Object.keys(SOUNDS).filter((n) => n !== "ambient_bed").sort();
let total = 0;

for (const name of sfxNames) {
  const bytes = writeWav(join(SFX_DIR, `${name}.wav`), SOUNDS[name]());
  total += bytes;
  console.log(`  sfx   ${name}.wav  ${(bytes / 1024).toFixed(1)} kB`);
}

const bedBytes = writeWav(join(MUSIC_DIR, "ambient_bed.wav"), SOUNDS["ambient_bed"]());
console.log(`  music ambient_bed.wav  ${(bedBytes / 1024).toFixed(1)} kB`);
console.log(`\n${sfxNames.length + 1} files, ${(total + bedBytes) / 1024 / 1024} MB total`);
