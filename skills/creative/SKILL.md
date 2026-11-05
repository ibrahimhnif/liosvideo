---
name: creative
description: Creative styling guide for liosvideo compositions, covering color palettes, typography hierarchies, motion rhythms, and visual archetypes inspired by HyperFrames.
---

# Liosvideo Creative Style Guide

This guide establishes the creative visual standards, color harmony tokens, typography ratios, and motion curves for authoring high-fidelity, aesthetic videos in **liosvideo**.

---

## 1. Curated Color Palettes

Always define a cohesive semantic palette via `theme.ts` rather than hardcoding arbitrary hex colors in scenes:

### A. Tokyo Night (Dark Tech & Minimal Screencast)
*Ideal for developer tooling, CLI breakdowns, and code tutorials.*
- **Background**: `#0b0d12` (deep obsidian) / `#1a1b26` (elevated background)
- **Surface**: `#161b22` / `#24283b`
- **Border / Stroke**: `#30363d` / `#414868`
- **Primary / Brand**: `#7aa2f7` (soft ice blue)
- **Secondary / Accent**: `#bb9af7` (lavender) / `#7dcfff` (cyan)
- **Success / Positive**: `#9ece6a` (soft green)
- **Text Main**: `#f0f6fc`
- **Text Muted**: `#8b949e` / `#565f89`

### B. Dark Tech & 3D Hardware (Futuristic Cyan & Indigo)
*Ideal for 3D product showcases, AI agents, and high-performance computing.*
- **Background**: `#07090e`
- **Surface**: `#0f172a` (slate 900)
- **Border / Stroke**: `#1e293b`
- **Primary / Glow**: `#38bdf8` (sky blue glow)
- **Secondary / Accent**: `#818cf8` (electric indigo)
- **Text Main**: `#f8fafc`
- **Text Muted**: `#64748b`

### C. Modern SaaS / Stripe Aesthetic (Clean Slate & Violet)
*Ideal for product feature announcements, landing page demos, and dashboards.*
- **Background**: `#0b0f19`
- **Surface**: `#111827`
- **Border / Stroke**: `#1f2937`
- **Primary / Brand**: `#6366f1` (indigo 500)
- **Accent / Metric**: `#10b981` (emerald 500) / `#f59e0b` (amber 500)
- **Text Main**: `#f9fafb`
- **Text Muted**: `#9ca3af`

### D. Kinetic High-Contrast (Punchy Social 9:16)
*Ideal for TikTok, Reels, Shorts, kinetic typography, and fast-paced hooks.*
- **Background**: `#08080a`
- **Surface**: `#18181b`
- **Border / Stroke**: `#27272a`
- **Primary / Pop**: `#f43f5e` (rose red) or `#fbbf24` (warm amber)
- **Highlight Tag**: `#22c55e` (emerald green)
- **Text Main**: `#ffffff` (pure white, heavy weight)
- **Text Muted**: `#a1a1aa`

---

## 2. Typography Ratios & Responsive Sizing

Never use rigid pixel sizes that break when alternating between 16:9 (`1920x1080`) and 9:16 (`1080x1920`). Always derive font sizes from `width` and clamp them:

```ts
// Responsive typography formula
const titleSize = Math.min(width * 0.045, 54);
const subtitleSize = Math.min(width * 0.024, 28);
const bodySize = Math.min(width * 0.018, 20);
const badgeSize = Math.min(width * 0.014, 15);
```

### Typeface Roles
- **Headlines**: Clean sans-serif, `fontWeight: 700` or `800`, `letterSpacing: -0.02em` for tight, modern punch.
- **Code & Numbers**: Monospace (JetBrains Mono, SF Mono, Menlo), `letterSpacing: -0.01em`.
- **Badges & Labels**: Sans-serif, `fontWeight: 600`, uppercase or titlecase with `letterSpacing: 0.04em`.

---

## 3. Motion Rhythm & Easing Curves

Motion in liosvideo must feel intentional and cinematic, avoiding mushy linear interpolation.

| Purpose | Duration | Easing | Example Use |
| :--- | :--- | :--- | :--- |
| **Micro-Interactions** | `0.15s – 0.25s` | `"outCubic"` | Word highlights, color shifts, button hover clicks |
| **Card / Window Entrance** | `0.4s – 0.6s` | `"outBack"` | Window pop, notification bubble bounce, chip appearance |
| **Smooth Pan / Zoom** | `0.5s – 0.8s` | `"inOutCubic"` | Camera focus on terminal line, window re-centering |
| **Scene Transition** | `0.4s – 0.5s` | `"fade"` / `"slide"` | Cross-scene continuity |

