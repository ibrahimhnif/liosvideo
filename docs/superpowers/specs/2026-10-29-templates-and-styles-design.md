# Design Specification: Templates, Styles & Archetype Skills

- **Date**: 2026-10-29
- **Status**: Proposed
- **Author**: Antigravity AI & Hanif

---

## 1. Overview & Goals

This specification defines the architecture for **Templates, Styles, and Archetype Skills** in **Liosvideo**, drawing direct architectural inspiration from the **HyperFrames** (`heygen-com/hyperframes`) agent skills framework.

### Key Goals
1. **Desktop UI Template Picker (Optional)**:
   - Provide an optional template card selector in `ProjectPicker.svelte`.
   - Users can create a **✨ Blank / Custom** project (default, no forced archetype) or pick from 4 curated video archetypes.
2. **Curated Archetype Starters ("Lebih detail tapi tidak intimidatif")**:
   - Each archetype generates a clean, modular, 3-scene structure (`intro.ts`, `main.ts`, `outro.ts`), a simple `theme.ts` token file, synchronized `script.md`, and responsive `long.ts` (16:9) / `short.ts` (9:16).
3. **HyperFrames-Inspired Skills Ecosystem**:
   - Separate creative visual direction from atomic motion blueprints.
   - Deliver `skills/creative/` for color palettes, typography scales, motion curves, and layout rules.
   - Deliver `skills/blueprints/` containing modular scene recipes for Terminal Screencasts, 3D Product Showcases, Kinetic Social Shorts, and SaaS Feature Launches.
   - Ensure newly scaffolded projects embed these guidelines into `.agents/skills/liosvideo/`.

---

## 2. The 4 Starter Archetypes (+ Blank)

| Archetype ID | Name | Target Ratio | Visual Style & Key Nodes | Scene Composition |
| :--- | :--- | :--- | :--- | :--- |
| `blank` | **Blank / Custom** *(Default)* | 16:9 & 9:16 | Minimal canvas with clean slate card | `intro.ts` (Single clean hook) |
| `minimal-dev` | **Minimal Dev Screencast** | 16:9 (responsive 9:16) | Tokyo Night / Catppuccin, terminal prompt, code spotlight, micro-zoom | `intro.ts` (Title & prompt) → `main.ts` (Code spotlight & browser) → `outro.ts` (Summary checklist & repo handle) |
| `product-3d` | **3D Product Showcase** | 16:9 | Futuristic dark tech, Three.js 3D geometry + lights, floating feature chips | `intro.ts` (Camera push-in to 3D hero) → `main.ts` (3D rotation + floating spec cards) → `outro.ts` (Center lock & launch date badge) |
| `kinetic-short` | **Kinetic Short (9:16)** | 9:16 portrait | High-energy TikTok/Reels, bold typography, word-level audio sync, `phone()` frame | `intro.ts` (Pop hook title) → `main.ts` (Phone demo + kinetic subtitle overlay) → `outro.ts` (Follow CTA & bouncy cursor click) |
| `saas-launch` | **SaaS Feature Launch** | 16:9 | Stripe/Linear modern aesthetic, subtle glassmorphism, browser `chrome()`, metric badges | `intro.ts` (Announcement pill + gradient text) → `main.ts` (Browser demo + metric cards) → `outro.ts` (CTA button + brand badge) |

---

## 3. Project File Structure per Archetype

When an archetype is selected, the scaffolded directory will contain:

```text
long.ts                     # 16:9 composition chaining intro -> main -> outro
short.ts                    # 9:16 composition chaining intro -> main -> outro
theme.ts                    # Semantic design tokens (colors, fonts, easing curves)
script.md                   # Researched script with stable <!-- vo:id --> comments
scenes/
  intro.ts                  # Scene 1: Hook / Entrance
  main.ts                   # Scene 2: Core Showcase / Feature
  outro.ts                  # Scene 3: Wrap-up & Call to Action
.liosvideo/
  project.json              # Project manifest & audio cache
.agents/skills/
  liosvideo/SKILL.md        # Master director skill + embedded creative guide & blueprints
assets/                     # Asset folders (images, video, fonts, audio/vo, audio/music)
```

