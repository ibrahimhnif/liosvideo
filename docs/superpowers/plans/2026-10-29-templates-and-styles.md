# Templates, Styles & Archetype Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement an optional template selector in Liosvideo Desktop UI (`ProjectPicker`), multi-scene starter scaffolds (`blank`, `minimal-dev`, `product-3d`, `kinetic-short`, `saas-launch`), and a HyperFrames-inspired modular skills ecosystem (`creative`, `blueprints`, and master director).

**Architecture:** Rust backend in `scaffold.rs` registers template bundles using `include_str!` and populates projects based on an optional template ID. Svelte 5 frontend in `ProjectPicker.svelte` provides an aesthetic card grid where "Blank / Custom" is default (making template selection completely optional). The skills directory provides modular creative direction (`skills/creative/SKILL.md`) and archetype scene blueprints (`skills/blueprints/*.md`), which are also embedded into scaffolded projects.

**Tech Stack:** Rust (Tauri v2), Svelte 5, TypeScript, WebGPU/Three.js declarative runtime, Vitest/Playwright browser testing.

**Spec:** `docs/superpowers/specs/2026-10-29-templates-and-styles-design.md`

## Global Constraints
- Pure and deterministic rendering: derived strictly from `time` and `progress`.
- No forced template selection: Default must be `blank` / custom without extra friction.
- Responsive compositions: Support both 16:9 (`1920x1080`) and 9:16 (`1080x1920`).
- No external runtime dependencies beyond existing `liosvideo` and `three`.

---

### Task 1: HyperFrames-Inspired Creative Skills & Scene Blueprints

**Files:**
- Create: `skills/creative/SKILL.md`
- Create: `skills/blueprints/screencast.md`
- Create: `skills/blueprints/product-3d.md`
- Create: `skills/blueprints/kinetic-short.md`
- Create: `skills/blueprints/saas-launch.md`
- Modify: `skills/liosvideo/SKILL.md`
- Modify: `.agents/skills/liosvideo/SKILL.md`
- Modify: `apps/desktop/src-tauri/templates/skills/liosvideo/SKILL.md`

**Interfaces:**
- Produces: Structured creative skill specifications and markdown blueprints for each archetype that agents reference when creating or styling scenes.

- [ ] **Step 1: Create `skills/creative/SKILL.md`**
  Author comprehensive creative direction guidelines inspired by HyperFrames `creative`:
  - Curated color palettes: Tokyo Night, Clean Dark Monochrome, Cyberpunk Neon, Modern SaaS Slate.
  - Typography scale: dynamic sizing based on `width` and `height`, line heights, letter spacing.
  - Motion rhythm: micro-interactions (`0.2s-0.3s`, `outCubic`), hero reveals (`0.5s-0.7s`, `outBack`), scene transitions (`0.4s-0.6s`).
  - Spatial composition: window margins (30-50px), card padding, border radius guidelines.

- [ ] **Step 2: Create the 4 scene blueprints in `skills/blueprints/`**
  - `skills/blueprints/screencast.md`: Terminal prompt typing, code spotlight, micro-zoom to cursor.
  - `skills/blueprints/product-3d.md`: Three.js 3D geometry + materials, directional lights, slow spin, floating spec chips.
  - `skills/blueprints/kinetic-short.md`: 9:16 phone frame mockup, word-by-word punchy audio sync, emoji pop badge.
  - `skills/blueprints/saas-launch.md`: Browser `chrome()` mockup, metric counter cards, sleek call-to-action button.

- [ ] **Step 3: Update `skills/liosvideo/SKILL.md` and project templates**
  Incorporate references to `skills/creative/SKILL.md` and `skills/blueprints/` into the master director skill so agents know how to look up styles and archetype patterns. Sync to `.agents/skills/liosvideo/SKILL.md` and `apps/desktop/src-tauri/templates/skills/liosvideo/SKILL.md`.

- [ ] **Step 4: Commit**
  ```bash
  git add skills/ .agents/skills/ apps/desktop/src-tauri/templates/skills/
  git commit -m "docs(skills): add creative style guide and archetype blueprints"
  ```

---

### Task 2: Create Template Files in `src-tauri/templates/`

