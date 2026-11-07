// Master-bus processing shared by the desktop export, the live preview and
// (ported 1:1) the CLI renderer in apps/cli/src/media/loudness.rs:
//   - auto-ducking of music beds under voice-over
//   - BS.1770 integrated loudness, normalised to a target (default -14 LUFS)
//   - a look-ahead peak limiter (default ceiling -1 dBFS)
// Keep the constants here and in loudness.rs identical.

export interface DuckOptions {
  /** Reduction in dB while voice-over plays (positive number). */
  amount: number;
  /** Seconds the dip starts before each line. */
  attack: number;
  /** Seconds to come back up after a line. */
  release: number;
}

export interface MixOptions {
  /** Integrated loudness target in LUFS, or false to keep the raw level. */
  loudness?: number | false;
  /** Peak ceiling in dBFS for the limiter. */
  ceiling?: number;
  /** Duck music under voice-over, or false to turn it off. */
  duck?: false | Partial<DuckOptions>;
}

export interface ResolvedMix {
  loudness: number | false;
  ceiling: number;
  duck: false | DuckOptions;
}

export const DEFAULT_MIX: ResolvedMix = Object.freeze({
  loudness: -14,
  ceiling: -1,
  duck: Object.freeze({ amount: 12, attack: 0.15, release: 0.4 }),
}) as ResolvedMix;

/** Clips at least this long count as a music bed and duck by default. */
export const BED_MIN_SECONDS = 8;

export function resolveMix(mix: MixOptions | undefined): ResolvedMix {
  const duck =
    mix?.duck === false ? false : { ...(DEFAULT_MIX.duck as DuckOptions), ...(mix?.duck ?? {}) };
  return {
    loudness: mix?.loudness === undefined ? DEFAULT_MIX.loudness : mix.loudness,
    ceiling: mix?.ceiling ?? DEFAULT_MIX.ceiling,
    duck,
  };
}

export type AudioRole = "vo" | "music" | "sfx";

export interface MixClip {
  src: string;
  role?: AudioRole;
  ducking?: boolean;
}

export function isVoice(clip: MixClip): boolean {
  return clip.role === "vo" || /(^|\/)vo\//.test(clip.src);
}

/** A file named `sfx` (or in an `sfx/` folder) is an effects track. */
export function isSfxName(src: string): boolean {
  return /(^|[\/._-])sfx([\/._-]|$)/i.test(src);
}

/** Whether a clip that plays for `playedSeconds` should dip under voice-over. */
export function shouldDuck(clip: MixClip, playedSeconds: number): boolean {
  if (isVoice(clip)) return false;
  if (clip.ducking === true || clip.role === "music") return true;
  if (clip.ducking === false || clip.role === "sfx" || (!clip.role && isSfxName(clip.src))) return false;
  return playedSeconds >= BED_MIN_SECONDS;
}

/** Gain breakpoints `[seconds, gain]`, linear between points, 1 outside. */
export type DuckPlan = Array<[number, number]>;

/** Turns voice-over spans `[start, end]` (seconds) into a gain envelope. */
export function duckPlan(spans: Array<[number, number]>, duck: false | DuckOptions): DuckPlan {
  if (!duck || !spans.length) return [];
  const low = 10 ** (-Math.abs(duck.amount) / 20);
  const sorted = spans.filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const [s, e] of sorted) {
    const last = merged[merged.length - 1];
    // a gap shorter than release + attack would pump, so hold the dip
    if (last && s - last[1] < duck.attack + duck.release) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  const plan: DuckPlan = [];
  for (const [s, e] of merged) {
    plan.push([s - duck.attack, 1], [s, low], [e, low], [e + duck.release, 1]);
  }
  return plan;
}

export function duckGainAt(plan: DuckPlan, t: number): number {
  if (!plan.length || t <= plan[0][0] || t >= plan[plan.length - 1][0]) return 1;
  let lo = 0;
  let hi = plan.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (plan[mid][0] <= t) lo = mid;
    else hi = mid;
  }
  const [t0, g0] = plan[lo];
  const [t1, g1] = plan[hi];
  return t1 === t0 ? g1 : g0 + ((g1 - g0) * (t - t0)) / (t1 - t0);
}