### 3.1 Pacing & length

- Change something visible every `2–4 s`; one beat per scene, `2.5–8 s` each.
- Total duration is `Σ scene.duration`: 9:16 shorts/reels **20–45 s**, 16:9 explainers **2–5 min**, tutorials **5–15 min**, documentation/courses **15–60 min** (30 min is normal); hooks 10–20 s.
- Long-form is chaptered: one module per chapter, 5–12 beats of 8–20 s, lower motion density, rendered per range and concatenated.
- Narration ≈ `2.4 words/s`: a 30 s short needs ~75 words across 5–7 lines, 30 min ≈ 4,300 words. Derive a scene from its VO (`vo.duration + 0.6 s`) instead of guessing.

### Key Rule for Entrance Staggers
When multiple items enter the scene (e.g. 3 feature chips), stagger their appearance by `0.12s – 0.18s`:
```ts
chips.forEach((chip, i) => {
  chip.to(
    { opacity: 1, y: targetY },
    { at: 0.4 + i * 0.15, duration: 0.5, ease: "outBack" }
  );
});
```

---

## 4. Layout, Whitespace & Spatial Polish

Whitespace is the main difference between a slide and a video: fewer elements, bigger gaps, and edges that stay clear of platform UI.

### 4.1 The rhythm unit

```ts
const u = Math.min(width, height) / 100; // 10.8 @1920x1080, 19.2 on a 1920 short edge
const safe = u * 6;                      // outer margin
const gap = { tight: u, base: u * 2, group: u * 3, section: u * 6 };
```

Gaps and paddings come from `u * [1, 2, 3, 4, 6, 8]` only. Inside a group keep one step; separate groups with two steps. Never hand-pick `13 / 37 / 55`.

### 4.2 Safe area

- Keep every element at least `safe` from each edge (title-safe and action-safe are the same box here).
- **9:16**: reserve `height * 0.12` at the bottom (platform chrome, captions) and `height * 0.05` at the top (status bar).
- Center stacks with `anchorX: 0.5` instead of eyeballed offsets; align siblings to one shared edge or centre line.

### 4.3 Air by role

| Between | Space |
| :--- | :--- |
| frame edge → content | `safe` (`u * 6`) |
| card edge → its text | `u * 1.5 – u * 3` |
| headline → subhead | `u` |
| subhead → body | `u * 2` |
| paragraph → paragraph | `u * 2` |
| grid gutter | `u * 2` |
| section → section | `u * 6` |
| window frame → canvas edge | at least `safe` |

### 4.4 Typography spacing

- `lineHeight`: headline `1.1 – 1.2`, body `1.4 – 1.5`, captions `1.2`.
- Text never wraps by width — `text` breaks only on `\n`. Keep each line ≤ 60 characters (≤ 32 in 9:16) and insert breaks yourself; never shrink below `bodySize`.
- One idea per screen: at most 3 text blocks in 9:16, 4 in 16:9.

### 4.5 Fill, corners & strokes

- Content occupies 55–70% of the frame; empty space is part of the design, not a gap to fill.
- Corner radii: main windows / cards `u * 0.5 – u * 1`; chips and badges `u * 0.4 – u * 0.6`; pills `height / 2`.
- Border stroke: `1 – 1.5px` (or `u * 0.1`) with a border colour from the palette (`#30363d` or `#27272a`).

---

## 5. Media & Asset Attribution Standards

When incorporating external imagery, background videos, b-roll footage, sound effects, or custom web fonts:
- Prefer royalty-free and open platforms (Unsplash, Pexels, Wikimedia Commons, FreeSound, Google Fonts).
- Store deterministic assets under `assets/images/`, `assets/video/`, `assets/audio/music/`, or `assets/fonts/`.
- Maintain complete attributions in `assets/ATTRIBUTIONS.md` listing File, Source URL, Author/Creator, License, and Usage.
- When the user adds video footage through the desktop chat, it is saved directly to `assets/video/<name>` and referenced in the prompt without binary token overhead. Integrate it with `video({ name: "...", src: "assets/video/<name>", fit: "cover" })`.