**Files:**
- Create: `apps/desktop/src-tauri/templates/minimal-dev/theme.ts`
- Create: `apps/desktop/src-tauri/templates/minimal-dev/scenes/intro.ts`
- Create: `apps/desktop/src-tauri/templates/minimal-dev/scenes/main.ts`
- Create: `apps/desktop/src-tauri/templates/minimal-dev/scenes/outro.ts`
- Create: `apps/desktop/src-tauri/templates/minimal-dev/long.ts`
- Create: `apps/desktop/src-tauri/templates/minimal-dev/short.ts`
- Create: `apps/desktop/src-tauri/templates/minimal-dev/script.md`
- Create: `apps/desktop/src-tauri/templates/product-3d/theme.ts`
- Create: `apps/desktop/src-tauri/templates/product-3d/scenes/intro.ts`
- Create: `apps/desktop/src-tauri/templates/product-3d/scenes/main.ts`
- Create: `apps/desktop/src-tauri/templates/product-3d/scenes/outro.ts`
- Create: `apps/desktop/src-tauri/templates/product-3d/long.ts`
- Create: `apps/desktop/src-tauri/templates/product-3d/short.ts`
- Create: `apps/desktop/src-tauri/templates/product-3d/script.md`
- Create: `apps/desktop/src-tauri/templates/kinetic-short/theme.ts`
- Create: `apps/desktop/src-tauri/templates/kinetic-short/scenes/intro.ts`
- Create: `apps/desktop/src-tauri/templates/kinetic-short/scenes/main.ts`
- Create: `apps/desktop/src-tauri/templates/kinetic-short/scenes/outro.ts`
- Create: `apps/desktop/src-tauri/templates/kinetic-short/long.ts`
- Create: `apps/desktop/src-tauri/templates/kinetic-short/short.ts`
- Create: `apps/desktop/src-tauri/templates/kinetic-short/script.md`
- Create: `apps/desktop/src-tauri/templates/saas-launch/theme.ts`
- Create: `apps/desktop/src-tauri/templates/saas-launch/scenes/intro.ts`
- Create: `apps/desktop/src-tauri/templates/saas-launch/scenes/main.ts`
- Create: `apps/desktop/src-tauri/templates/saas-launch/scenes/outro.ts`
- Create: `apps/desktop/src-tauri/templates/saas-launch/long.ts`
- Create: `apps/desktop/src-tauri/templates/saas-launch/short.ts`
- Create: `apps/desktop/src-tauri/templates/saas-launch/script.md`

**Interfaces:**
- Produces: Complete, deterministic TypeScript scene files and markdown scripts for each archetype starter.

- [ ] **Step 1: Write `minimal-dev` template files**
  - `theme.ts`: Tokyo Night palette (`#1a1b26`, `#24283b`, `#7aa2f7`, `#bb9af7`), fonts, and easing.
  - `scenes/intro.ts`: Title card with terminal prompt typing and badge.
  - `scenes/main.ts`: Terminal window + code spotlight highlighting key lines with smooth camera zoom.
  - `scenes/outro.ts`: Summary check card and repo link CTA.
  - `long.ts` & `short.ts`: Compositions chaining the 3 scenes with smooth slide/fade transitions.
  - `script.md`: Script lines with `<!-- vo:intro-1 -->`, `<!-- vo:main-1 -->`, `<!-- vo:outro-1 -->`.

- [ ] **Step 2: Write `product-3d` template files**
  - `theme.ts`: Dark tech palette (`#090d16`, `#111827`, `#38bdf8`, `#818cf8`).
  - `scenes/intro.ts`: Radial glow background, camera push-in to Three.js 3D hero model.
  - `scenes/main.ts`: 3D model spinning with directional lighting + 3 floating feature spec chips.
  - `scenes/outro.ts`: Centered 3D lock, headline, and launch date badge.
  - `long.ts` & `short.ts`: Compositions with zoom/fade transitions.
  - `script.md`: Narrated voice lines matching 3D visual beats.

