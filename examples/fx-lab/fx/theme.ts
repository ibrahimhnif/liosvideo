/**
 * Shared design tokens for the FX playbook.
 *
 * The palette is deliberately dark-studio so every effect reads on both a
 * desktop monitor and a phone. Accent colours map to the five Indonesian
 * creator archetypes the kit is modelled on.
 */

export const palette = {
  bg: "#080A0E",
  panel: "#11151D",
  panelDeep: "#0B0E14",
  border: "#232B39",
  borderSoft: "#1A2130",
  text: "#F3F6FB",
  muted: "#8792A6",
  dim: "#5A6577",
  cyan: "#38BDF8",
  amber: "#F5B942",
  rose: "#F43F5E",
  emerald: "#34D399",
  violet: "#A78BFA",
} as const;

export const fonts = {
  /** Clean UI sans — Inter (GadgetIn / tech-review register). */
  sans: "Inter",
  /** Numbers, code, timecode — IBM Plex Mono (typewriter / data register). */
  mono: "IBM Plex Mono",
  /** Archival video-essay headlines — Playfair Display (Ferry Irwandi register). */
  serif: "Playfair Display",
  /** Hype / pop numerals — Bebas Neue (Aulion / urban register). */
  display: "Bebas Neue",
} as const;

export const archetypes = {
  malaka: { label: "DARK ACADEMIA", color: palette.amber },
  agung: { label: "HYPER-CREATIVE", color: palette.violet },
  aulion: { label: "POP RHYTHM", color: palette.rose },
  gadgetin: { label: "TECH STUDIO", color: palette.emerald },
  urban: { label: "URBAN SPORT", color: palette.cyan },
} as const;

export type ArchetypeId = keyof typeof archetypes;

/** `#RRGGBB` -> `[r, g, b]` in 0..1 for shader uniforms. */
export function rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}
