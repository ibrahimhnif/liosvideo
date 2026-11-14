export interface WordTiming {
  word: string;
  start: number;
  end: number;
}

export interface LineTiming {
  lineId?: string;
  line_id?: string;
  duration: number;
  words: WordTiming[];
  /** The line's audio file when it is not assets/audio/vo/<id>.mp3 (a clip cut from a long video). */
  src?: string;
  /** Set for a clip cut from a long video by `video_clip`. */
  clip?: ClipInfo;
}

/** Where the speaker is, 0 (left edge) to 1 (right edge), over one shot: `keys` are [clip seconds, x]. */
export interface FocusSegment {
  start: number;
  end: number;
  keys: [number, number][];
}

/** A stretch of a long video: its file, the seconds it spans and where the speaker sits. */
export interface ClipInfo {
  video: string;
  from: number;
  to: number;
  focus?: FocusSegment[];
}

export interface WordSpan {
  start: number;
  end: number;
}

const VO_REGISTRY = new Map<string, LineTiming>();

export function registerVoTiming(timing: LineTiming): void {
  const key = timing.lineId || timing.line_id;
  if (key) VO_REGISTRY.set(key, timing);
}

export function registerVoTimings(timings: LineTiming[] | Record<string, LineTiming>): void {
  if (Array.isArray(timings)) {
    timings.forEach(registerVoTiming);
  } else if (timings && typeof timings === "object") {
    Object.entries(timings).forEach(([k, v]) => registerVoTiming({ ...v, lineId: v.lineId || k }));
  }
}

export class VoHelper {
  readonly start = 0;
  readonly end: number;

  constructor(
    readonly lineId: string,
    private readonly timing?: LineTiming,
  ) {
    this.end = timing?.duration ?? 0;
  }

  get isReady(): boolean {
    return !!(this.timing && (this.timing.duration > 0 || (this.timing.words && this.timing.words.length > 0)));
  }

  get duration(): number {
    return this.end;
  }

  /** The audio file when it is not the default assets/audio/vo/<id>.mp3. */
  get src(): string | undefined {
    return this.timing?.src;
  }

  /** The long-video stretch this line was cut from, for `clipVideo`. */
  get clip(): ClipInfo | undefined {
    return this.timing?.clip;
  }

  /** Word timings (seconds from the start of the line); empty until the line has been generated. */
  get words(): WordTiming[] {
    return this.timing?.words ?? [];
  }

  wordTime(text: string): number | undefined {
    if (!this.timing || !this.timing.words?.length) {
      return undefined;
    }
    const target = text.trim().toLowerCase();
    const found = this.timing.words.find(
      (w) => w.word.trim().toLowerCase() === target || w.word.toLowerCase().includes(target),
    );
    return found ? found.start : undefined;
  }

  word(text: string): WordSpan {
    if (!this.timing || !this.timing.words?.length) {
      return { start: 0, end: 0 };
    }
    const target = text.trim().toLowerCase();
    const found = this.timing.words.find(
      (w) => w.word.trim().toLowerCase() === target || w.word.toLowerCase().includes(target),
    );
    if (found) {
      return { start: found.start, end: found.end };
    }
    return { start: 0, end: 0 };
  }
}

export const vo = (lineId: string, timing?: LineTiming) => {
  const resolved = timing ?? VO_REGISTRY.get(lineId) ?? (globalThis as any).__liosVoTimings?.[lineId];
  return new VoHelper(lineId, resolved);
};