- [ ] **Step 3: Write `kinetic-short` template files**
  - `theme.ts`: Vibrant high-contrast palette (`#0f0f12`, `#f43f5e`, `#fbbf24`, `#ffffff`).
  - `scenes/intro.ts`: Punchy headline pop (`outBack`) with emoji badge.
  - `scenes/main.ts`: 9:16 mobile frame (`phone()`) displaying demo with kinetic subtitle overlay.
  - `scenes/outro.ts`: Follow / subscribe CTA card with cursor click animation.
  - `short.ts`: Primary 9:16 composition (1080x1920).
  - `long.ts`: Centered mobile layout adapted for 16:9.
  - `script.md`: Short, high-energy narration script.

- [ ] **Step 4: Write `saas-launch` template files**
  - `theme.ts`: Modern SaaS palette (`#0a0a0f`, `#13131f`, `#6366f1`, `#38bdf8`, `#e2e8f0`).
  - `scenes/intro.ts`: Announcement badge pill + gradient title card.
  - `scenes/main.ts`: macOS browser window (`chrome()`) showcasing app UI with metric pop-up chips.
  - `scenes/outro.ts`: Polished CTA banner with "Get Started" button and brand badge.
  - `long.ts` & `short.ts`: Compositions with slide transitions.
  - `script.md`: Clear product marketing narration script.

- [ ] **Step 5: Commit**
  ```bash
  git add apps/desktop/src-tauri/templates/
  git commit -m "feat(templates): add starter files for minimal-dev, product-3d, kinetic-short, and saas-launch"
  ```

---

### Task 3: Backend Rust Scaffolding (`scaffold.rs` & `project.rs`)

**Files:**
- Modify: `apps/desktop/src-tauri/src/scaffold.rs`
- Modify: `apps/desktop/src-tauri/src/project.rs`

**Interfaces:**
- Consumes: Template files from `templates/`
- Produces: `create_project(parent, name, template: Option<String>) -> Result<ProjectInfo, String>`

- [ ] **Step 1: Write failing Rust unit test for template-based scaffolding**
  In `scaffold.rs`, add tests:
  ```rust
  #[test]
  fn creates_project_with_archetype_template() {
      let parent = tempfile::tempdir().unwrap();
      for archetype in ["minimal-dev", "product-3d", "kinetic-short", "saas-launch"] {
          let root = create_project_in(parent.path(), archetype, Some(archetype)).unwrap();
          assert!(root.join("theme.ts").exists());
          assert!(root.join("scenes/intro.ts").exists());
          assert!(root.join("scenes/main.ts").exists());
          assert!(root.join("scenes/outro.ts").exists());
          assert!(root.join("long.ts").exists());
          assert!(root.join("short.ts").exists());
      }
  }

  #[test]
  fn creates_project_with_blank_or_none_template() {
      let parent = tempfile::tempdir().unwrap();
      let root = create_project_in(parent.path(), "my-blank", None).unwrap();
      assert!(root.join("scenes/intro.ts").exists());
      assert!(!root.join("scenes/main.ts").exists()); // blank only has intro.ts
  }
  ```

- [ ] **Step 2: Run test to verify it fails**
  Run: `cargo test -p desktop --lib scaffold::tests`
  Expected: FAIL (`create_project_in` does not take `template` parameter).

- [ ] **Step 3: Implement template bundle registry in `scaffold.rs`**
  - Add `validate_template_id(template: Option<&str>) -> Result<&str>`.
  - Embed files using `include_str!` for each archetype (`blank`, `minimal-dev`, `product-3d`, `kinetic-short`, `saas-launch`).
  - Update `create_project_in(parent: &Path, name: &str, template: Option<&str>) -> Result<PathBuf>`.
  - Update `create_project_with(...)` signature and `populate(...)`.
  - Shared files (`AGENTS.md`, `.gitignore`, `project.json`, `SKILL.md`) written for all templates.

- [ ] **Step 4: Update Tauri command in `project.rs`**
  ```rust
  #[tauri::command]
  pub fn create_project(parent: String, name: String, template: Option<String>) -> Result<ProjectInfo, String> {
      let root = scaffold::create_project_in(Path::new(&parent), &name, template.as_deref())
          .map_err(|e| e.to_string())?;
      open_project(root.to_str().unwrap().to_string())
  }
  ```

- [ ] **Step 5: Run tests and make sure all pass**
  Run: `cargo test -p desktop`
  Expected: PASS (all tests pass, including the new archetype scaffold tests).