/**
 * Breakpoints [t, gain] (timeline seconds) of a clip's fade in from silence and out to silence,
 * for a clip that starts at `start` and plays `played` seconds; empty without fades.
 */
export function fadePlan(start: number, played: number, fadeIn = 0, fadeOut = 0): DuckPlan {
  const plan: DuckPlan = [];
  if (fadeIn > 0 && played > 0) plan.push([start, 0], [start + Math.min(fadeIn, played), 1]);
  if (fadeOut > 0 && played > 0) {
    const end = start + played;
    plan.push([Math.max(start, end - fadeOut), 1], [end, 0]);
  }
  return plan.sort((a, b) => a[0] - b[0]);
}

/** Gain of a fade plan at timeline time `t`: held at the first / last value outside it, 1 without fades. */
export function fadeGainAt(plan: DuckPlan, t: number): number {
  if (!plan.length) return 1;
  if (t <= plan[0][0]) return plan[0][1];
  const last = plan[plan.length - 1];
  if (t >= last[0]) return last[1];
  let i = 1;
  while (plan[i][0] < t) i++;
  const [t0, g0] = plan[i - 1];
  const [t1, g1] = plan[i];
  return t1 === t0 ? g1 : g0 + ((g1 - g0) * (t - t0)) / (t1 - t0);
}

export interface ScheduledClip extends MixClip {
  /** Timeline start in seconds. */
  start: number;
  /** Seconds the clip actually plays. */
  played: number;
}

/**
 * The duck envelope for a set of clips and which clips follow it. No voice-over
 * means no ducking at all, so beds stay at their written volume.
 */
export function duckSchedule(
  clips: ScheduledClip[],
  duck: false | DuckOptions,
): { plan: DuckPlan; ducked: boolean[] } {
  const spans = clips.filter(isVoice).map((c): [number, number] => [c.start, c.start + c.played]);
  const plan = duckPlan(spans, duck);
  return { plan, ducked: clips.map((c) => plan.length > 0 && shouldDuck(c, c.played)) };
}

// ---- BS.1770 loudness ------------------------------------------------------

type Biquad = [number, number, number, number, number]; // b0 b1 b2 a1 a2

function kWeighting(sampleRate: number): [Biquad, Biquad] {
  // ITU-R BS.1770-4 pre-filter and RLB filter, derived for any sample rate
  let f0 = 1681.974450955533;
  const G = 3.999843853973347;
  let Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / sampleRate);
  const Vh = 10 ** (G / 20);
  const Vb = Vh ** 0.4996667741545416;
  let a0 = 1 + K / Q + K * K;
  const shelf: Biquad = [
    (Vh + (Vb * K) / Q + K * K) / a0,
    (2 * (K * K - Vh)) / a0,
    (Vh - (Vb * K) / Q + K * K) / a0,
    (2 * (K * K - 1)) / a0,
    (1 - K / Q + K * K) / a0,
  ];
  f0 = 38.13547087602444;
  Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / sampleRate);
  a0 = 1 + K / Q + K * K;
  const highpass: Biquad = [1, -2, 1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0];
  return [shelf, highpass];
}

const ABSOLUTE_GATE = -70;
const RELATIVE_GATE = -10;

/** Integrated loudness (LUFS) of planar channels; -Infinity for silence. */
export function measureLoudness(channels: Float32Array[], sampleRate: number): number {
  const length = channels[0]?.length ?? 0;
  const step = Math.round(sampleRate * 0.1); // 100 ms hop, 400 ms blocks
  const segments = Math.floor(length / step);
  if (segments < 4) return -Infinity;
  const energy = new Float64Array(segments); // per segment: sum over channels of sum y^2
  const [s, h] = kWeighting(sampleRate);
  for (const x of channels) {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0, z1 = 0, z2 = 0;
    for (let seg = 0; seg < segments; seg++) {
      let acc = 0;
      const end = (seg + 1) * step;
      for (let i = seg * step; i < end; i++) {
        const xi = x[i];
        const y = s[0] * xi + s[1] * x1 + s[2] * x2 - s[3] * y1 - s[4] * y2;
        x2 = x1; x1 = xi;
        const z = h[0] * y + h[1] * y1 + h[2] * y2 - h[3] * z1 - h[4] * z2;
        y2 = y1; y1 = y;
        z2 = z1; z1 = z;
        acc += z * z;
      }
      energy[seg] += acc;
    }
  }
  return gatedLoudness(energy, step);
}

