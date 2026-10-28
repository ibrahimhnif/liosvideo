import { circle, group, GroupNode, path, rect } from "../graph/kinds";

export const tokyoNightColors = {
  window: "#16161e",
  sky: "#7aa2f7",
  green: "#9ece6a",
};

/** Icon mark: rounded plate with a play glyph, flat Tokyo Night colors. */
export function logoMark(name: string, size: number, x: number, y: number): GroupNode {
  const colors = tokyoNightColors;
  const mark = group({ name, width: size, height: size, x, y, anchorX: 0.5, anchorY: 0.5 });
  mark.add(
    rect({
      name: "plate",
      width: size,
      height: size,
      radius: size * 0.26,
      fill: colors.window,
      stroke: colors.sky,
      strokeWidth: Math.max(2, size * 0.03),
    }),
  );
  mark.add(
    path({
      name: "playGlyph",
      d: `M ${size * 0.4} ${size * 0.3} L ${size * 0.72} ${size * 0.5} L ${size * 0.4} ${size * 0.7} Z`,
      fill: colors.sky,
    }),
  );
  mark.add(
    circle({
      name: "sparkDot",
      radius: size * 0.05,
      x: size * 0.8,
      y: size * 0.2,
      anchorX: 0.5,
      anchorY: 0.5,
      fill: colors.green,
    }),
  );
  return mark;
}
