# Archive Documentary

Dimmed archive photos with film grain and a vignette, a mono kicker, a big serif headline, karaoke captions and a source credit: the look of the EP1/EP2 and Nayib Bukele videos.

## Look
- Every scene starts with `archiveBackdrop({ width, height, duration, src })`: the photo cover-fit with a slow 8% push-in, a dark grade (`dim`, 0.78 with a photo), moving grain and a vignette. Without `src` it draws a stained-paper texture so the scene previews before you have a photo.
- Type sits in `layout()` slots: amber mono kicker, ink serif headline, red serif for the one number or word that matters, a sans detail line.
- Captions are the official `captions` (via `narrate`), credits the official `credit`. No progress bar, ever.

## Palette
Background `#080a0e`, ink `#f4efe6`, amber `#f2b33d`, red `#e5383b`, dim `#8c93a1`.

## Motion
- Kicker fades in first, the headline pops (`reveal(node, at, "pop")`, 92% → 100% with `outBack`), then the figure, then the detail, ~0.4–0.8 s apart.
- The backdrop pushes in for the whole scene; nothing else moves.

## Helpers (`styles/archive-doc.ts`)
- `archiveBackdrop({ width, height, duration, src?, dim?, grain? })`; `grain()`, `vignette()`, `paper()` on their own
- `line("kicker" | "headline" | "accent" | "detail", text, L.type.*)` — styled text nodes for `stack`
- `reveal(node, at, "pop" | "rise")`
- `narrate(root, ["vo-1", "vo-2"])` — karaoke captions once the VO exists (returns false until then)

## Do / Don't
- Do credit every photo: `credit(root, { asset: "assets/images/<photo>.jpg", lang: "id" })` reads `assets/ATTRIBUTIONS.md`.
- Do use real archive photos (`commons_search` / `commons_download`); label AI reconstructions "Ilustrasi".
- Don't add a progress bar or timeline: the platforms draw their own.
- Don't put text in the caption slot while captions are on.
