---
name: fx-kit
description: Reusable cinematic FX kit for liosvideo compositions (Indonesian creator style) — grain, paper tear, typewriter, karaoke captions, versus split, polaroid collage, charts, annotations, transitions and synthesized SFX. Use whenever adding effects, motion, typography or sound design to a liosvideo project, so you do not need to re-read the codebase.
---

# liosvideo FX Kit

A deterministic, code-first effect library modelled on Indonesian creator edits
(Ferry Irwandi / Tim Malaka, Agung Hapsah, Aulion, GadgetIn, urban sport).

Use this skill to add effects **without re-exploring the repo**. Read
`references/api.md` only when you need full prop tables, and
`references/recipes.md` for copy-paste scene patterns.

---

## 0. Install into a project

Kit lives at `examples/fx-lab/` in the liosvideo repo. To use it elsewhere:

```bash
cp -R examples/fx-lab/fx            <project>/fx
cp -R examples/fx-lab/assets/audio  <project>/assets/audio
cp -R examples/fx-lab/assets/fonts  <project>/assets/fonts
cp -R examples/fx-lab/assets/images <project>/assets/images   # optional b-roll
```

Install the four font families once (the headless CLI only sees system fonts):

```bash
cp <project>/assets/fonts/*.ttf ~/Library/Fonts/     # macOS
```

Fonts: **Playfair Display** (serif), **IBM Plex Mono** (mono), **Inter** (sans),
**Bebas Neue** (display) — all OFL.

Import from a scene at `<project>/scenes/x.ts`:

```ts
import { palette, fonts, typewriter, soundtrack } from "../fx";
```

---

## 1. The 22 effects at a glance

| id | Component(s) | Use for |
| :--- | :--- | :--- |
| `film-grain` | `filmGrain` / `grainOverlay` + `vignette` | archival mood |
| `paper-tear` | `tornPaper` | reveal / archive |
| `typewriter` | `typewriter` + `highlighter` | data / essay quotes |
| `kinetic-caption` | `kineticWord` | beat-locked words |
| `crash-zoom` | `crashZoom` + `shake` | punch-in emphasis |
| `whip-pan` | `whipPan` (transition) | fast scene change |
| `glitch-rgb` | `glitchRGB` + `scanlines` | broken signal |
| `letterbox` | `letterbox` + `lightLeak` | cinematic frame |
| `count-up` | `countUp` + `pillBadge` | metrics / specs |
| `impact-burst` | `speedLines` + `stampText` | hard punctuation |
| `lower-third` | `lowerThird` + `ticker` | names / sources |
| `spotlight` | `lightPool` + `spotlight` | focus |
| `karaoke-caption` | `karaokeCaption` | Reels/Shorts subtitles |
| `versus-split` | `versusSplit` | A vs B comparison |
| `confetti` | `confetti` | milestones |
| `quote-card` | `quoteCard` | editorial quote |
| `chapter-card` | `chapterCard` | essay chapters |
| `polaroid-frame` | `polaroidFrame` + `halftone` | collage |
| `breaking-banner` | `breakingBanner` | news / reaction |
| `bar-chart` | `barChart` | data story |
| `waveform` | `waveform` | podcast / music |
| `annotation` | `annotationCircle` + `arrowPointer` | reviews / teaching |

Full metadata (archetype, blurb, SFX, volume) lives in `fx/catalog.ts`:
`FX_CATALOG`, `FX_IDS`, `fxById(id)`.

---

## 2. Core API (one line each)

**Theme**
`palette.{bg,panel,panelDeep,border,borderSoft,text,muted,dim,cyan,amber,rose,emerald,violet}`
`fonts.{serif,mono,sans,display}` · `archetypes.{malaka,agung,aulion,gadgetin,urban}`
`rgb("#38BDF8") -> [r,g,b]`

**Motion** (all take `{ at, duration, ease }`)
`popIn` · `fadeIn` · `slideIn({from:"left"})` · `crashZoom({from,to})` ·
`shake({intensity})` · `pulse({times,scale})` · `floatLoop({distance,cycles})` ·
`breathe({amount})` · `stagger(count, at, step)`

**Overlays**
`filmGrain({width,height,amount,at})` · `grainOverlay(...)` ·
`vignette({strength})` · `scanlines({pitch,strength,at})` ·
`tornPaper({accent,speed,at})` · `glitchRGB({amount,at})` ·
`lightLeak({color,strength,at})` · `halftone({size,strength,color,at})` ·
`letterbox({width,height,ratio,at}) -> {top,bottom}` ·
`dustMotes({count,seed,duration,at})`

**Camera**
`spotlight({center,radius,drift,strength,at})` ·
`lightPool({color,center,radius,drift,strength,at})` ·
`speedLines({color,count,strength,at})`

**Typography**
`typewriter({text,x,y,fontSize,at,duration,cursor}) -> {group,cursor,width,text}` ·
`highlighter({textNode,at,color,opacity,padding})` — auto-fits the text ·
`measureText(node) -> {width,height}` ·
`kineticWord({word,x,y,at,size,accent})` ·
`countUp({from,to,x,y,at,duration,size,prefix,suffix})` ·
`lowerThird({name,role,x,y,width,at,accent})` ·
`ticker({text,x,y,width,at,speed,startX})` · `stampText(node,{at,from,rotation})`