- [ ] **Step 6: Commit**
  ```bash
  git add apps/desktop/src-tauri/src/scaffold.rs apps/desktop/src-tauri/src/project.rs
  git commit -m "feat(scaffold): support archetype template bundles in create_project backend"
  ```

---

### Task 4: Desktop UI Template Selector in `ProjectPicker.svelte`

**Files:**
- Modify: `apps/desktop/src/lib/components/ProjectPicker.svelte`
- Test: `apps/desktop/src/lib/components/ProjectPicker.browser.test.ts`

**Interfaces:**
- Consumes: `create_project` command with `{ parent, name, template }`.
- Produces: Visual card grid for selecting template archetypes, with "Blank / Custom" as default.

- [ ] **Step 1: Write failing browser test in `ProjectPicker.browser.test.ts`**
  Add tests:
  - Verify template cards are displayed (`Blank / Custom`, `Minimal Dev Screencast`, `3D Product Showcase`, `Kinetic Short`, `SaaS Feature Launch`).
  - Verify clicking a card selects it (adds active class / aria-pressed).
  - Verify submitting form invokes `create_project` with `{ parent, name, template: "selected-id" }`.
  - Verify default submits with `template: "blank"` without requiring user to touch template cards.

- [ ] **Step 2: Run browser test to verify failure**
  Run: `pnpm --filter desktop test:browser src/lib/components/ProjectPicker.browser.test.ts`
  Expected: FAIL (template cards not found).

- [ ] **Step 3: Implement template selector in `ProjectPicker.svelte`**
  - Define `TEMPLATES`:
    - `id: "blank"`, `title: "Blank / Custom"`, `tag: "16:9 & 9:16"`, `desc: "Clean minimal canvas to build from scratch"`, `icon: Sparkles`
    - `id: "minimal-dev"`, `title: "Minimal Dev Screencast"`, `tag: "16:9"`, `desc: "Terminal & browser window with code spotlights"`, `icon: Terminal`
    - `id: "product-3d"`, `title: "3D Product Showcase"`, `tag: "16:9"`, `desc: "Interactive Three.js 3D hero with floating specs"`, `icon: Box`
    - `id: "kinetic-short"`, `title: "Kinetic Short"`, `tag: "9:16"`, `desc: "Punchy typography & phone mockup for mobile"`, `icon: Smartphone`
    - `id: "saas-launch"`, `title: "SaaS Feature Launch"`, `tag: "16:9"`, `desc: "Modern app window mockup & metric callouts"`, `icon: Rocket`
  - Maintain `selectedTemplate = $state("blank")`.
  - In `create()`:
    ```ts
    await attempt(() => invoke<ProjectInfo>("create_project", { parent, name: name.trim(), template: selectedTemplate }));
    ```
  - Style with aesthetic Tokyo Night cards:
    - Subtle borders (`var(--border)`), active glow border (`var(--primary)`), aspect badge pill, keyboard-accessible button roles.

- [ ] **Step 4: Run browser test to verify it passes**
  Run: `pnpm --filter desktop test:browser src/lib/components/ProjectPicker.browser.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**
  ```bash
  git add apps/desktop/src/lib/components/ProjectPicker.svelte apps/desktop/src/lib/components/ProjectPicker.browser.test.ts
  git commit -m "feat(ui): add optional archetype template selector to ProjectPicker"
  ```

---

### Task 5: End-to-End Verification & Documentation

**Files:**
- Test: Full cargo unit test suite
- Test: Full desktop browser test suite
- Test: Runtime test suite
- Modify: `README.md` or docs if applicable

- [ ] **Step 1: Run Rust unit tests**
  Run: `cargo test` in `apps/desktop/src-tauri`
  Expected: PASS.

- [ ] **Step 2: Run all desktop tests**
  Run: `pnpm --filter desktop test`
  Run: `pnpm --filter desktop test:browser`
  Expected: PASS.

- [ ] **Step 3: Run runtime tests**
  Run: `pnpm --filter @liosvideo/runtime test`
  Expected: PASS.

- [ ] **Step 4: Verify typecheck**
  Run: `pnpm --filter desktop check`
  Expected: 0 errors.

- [ ] **Step 5: Final commit and push**
  ```bash
  git commit -m "chore: verify templates and styles feature integration"
  git push origin main
  ```
