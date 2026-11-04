/**
 * The FX catalog: machine-readable metadata for every effect in the kit.
 * Scenes and docs import this list so labels, SFX and demos never drift.
 *
 * volume 1 = the 12-tile "FX Playbook" page
 * volume 2 = the second batch demoed in `fx-examples-vol2.ts`
 */

import type { SfxId } from "./sfx";
import type { ArchetypeId } from "./theme";

export type FxCategory =
  | "texture"
  | "camera"
  | "typography"
  | "transition"
  | "graphic"
  | "social"
  | "editorial"
  | "data"
  | "annotation";

export interface FxEntry {
  id: string;
  name: string;
  category: FxCategory;
  archetype: ArchetypeId;
  blurb: string;
  /** Component(s) that implement it. */
  recipe: string;
  sfx: SfxId[];
  volume: 1 | 2;
}

export const FX_CATALOG: FxEntry[] = [
  // ------------------------------------------------------------- volume 1
  {
    id: "film-grain",
    name: "Film Grain 24fps",
    category: "texture",
    archetype: "malaka",
    blurb: "Grain 24 fps, vignette, dan flicker halus.",
    recipe: "filmGrain() · vignette()",
    sfx: [],
    volume: 1,
  },
  {
    id: "paper-tear",
    name: "Paper Tear Reveal",
    category: "transition",
    archetype: "malaka",
    blurb: "Robekan kertas arsip membuka panel gelap.",
    recipe: "tornPaper()",
    sfx: ["paperTear"],
    volume: 1,
  },
  {
    id: "typewriter",
    name: "Typewriter + Stabilo",
    category: "typography",
    archetype: "malaka",
    blurb: "Ketik per karakter, cursor berkedip, stabilo.",
    recipe: "typewriter() · highlighter()",
    sfx: ["typewriterRun"],
    volume: 1,
  },
  {
    id: "kinetic-caption",
    name: "Kinetic Word Sync",
    category: "typography",
    archetype: "aulion",
    blurb: "Kata membesar dan berubah warna di beat.",
    recipe: "kineticWord()",
    sfx: ["pop"],
    volume: 1,
  },
  {
    id: "crash-zoom",
    name: "Crash Zoom + Shake",
    category: "camera",
    archetype: "urban",
    blurb: "Zoom 1.0→1.35 lalu getaran kamera.",
    recipe: "crashZoom() · shake()",
    sfx: ["whooshDeep", "impactThud"],
    volume: 1,
  },
  {
    id: "whip-pan",
    name: "Whip Pan",
    category: "transition",
    archetype: "agung",
    blurb: "Sapuan horizontal cepat dengan streak.",
    recipe: "whipPan()",
    sfx: ["whooshFast"],
    volume: 1,
  },
  {
    id: "glitch-rgb",
    name: "RGB Glitch Split",
    category: "texture",
    archetype: "agung",
    blurb: "Pemisahan kanal RGB dan baris jitter.",
    recipe: "glitchRGB()",
    sfx: ["glitch"],
    volume: 1,
  },
  {
    id: "letterbox",
    name: "Cinematic Letterbox",
    category: "graphic",
    archetype: "agung",
    blurb: "Bar 2.39:1 masuk dari atas dan bawah.",
    recipe: "letterbox()",
    sfx: ["softSwoosh"],
    volume: 1,
  },
  {
    id: "count-up",
    name: "Count-Up + Badge",
    category: "graphic",
    archetype: "gadgetin",
    blurb: "Angka naik halus, badge spesifikasi pop.",
    recipe: "countUp() · pillBadge()",
    sfx: ["kaching", "bell"],
    volume: 1,
  },
  {
    id: "impact-burst",
    name: "Impact Burst",
    category: "camera",
    archetype: "urban",
    blurb: "Garis radial, ring kejut, dan flash.",
    recipe: "speedLines()",
    sfx: ["riser", "impactSub"],
    volume: 1,
  },
  {
    id: "lower-third",
    name: "Lower Third + Ticker",
    category: "graphic",
    archetype: "gadgetin",
    blurb: "Nama, peran, dan ticker berjalan.",
    recipe: "lowerThird() · ticker()",
    sfx: ["tick"],
    volume: 1,
  },
  {
    id: "spotlight",
    name: "Spotlight Focus",
    category: "camera",
    archetype: "malaka",
    blurb: "Sorot lampu bergerak, subjek tetap fokus.",
    recipe: "lightPool() · spotlight()",
    sfx: ["heartbeat"],
    volume: 1,
  },

  // ------------------------------------------------------------- volume 2
  {
    id: "karaoke-caption",
    name: "Karaoke Caption",
    category: "social",
    archetype: "aulion",
    blurb: "Kata menyala satu per satu mengikuti narasi.",
    recipe: "karaokeCaption()",
    sfx: ["pop"],
    volume: 2,
  },
  {
    id: "versus-split",
    name: "Versus Split Screen",
    category: "social",
    archetype: "urban",
    blurb: "Duel atas-bawah, divider, dan badge VS.",
    recipe: "versusSplit()",
    sfx: ["bellRound"],
    volume: 2,
  },
  {
    id: "confetti",
    name: "Confetti Burst",
    category: "social",
    archetype: "aulion",
    blurb: "Serpihan warna jatuh, deterministik.",
    recipe: "confetti()",
    sfx: ["kaching"],
    volume: 2,
  },
  {
    id: "quote-card",
    name: "Editorial Quote Card",
    category: "editorial",
    archetype: "malaka",
    blurb: "Kutipan serif, garis aksen, atribusi.",
    recipe: "quoteCard()",
    sfx: ["paperTear"],
    volume: 2,
  },
  {
    id: "chapter-card",
    name: "Chapter Card",
    category: "editorial",
    archetype: "malaka",
    blurb: "Nomor bab, judul, dan progress dots.",
    recipe: "chapterCard()",
    sfx: ["tick"],
    volume: 2,
  },
  {
    id: "polaroid-frame",
    name: "Polaroid Collage",
    category: "editorial",
    archetype: "malaka",
    blurb: "Foto miring dengan selotip dan bayangan.",
    recipe: "polaroidFrame()",
    sfx: ["cameraShutter"],
    volume: 2,
  },
  {
    id: "breaking-banner",
    name: "Breaking News Banner",
    category: "editorial",
    archetype: "agung",
    blurb: "Banner merah, dot berkedip, headline.",
    recipe: "breakingBanner()",
    sfx: ["impactThud"],
    volume: 2,
  },
  {
    id: "bar-chart",
    name: "Animated Bar Chart",
    category: "data",
    archetype: "gadgetin",
    blurb: "Bar tumbuh dengan label dan nilai.",
    recipe: "barChart()",
    sfx: ["pop"],
    volume: 2,
  },
  {
    id: "waveform",
    name: "Audio Waveform",
    category: "data",
    archetype: "urban",
    blurb: "Equalizer deterministik untuk musik/podcast.",
    recipe: "waveform()",
    sfx: ["heartbeat"],
    volume: 2,
  },
  {
    id: "annotation",
    name: "Circle + Arrow Note",
    category: "annotation",
    archetype: "gadgetin",
    blurb: "Lingkaran tangan dan panah penunjuk.",
    recipe: "annotationCircle() · arrowPointer()",
    sfx: ["uiClick"],
    volume: 2,
  },
];

export const FX_IDS = FX_CATALOG.map((entry) => entry.id);

export function fxById(id: string): FxEntry {
  const entry = FX_CATALOG.find((e) => e.id === id);
  if (!entry) throw new Error(`Unknown FX id "${id}"`);
  return entry;
}
