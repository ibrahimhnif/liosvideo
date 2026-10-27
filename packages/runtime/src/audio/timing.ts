export interface WordTiming {
  word: string;
  start: number;
  end: number;
}

export interface LineTiming {
  lineId: string;
  duration: number;
  words: WordTiming[];
}

export interface WordSpan {
  start: number;
  end: number;
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

  word(text: string): WordSpan {
    if (!this.timing || !this.timing.words.length) {
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

export const vo = (lineId: string, timing?: LineTiming) => new VoHelper(lineId, timing);
