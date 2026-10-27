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