### Example `theme.ts`
```ts
export const theme = {
  colors: {
    bg: "#0b0d12",
    surface: "#161b22",
    surfaceBorder: "#30363d",
    primary: "#38bdf8",
    accent: "#818cf8",
    text: "#f0f6fc",
    muted: "#8b949e"
  },
  fonts: {
    heading: "sans-serif",
    mono: "monospace"
  },
  easing: {
    smooth: "outCubic" as const,
    pop: "outBack" as const
  }
};
```

---

## 4. Desktop UI (`ProjectPicker.svelte`) Specification

### Visual Layout
1. **Header & Logo**: Kept minimal and elegant.
2. **Project Name Input**: Text field for project name.
3. **Optional Template Selector (Grid)**:
   - 5 selectable cards:
     - `✨ Blank / Custom` *(Selected by default)*
     - `🖥️ Minimal Dev Screencast`
     - `🧊 3D Product Showcase`
     - `📱 Kinetic Short (9:16)`
     - `🚀 SaaS Feature Launch`
   - Each card displays: Icon, Title, Aspect ratio tag (`16:9` or `9:16`), and 1-line description.
   - Clicking a card toggles active state.
4. **Action Buttons**:
   - `[ Create Project… ]`: Creates project using the selected template (or `blank` if unchanged).
   - `[ Open folder… ]`: Opens existing project.
   - Recent projects list below.

---

## 5. Backend Scaffolding (`scaffold.rs` & `project.rs`)

### Tauri Command Signature
```rust
#[tauri::command]
pub fn create_project(
    parent: String, 
    name: String, 
    template: Option<String>
) -> Result<ProjectInfo, String>
```

### Template Registry in Rust
`scaffold.rs` defines template bundles using `include_str!` or folder mapping:
- `templates/blank/` (current default: `intro.ts`, `long.ts`, `short.ts`, `script.md`)
- `templates/minimal-dev/`
- `templates/product-3d/`
- `templates/kinetic-short/`
- `templates/saas-launch/`

All templates share common files (`.gitignore`, `AGENTS.md`, `project.json`, and `.agents/skills/liosvideo/SKILL.md`).

---

## 6. Skills & Creative Guidelines Architecture

### Modular Skills Tree in Repository:
```text
skills/
  liosvideo/
    SKILL.md               # Master Director router
  creative/
    SKILL.md               # Visual style rules, color palettes, typography scales, motion rhythms
  blueprints/
    screencast.md          # Terminal spotlight, micro pan/zoom recipes
    product-3d.md          # Three.js 3D setup, lighting, camera animation, floating chips
    kinetic-short.md       # 9:16 phone mockup, kinetic word highlighting, pop cards
    saas-launch.md         # Chrome browser window, metric badges, sleek CTA
```

### Embedded in Project `.agents/skills/liosvideo/SKILL.md`:
The project's internal skill includes:
1. Core frame-pure principles & node primitives.
2. The 4 Archetype Blueprints with copy-pasteable code patterns.
3. Design Token reference (`theme.ts`) so agents can adjust colors and fonts uniformly.
4. Voice-over synchronization rules and Desktop Stage Tabs navigation.

---

## 7. Verification & Testing Plan

1. **Rust Unit Tests**:
   - Verify `create_project_in` with each template ID (`blank`, `minimal-dev`, `product-3d`, `kinetic-short`, `saas-launch`).
   - Validate that all generated files compile and exist.
2. **Desktop Browser Tests (Playwright)**:
   - Test `ProjectPicker.svelte`: template selection, creating a blank project, and creating an archetype project.
3. **Runtime Validation**:
   - Ensure generated TypeScript files (`scenes/*.ts`, `long.ts`, `short.ts`) typecheck and bundle cleanly without errors.
