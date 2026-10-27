const pad = (n: number) => String(n).padStart(2, "0");

export function formatTimecode(frame: number, fps: number): string {
  const totalSeconds = Math.floor(frame / fps);
  return `${pad(Math.floor(totalSeconds / 60))}:${pad(totalSeconds % 60)}:${pad(frame % fps)}`;
}

/** Maps wall-clock time to frames. Pure: callers pass the current time. */
export class PlaybackClock {
  private base = 0;
  private startMs: number | undefined;
  private _playing = false;

  constructor(
    private fps: number,
    private totalFrames: number,
  ) {}

  get playing(): boolean {
    return this._playing;
  }

  private get last(): number {
    return Math.max(this.totalFrames - 1, 0);
  }

  /** Updates the composition length after a reload, keeping the playhead (clamped). */
  setLength(fps: number, totalFrames: number): void {
    this.fps = fps;
    this.totalFrames = totalFrames;
    this.base = Math.min(this.base, this.last);
  }

  play(nowMs: number): void {
    if (this.base >= this.last) this.base = 0;
    this._playing = true;
    this.startMs = nowMs;
  }

  pause(nowMs: number): void {
    this.base = this.frameAt(nowMs);
    this._playing = false;
  }

  seek(frame: number): void {
    this.base = Math.min(Math.max(Math.round(frame), 0), this.last);
    // anchor the next frameAt() call to the new position
    if (this._playing) this.startMs = undefined;
  }

  frameAt(nowMs: number): number {
    if (!this._playing) return this.base;
    this.startMs ??= nowMs;
    const frame = this.base + Math.floor(((nowMs - this.startMs) * this.fps) / 1000);
    if (frame >= this.last) {
      this.base = this.last;
      this._playing = false;
      return this.last;
    }
    return frame;
  }
}
