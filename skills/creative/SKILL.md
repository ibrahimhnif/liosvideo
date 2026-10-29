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

## 4. Layout Formulas & Spatial Polish

- **Window Margins**: Keep window frames centered with at least `32px` to `64px` padding from the canvas edge.
- **Corner Radiuses**:
  - Main app windows: `12px – 16px`
  - Floating badges / chips: `8px – 12px`
  - Pill badges: `9999px` (fully rounded)
- **Border Stroke**: Standard subtle stroke is `1px` or `1.5px` with a contrast-appropriate border color (`#30363d` or `#27272a`).
