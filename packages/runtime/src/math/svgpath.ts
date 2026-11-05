/** Tight local-space bounds of an SVG path `d` string, including the stroke. */
export interface PathBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

type Token = string | number;

const ARITY: Record<string, number> = {
  M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0,
};

const TOKEN = /([MmLlHhVvCcSsQqTtAaZz])|([-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?)/g;

function tokenize(d: string): Token[] {
  const out: Token[] = [];
  for (const match of d.matchAll(TOKEN)) out.push(match[1] ?? Number(match[2]));
  return out;
}

class Accumulator {
  minX = Infinity;
  minY = Infinity;
  maxX = -Infinity;
  maxY = -Infinity;

  get empty(): boolean {
    return this.minX > this.maxX || this.minY > this.maxY;
  }

  x(value: number): void {
    if (value < this.minX) this.minX = value;
    if (value > this.maxX) this.maxX = value;
  }

  y(value: number): void {
    if (value < this.minY) this.minY = value;
    if (value > this.maxY) this.maxY = value;
  }

  point(x: number, y: number): void {
    this.x(x);
    this.y(y);
  }
}

/** Interior extrema of a cubic Bézier on one axis (endpoints included by the caller). */
function cubicExtrema(p0: number, p1: number, p2: number, p3: number, into: (t: number) => void): void {
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = p1 - p0;
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) > 1e-12) into(-c / b);
    return;
  }
  const disc = b * b - 4 * a * c;
  if (disc < 0) return;
  const root = Math.sqrt(disc);
  into((-b + root) / (2 * a));
  into((-b - root) / (2 * a));
}

function cubicPoint(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

function addCubic(bounds: Accumulator, x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x: number, y: number): void {
  bounds.point(x, y);
  cubicExtrema(x0, x1, x2, x, (t) => {
    if (t > 0 && t < 1) bounds.x(cubicPoint(x0, x1, x2, x, t));
  });
  cubicExtrema(y0, y1, y2, y, (t) => {
    if (t > 0 && t < 1) bounds.y(cubicPoint(y0, y1, y2, y, t));
  });
}

function addQuad(bounds: Accumulator, x0: number, y0: number, x1: number, y1: number, x: number, y: number): void {
  bounds.point(x, y);
  const peak = (p0: number, p1: number, p2: number) => {
    const den = p0 - 2 * p1 + p2;
    return den === 0 ? NaN : (p0 - p1) / den;
  };
  const tx = peak(x0, x1, x);
  if (tx > 0 && tx < 1) {
    const u = 1 - tx;
    bounds.x(u * u * x0 + 2 * u * tx * x1 + tx * tx * x);
  }
  const ty = peak(y0, y1, y);
  if (ty > 0 && ty < 1) {
    const u = 1 - ty;
    bounds.y(u * u * y0 + 2 * u * ty * y1 + ty * ty * y);
  }
}

/** Samples an elliptical arc (SVG spec F.6.5 endpoint parameterisation) at ~1°. */
function addArc(
  bounds: Accumulator,
  x0: number,
  y0: number,
  rx: number,
  ry: number,
  rotation: number,
  largeArc: boolean,
  sweep: boolean,
  x: number,
  y: number,
): void {
  bounds.point(x, y);
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  if (rx === 0 || ry === 0 || (x0 === x && y0 === y)) return;

  const phi = (rotation * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x0 - x) / 2;
  const dy = (y0 - y) / 2;
  const x1 = cos * dx + sin * dy;
  const y1 = -sin * dx + cos * dy;

  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) {
    const k = Math.sqrt(lambda);
    rx *= k;
    ry *= k;
  }

  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  if (den === 0) return;
  const coef = (largeArc === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (coef * rx * y1) / ry;
  const cyp = (-coef * ry * x1) / rx;
  const cx = cos * cxp - sin * cyp + (x0 + x) / 2;
  const cy = sin * cxp + cos * cyp + (y0 + y) / 2;

  const angle = (ux: number, uy: number, vx: number, vy: number) => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    const raw = len === 0 ? 0 : Math.acos(Math.min(1, Math.max(-1, dot / len)));
    return ux * vy - uy * vx < 0 ? -raw : raw;
  };
  const ux = (x1 - cxp) / rx;
  const uy = (y1 - cyp) / ry;
  const vx = (-x1 - cxp) / rx;
  const vy = (-y1 - cyp) / ry;
  const start = angle(1, 0, ux, uy);
  let delta = angle(ux, uy, vx, vy);
  if (!sweep && delta > 0) delta -= Math.PI * 2;
  if (sweep && delta < 0) delta += Math.PI * 2;

  const steps = Math.max(2, Math.ceil(Math.abs(delta) / (Math.PI / 180)));
  for (let i = 1; i < steps; i++) {
    const a = start + (delta * i) / steps;
    const px = rx * Math.cos(a);
    const py = ry * Math.sin(a);
    bounds.point(cx + cos * px - sin * py, cy + sin * px + cos * py);
  }
}

