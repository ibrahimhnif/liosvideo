import { lerpColor } from "../math/color";
import { ease, type Ease } from "./easing";

export type Segment<T> = { start: number; end: number; from: T | undefined; to: T; ease: Ease };

const isColor = (v: unknown): v is string => typeof v === "string" && v.startsWith("#");

function interpolate<T extends number | string>(a: T, b: T, k: number): T {
  if (typeof a === "number" && typeof b === "number") return (a + (b - a) * k) as T;
  if (isColor(a) && isColor(b)) return lerpColor(a, b, k) as T;
  return b;
}

/** Keyframe track for one property. Pure: valueAt depends only on t and the segments. */
export class Track<T extends number | string> {
  private segments: Segment<T>[] = [];

  constructor(private readonly initial: T) {}

  add(seg: Segment<T>): void {
    this.segments.push(seg);
    // stable sort keeps insertion order for equal starts
    this.segments.sort((x, y) => x.start - y.start);
  }

  valueAt(t: number): T {
    let value = this.initial;
    for (const seg of this.segments) {
      if (t < seg.start) break;
      const from = seg.from ?? value;
      if (t >= seg.end) {
        value = seg.to;
      } else {
        const k = ease(seg.ease, (t - seg.start) / (seg.end - seg.start));
        value = interpolate(from, seg.to, k);
      }
    }
    return value;
  }
}
