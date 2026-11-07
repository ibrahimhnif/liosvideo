# Blueprint: Documentation / Course (15–60 min)

- **Target Aspect**: 16:9 Landscape (`1920x1080`); cut 9:16 clips only from short sections
- **Target Length**: **15–60 min** (30 min is a normal documentation episode), 8–15 chapters
- **Layout**: every gap on the rhythm unit `u = Math.min(width, height) / 100`, safe margin `u * 6`
- **Pacing**: one beat per scene (8–20 s), a visible change every 4–8 s, a chapter card every 1–4 min

Long-form is built from chapters. Do not write a 30-minute scene, and do not stop at the
3-scene / 12-second scaffold.

---

## 1. Chapter plan (30 min example)

```text
00:00–00:35  cold open        what the viewer gets, 3 fast frames
00:35–01:20  chapter card 1   "Setup" + one-line goal + 3 beats
01:20–04:30  chapter 1 body   install → new project → first render
04:30–05:20  chapter card 2   "Scenes" + goal
05:20–09:50  chapter 2 body   6 beats: text, shapes, media, groups, animation, preview
   …
28:40–29:30  recap            one line per chapter
29:30–30:00  outro / CTA
```

Sizing rule: `30 min ≈ 4,300 narration words ≈ 120–180 lines ≈ 90–150 scenes`.
Write the beat list for one chapter, build it, preview it, then move on.

---

## 2. Files

```text
long.ts                    # spreads the chapters
scenes/ch01-setup.ts       # export const ch01 = [card, ...beats]
scenes/ch02-scenes.ts
scenes/parts.ts            # chapterCard(), caption(), codePane()
script.md                  # one <!-- vo:id --> per beat
```

```ts
// long.ts
import { composition } from "liosvideo";
import { ch01 } from "./scenes/ch01-setup";
import { ch02 } from "./scenes/ch02-scenes";
import { outro } from "./scenes/outro";

export default composition({
  width: 1920,
  height: 1080,
  fps: 30,
  background: "#0b0d12",
  scenes: [...ch01, ...ch02, outro],
});
```

Scene ids must stay stable (`ch02-03-groups`) so re-renders reuse caches and the timeline
selection keeps pointing at the same beat.

---

## 3. Chapter card (`scenes/parts.ts`)

```ts
import { scene, text } from "liosvideo";

export const chapterCard = (n: number, total: number, title: string, goal: string) =>
  scene(`ch${n}-00-card`, { duration: 3.5, background: "#0b0d12" }, ({ root, width, height }) => {
    const u = Math.min(width, height) / 100;
    const safe = u * 6;

    root.add(text({
      name: "kicker", text: `CHAPTER ${n} / ${total}`,
      x: safe, y: safe, fontSize: u * 2.4, fontWeight: 600, color: "#7aa2f7",
    }));

    root.add(text({
      name: "title", text: title,
      x: safe, y: height * 0.38, fontSize: u * 7, fontWeight: 800, lineHeight: 1.12, color: "#f0f6fc",
    }));

    root.add(text({
      name: "goal", text: goal,
      x: safe, y: height * 0.38 + u * 11, fontSize: u * 3, lineHeight: 1.45, color: "#8b949e",
    }));
  });
```

No progress bar: every platform (YouTube, TikTok, Facebook) shows its own. The `CHAPTER n / total` kicker is enough.

---

## 4. A beat scene (code + caption + VO sync)

```ts
import { rect, scene, text, vo } from "liosvideo";

const timing = vo("ch01-02-install");

export const installBeat = scene(
  "ch01-02-install",
  { duration: Math.max(2.5, timing.duration + 0.6), background: "#0b0d12" },
  ({ root, width, height }) => {
    const u = Math.min(width, height) / 100;
    const safe = u * 6;

    const pane = root.add(rect({
      name: "code-pane", x: safe, y: height * 0.2, width: width - safe * 2, height: height * 0.48,
      radius: u, fill: "#161b22", stroke: "#30363d", strokeWidth: 2, opacity: 0,
    }));
    pane.to({ opacity: 1, y: height * 0.18 }, { at: 0.2, duration: 0.5, ease: "outCubic" });

    pane.add(text({
      name: "code",
      text: "$ pnpm dlx liosvideo project new docs\n$ cd docs && liosvideo dev",
      fontFamily: "JetBrains Mono", fontSize: u * 2.4, lineHeight: 1.7, color: "#c9d1d9",
      x: u * 3, y: u * 3,
    }));

    const caption = root.add(text({
      name: "caption", text: "Create the project once,\nthen render any chapter.",
      x: safe, y: height * 0.8, fontSize: u * 3.2, lineHeight: 1.4, color: "#8b949e", opacity: 0,
    }));
    caption.to({ opacity: 1 }, { at: 0.6, duration: 0.5 });

    if (timing.isReady) {
      const at = timing.wordTime("chapter");
      if (at !== undefined) caption.to({ color: "#f0f6fc" }, { at, duration: 0.25 });
    }
  },
);
```

`vo()` timings are loaded before the composition module is evaluated, so this works at
module scope. A line without audio (before TTS) falls back to `2.5 s` — generate the VO,
then re-render so the scene picks up the real length.

---

## 5. Render chapter ranges, then concat

```bash
# Plan and verify the total (e.g. 1800.0s / 54000 frames)
liosvideo info long.ts

# Per chapter (3 min = 5400 frames at 30 fps)
liosvideo render long.ts --frames 0..5400     -o out/ch01.mp4 --quiet
liosvideo render long.ts --frames 5400..10800 -o out/ch02.mp4 --quiet

# Concatenate (same codec/params, so stream copy is safe)
printf "file 'ch01.mp4'\nfile 'ch02.mp4'\n" > out/list.txt
ffmpeg -f concat -safe 0 -i out/list.txt -c copy out/doc.mp4
```

- End chapters on a hard cut: transitions do not survive a concat.
- A full 30-minute render holds the audio mixdown in memory (≈2 GB peak) — render ranges on
  low-RAM machines, and keep the music bed looped instead of a 30-minute file.
- Persona check before each range: `snapshot --frame <first>`, a mid-chapter frame and
  `--frame <last>`.

---

## 6. Long-form checklist

- [ ] Target length chosen and written down (15 / 30 / 60 min).
- [ ] Chapter plan with times; every chapter has a card and 5–12 beats.
- [ ] `script.md` sized to the target (~2.4 words/s) with one id per beat.
- [ ] Scene durations derived from `vo().duration` (+0.6 s tail, min 2.5 s).
- [ ] Motion density lower than short-form; no filter stack on every scene.
- [ ] Safe area respected; text lines broken manually.
- [ ] `liosvideo info` total matches the target; first / middle / last frame verified.
- [ ] Rendered in ranges and concatenated; audio present at the seams.