**Graphics**
`pillBadge({label,x,y,at,color,bg})` · `chip({label,x,y,at,color,size})` ·
`progressBar({x,y,width,at,progress,color})` ·
`callout({x,y,tx,ty,label,at,color})` ·
`frameBrackets({x,y,width,height,color,at})`

**Transitions** (pass as `scene(..., { transition })`)
`whipPan("left"|"right"|"up"|"down", duration)` · `crashZoomIn(duration)` ·
`glitchCut(duration)` · `tearWipe(duration)`

**Social**
`karaokeCaption({words:[{text,start,end}],x,y,size,activeColor,dimColor,at})` ·
`versusSplit({width,height,top,bottom,axis,at})` with side `{label,sub,score,color,imageSrc}` ·
`confetti({width,height,count,at,duration,seed})`

**Editorial**
`quoteCard({lines,author,role,x,y,size,accent,at})` ·
`chapterCard({index,total,kicker,title,x,y,at,accent})` ·
`polaroidFrame({width,height,x,y,at,rotation,caption,imageSrc})` —
one white tape strip ·
`breakingBanner({width,y,headline,at,color})`

**Data / Annotation**
`barChart({x,y,width,height,values:[{label,value}],at,color,highlightColor})` ·
`waveform({x,y,width,height,bars,at,step,color,seed})` ·
`annotationCircle({x,y,width,height,at,duration,color,thickness})` ·
`arrowPointer({from:{x,y},to:{x,y},at,duration,color,thickness,headLength})`

**Audio**
`SFX.{whooshFast,whooshDeep,impactThud,impactSub,pop,uiClick,bell,bellRound,typewriterRun,paperTear,cameraShutter,glitch,riser,heartbeat,kaching,braam,stamp,tapeStop,softSwoosh,tick,tock}`
`soundtrack(cues, { bed:true, bedVolume:0.09 })` → `AudioTrack[]`

---

## 3. Non-negotiable rules

1. **Initial state at `t = 0`.** Values before the first keyframe are the node's
   base props, so `node.set(x, at)` leaves it visible until `at`. Use
   `node.set(initial, 0)` then `node.to(target, { at })`.
2. **Scene times are local.** `at`, `start`, `end` are seconds inside the scene.
   For a composition-level SFX cue, add the scene offset yourself.
3. **Deterministic only.** Never `Math.random()`, `Date.now()`,
   `performance.now()`. Use `seededRandom("seed")` or the scene `random()`.
4. **Shader contract.** Define only `@fragment fn fs(@location(0) uv: vec2f)`.
   Use `u_globals.time.x`, `u_globals.resolution.xy`, and `u.<key>.x`.
   The shader **must reference both `u_globals` and `u`** (wgpu drops unused
   bindings and the bind group then mismatches).
5. **`active` is a reserved WGSL keyword.** Name it `isOn`.
6. **Overlay shaders output premultiplied alpha:** `vec4f(rgb * a, a)`.
7. **`clip: true` costs a full-canvas layer per frame.** Use only when content
   can leave its box (whip pan, typewriter, full-bleed shaders).
8. **Text width is measured automatically** (CLI + desktop install a measurer).
   `typewriter`, `highlighter({textNode})`, `karaokeCaption`, `ticker` and
   `pillBadge` use real glyph widths; estimates are only a fallback.
9. **Fonts:** the CLI uses system fonts. Project TTFs in `assets/fonts` are a
   copy; they must be installed in `~/Library/Fonts` to render.
10. **Naming:** semantic `name` on nodes, no `/` inside names.

---

## 4. Minimal scene

```ts
import { rect, scene, text } from "liosvideo";
import { fadeIn, fonts, palette, vignette } from "../fx";

export default scene("intro", { duration: 3, background: palette.bg }, ({ root, width, height }) => {
  root.add(rect({ name: "bg", width, height, fill: palette.bg }));

  const title = root.add(
    text({
      name: "title",
      text: "Kebenaran yang Tertunda",
      x: 160,
      y: 360,
      fontFamily: fonts.serif,
      fontSize: 84,
      fontWeight: 700,
      color: "#EFE6D2",
      opacity: 0,
    }),
  );
  fadeIn(title, { at: 0.4, duration: 0.6 });

  vignette(root, { width, height, strength: 0.85 });
});
```

Recipes for paper-tear title, photo letterbox, karaoke captions, versus duel,
polaroid collage, chart scenes and the tile page are in
`references/recipes.md`.

---

## 5. Adding a new effect (checklist)

1. Add the component to the matching `fx/*.ts` module (pure keyframes).
2. Export it from `fx/index.ts`.
3. Add an `FX_CATALOG` entry (`volume: 2`, category, archetype, sfx).
4. Add `scenes/examples/<id>.ts` (3 seconds).
5. Cue an SFX in the reel composition.
6. Update `docs/components.md` + this skill's quick table.

Run `tsc -p <project>/tsconfig.json --noEmit` and one
`liosvideo snapshot <entry> --frame 45` before rendering.