function trace(tokens: Token[], bounds: Accumulator): void {
  let i = 0;
  let cmd = "";
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let prev = "";
  let cubicX = 0;
  let cubicY = 0;
  let quadX = 0;
  let quadY = 0;

  while (i < tokens.length) {
    const token = tokens[i];
    if (typeof token === "string") {
      cmd = token;
      i++;
    } else if (!cmd) {
      i++;
      continue;
    }

    const upper = cmd.toUpperCase();
    const rel = cmd !== upper;
    const arity = ARITY[upper];
    if (arity === undefined) {
      cmd = "";
      continue;
    }
    if (arity === 0) {
      cx = sx;
      cy = sy;
      prev = "Z";
      cmd = "";
      continue;
    }

    const args: number[] = [];
    while (args.length < arity && i < tokens.length && typeof tokens[i] === "number") args.push(tokens[i++] as number);
    if (args.length < arity) break;

    switch (upper) {
      case "M": {
        const x = rel ? cx + args[0] : args[0];
        const y = rel ? cy + args[1] : args[1];
        cx = x;
        cy = y;
        sx = x;
        sy = y;
        bounds.point(x, y);
        prev = "M";
        cmd = rel ? "l" : "L";
        break;
      }
      case "L": {
        const x = rel ? cx + args[0] : args[0];
        const y = rel ? cy + args[1] : args[1];
        bounds.point(x, y);
        cx = x;
        cy = y;
        prev = "L";
        break;
      }
      case "H": {
        const x = rel ? cx + args[0] : args[0];
        bounds.point(x, cy);
        cx = x;
        prev = "H";
        break;
      }
      case "V": {
        const y = rel ? cy + args[0] : args[0];
        bounds.point(cx, y);
        cy = y;
        prev = "V";
        break;
      }
      case "C": {
        const x1 = rel ? cx + args[0] : args[0];
        const y1 = rel ? cy + args[1] : args[1];
        const x2 = rel ? cx + args[2] : args[2];
        const y2 = rel ? cy + args[3] : args[3];
        const x = rel ? cx + args[4] : args[4];
        const y = rel ? cy + args[5] : args[5];
        addCubic(bounds, cx, cy, x1, y1, x2, y2, x, y);
        cubicX = x2;
        cubicY = y2;
        cx = x;
        cy = y;
        prev = "C";
        break;
      }
      case "S": {
        const x2 = rel ? cx + args[0] : args[0];
        const y2 = rel ? cy + args[1] : args[1];
        const x = rel ? cx + args[2] : args[2];
        const y = rel ? cy + args[3] : args[3];
        const smooth = prev === "C" || prev === "S";
        const x1 = smooth ? 2 * cx - cubicX : cx;
        const y1 = smooth ? 2 * cy - cubicY : cy;
        addCubic(bounds, cx, cy, x1, y1, x2, y2, x, y);
        cubicX = x2;
        cubicY = y2;
        cx = x;
        cy = y;
        prev = "S";
        break;
      }
      case "Q": {
        const x1 = rel ? cx + args[0] : args[0];
        const y1 = rel ? cy + args[1] : args[1];
        const x = rel ? cx + args[2] : args[2];
        const y = rel ? cy + args[3] : args[3];
        addQuad(bounds, cx, cy, x1, y1, x, y);
        quadX = x1;
        quadY = y1;
        cx = x;
        cy = y;
        prev = "Q";
        break;
      }
      case "T": {
        const x = rel ? cx + args[0] : args[0];
        const y = rel ? cy + args[1] : args[1];
        const smooth = prev === "Q" || prev === "T";
        const x1 = smooth ? 2 * cx - quadX : cx;
        const y1 = smooth ? 2 * cy - quadY : cy;
        addQuad(bounds, cx, cy, x1, y1, x, y);
        quadX = x1;
        quadY = y1;
        cx = x;
        cy = y;
        prev = "T";
        break;
      }
      case "A": {
        const x = rel ? cx + args[5] : args[5];
        const y = rel ? cy + args[6] : args[6];
        addArc(bounds, cx, cy, args[0], args[1], args[2], args[3] !== 0, args[4] !== 0, x, y);
        cx = x;
        cy = y;
        prev = "A";
        break;
      }
    }
  }
}

/**
 * Bounds of `d` in local units. `strokeWidth` widens the box by half on every side,
 * since a stroke straddles the path. Malformed or empty paths give a zero box.
 */
export function pathBounds(d: string, strokeWidth = 0): PathBounds {
  const bounds = new Accumulator();
  trace(tokenize(d), bounds);
  if (bounds.empty) return { x: 0, y: 0, width: 0, height: 0 };
  const pad = strokeWidth > 0 ? strokeWidth / 2 : 0;
  return {
    x: bounds.minX - pad,
    y: bounds.minY - pad,
    width: bounds.maxX - bounds.minX + pad * 2,
    height: bounds.maxY - bounds.minY + pad * 2,
  };
}
