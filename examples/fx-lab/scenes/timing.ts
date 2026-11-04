/**
 * Single source of truth for the playbook timeline. The composition's SFX cues
 * use the same helpers so sound and picture cannot drift apart.
 */

export const PAGE = {
  width: 1920,
  height: 1080,
  fps: 30,
  duration: 7.5,
} as const;

export const GRID = {
  x: 72,
  y: 204,
  cols: 4,
  rows: 3,
  tileW: 426,
  tileH: 258,
  gapX: 24,
  gapY: 22,
} as const;

export function tileEnter(index: number): number {
  return 0.35 + index * 0.1;
}

export function tileDemo(index: number): number {
  return 0.95 + index * 0.12;
}

export function tileOrigin(index: number): { x: number; y: number } {
  const col = index % GRID.cols;
  const row = Math.floor(index / GRID.cols);
  return {
    x: GRID.x + col * (GRID.tileW + GRID.gapX),
    y: GRID.y + row * (GRID.tileH + GRID.gapY),
  };
}
