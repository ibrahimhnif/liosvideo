export type RGBA = [number, number, number, number];

export function parseColor(hex: string): RGBA {
  let h = hex.replace(/^#/, "");
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
  if (h.length === 6) h += "ff";
  if (!/^[0-9a-f]{8}$/i.test(h)) throw new Error(`Invalid color "${hex}"`);
  return [0, 2, 4, 6].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as RGBA;
}

export function formatColor([r, g, b, a]: RGBA): string {
  return "#" + [r, g, b, a].map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0")).join("");
}

export function lerpColor(a: string, b: string, t: number): string {
  const ca = parseColor(a);
  const cb = parseColor(b);
  return formatColor(ca.map((v, i) => v + (cb[i] - v) * t) as RGBA);
}