function gatedLoudness(energy: Float64Array, step: number): number {
  const blocks: number[] = [];
  for (let j = 0; j + 4 <= energy.length; j++) {
    blocks.push((energy[j] + energy[j + 1] + energy[j + 2] + energy[j + 3]) / (4 * step));
  }
  const lufs = (z: number) => -0.691 + 10 * Math.log10(z);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const abs = blocks.filter((z) => z > 0 && lufs(z) > ABSOLUTE_GATE);
  if (!abs.length) return -Infinity;
  const relative = lufs(mean(abs)) + RELATIVE_GATE;
  const gated = abs.filter((z) => lufs(z) > relative);
  return lufs(mean(gated));
}

// ---- limiter ---------------------------------------------------------------

export const LIMITER_LOOKAHEAD = 0.005;
export const LIMITER_RELEASE = 0.08;

export function peak(channels: Float32Array[]): number {
  let p = 0;
  for (const c of channels) for (let i = 0; i < c.length; i++) p = Math.max(p, Math.abs(c[i]));
  return p;
}

/**
 * Look-ahead peak limiter, in place. The gain needed at each sample is held
 * over the look-ahead window and averaged over it, so it eases down before a
 * peak; it then recovers linearly over the release time. No output sample
 * exceeds the ceiling.
 */
export function limit(channels: Float32Array[], sampleRate: number, ceilingDb: number): void {
  const ceiling = 10 ** (ceilingDb / 20);
  if (peak(channels) <= ceiling) return;
  const n = channels[0].length;
  const L = Math.max(1, Math.round(sampleRate * LIMITER_LOOKAHEAD));
  const req = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (const c of channels) m = Math.max(m, Math.abs(c[i]));
    req[i] = m > ceiling ? ceiling / m : 1;
  }
  // held[m] = min(req[m .. m+L-1]) via a monotonic deque
  const held = new Float32Array(n);
  const dq = new Int32Array(n);
  let head = 0, tail = 0;
  for (let i = n - 1; i >= 0; i--) {
    while (tail > head && req[dq[tail - 1]] >= req[i]) tail--;
    dq[tail++] = i;
    while (dq[head] > i + L - 1) head++;
    held[i] = req[dq[head]];
  }
  // smooth[i] = mean(held[i-L+1 .. i]); every window in it covers i, so smooth <= req
  const inc = 1 / Math.max(1, Math.round(sampleRate * LIMITER_RELEASE));
  let sum = 0; // window total minus L (positions before 0 count as gain 1)
  let g = 1;
  for (let i = 0; i < n; i++) {
    sum += held[i] - (i >= L ? held[i - L] : 1);
    const avg = (sum + L) / L;
    g = Math.min(avg, g + inc, req[i]);
    for (const c of channels) c[i] *= g;
  }
}

export interface MasterReport {
  /** Integrated loudness before processing (LUFS). */
  measured: number;
  /** Gain applied before the limiter (dB). */
  gain: number;
  /** Integrated loudness after processing (LUFS). */
  final: number;
  /** Sample peak after processing (dBFS). */
  peak: number;
}

/** Normalises to the target loudness and limits, in place. */
export function master(channels: Float32Array[], sampleRate: number, mix: ResolvedMix): MasterReport {
  const measured = measureLoudness(channels, sampleRate);
  let gain = 0;
  if (mix.loudness !== false && Number.isFinite(measured)) {
    gain = mix.loudness - measured;
    const k = 10 ** (gain / 20);
    for (const c of channels) for (let i = 0; i < c.length; i++) c[i] *= k;
  }
  limit(channels, sampleRate, mix.ceiling);
  const p = peak(channels);
  return { measured, gain, final: measureLoudness(channels, sampleRate), peak: p > 0 ? 20 * Math.log10(p) : -Infinity };
}
