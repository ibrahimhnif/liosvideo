# Example scenes — satu scene per efek

Semua scene berdiri sendiri (3 detik) dan bisa dirender langsung:

```bash
./target/release/liosvideo render examples/fx-lab/scenes/examples/typewriter.ts -o out/typewriter.mp4
```

Dua reel siap pakai:

| Komposisi | Isi | Durasi |
| :--- | :--- | :--- |
| `fx-examples.ts` | 12 scene volume 1 | 36 s |
| `fx-examples-vol2.ts` | 10 scene volume 2 | 30 s |

---

## Volume 1 — `fx-examples.ts`

| # | Scene (file) | Efek | Komponen | SFX |
| :--- | :--- | :--- | :--- | :--- |
| 01 | `film-grain.ts` | Judul arsip di atas b-roll koran | `image`, `grainOverlay`, `scanlines`, `dustMotes`, `vignette` | `cameraShutter` |
| 02 | `paper-tear.ts` | Kertas robek membuka kata "FAKTA" | `tornPaper` | `paperTear` |
| 03 | `typewriter.ts` | Ketik per karakter + stabilo | `typewriter`, `highlighter` | `typewriterRun` |
| 04 | `kinetic-caption.ts` | Tiga kata menyala di beat | `kineticWord` | `pop` ×3 |
| 05 | `crash-zoom.ts` | Punch-in ke foto cycling + getaran | `crashZoom`, `shake` | `whooshDeep`, `impactThud` |
| 06 | `whip-pan.ts` | Sapuan SHOT A → SHOT B | keyframe `to` + streaks | `whooshFast` ×2 |
| 07 | `glitch-rgb.ts` | Sinyal rusak + scanline | `glitchRGB`, `scanlines` | `glitch` |
| 08 | `letterbox.ts` | Bar 2.39:1 di atas foto gunung | `letterbox`, `lightLeak` | `softSwoosh` |
| 09 | `count-up.ts` | Angka naik + badge + progress | `countUp`, `pillBadge`, `progressBar` | `kaching`, `bell` |
| 10 | `impact-burst.ts` | Garis radial + ring + stempel "BUKTI" | `speedLines`, `stampText` | `riser`, `impactSub` |
| 11 | `lower-third.ts` | Nama + peran + ticker | `lowerThird`, `ticker`, `chip` | `tick` |
| 12 | `spotlight.ts` | Sorot lampu di rak buku | `lightPool`, `spotlight`, `dustMotes` | `heartbeat` |

### Alur tiap scene

**01 · Film Grain** — foto arsip full-frame, grade gelap, grain 24 fps,
scanline tipis, debu. Kicker dan judul serif naik pelan, garis amber tumbuh.

**02 · Paper Tear** — `tornPaper` menyapu dari kiri ke kanan; "FAKTA" muncul
setelah area gelap terbuka, disusul "BUKAN OPINI".

**03 · Typewriter** — satu baris mono diketik 1,25 s; stabilo muncul setelah
teks selesai; kursor berkedip empat kali.

**04 · Kinetic Caption** — tiga kata di posisi tetap, masing-masing pop 0,42 s
berurutan; garis beat memanjang di bawah.

**05 · Crash Zoom** — grup foto di-zoom 1,0 → 1,28 dalam 0,28 s, lalu shake
0,42 s; flash putih 0,16 dan label "1.28×".

**06 · Whip Pan** — dua panel full-frame bergeser berlawanan dua kali; tujuh
streak amber berkedip di sapuan pertama.

**07 · Glitch** — shader RGB split dengan baris jitter; teks "TRANSMISI
TERPUTUS" ikut bergetar sebelum diam.

**08 · Letterbox** — foto gunung + grade; bar hitam masuk 0,6 s, light leak
hangat, judul serif, label rasio 2.39:1.

**09 · Count-Up** — 0 → 128 dalam 1,4 s, badge "+312%" pop, progress 78%.

**10 · Impact Burst** — riser menuju hentakan: garis radial, ring kejut,
flash, dan "BUKTI" distempel miring.

**11 · Lower Third** — kartu nama masuk dari kiri (di-scale 2,3× untuk 1080p),
ticker berjalan, chip "LIVE" di kanan atas.

**12 · Spotlight** — kolam cahaya hangat + overlay gelap yang bergerak pelan;
debu melayang di dalam sorot.

---

## Volume 2 — `fx-examples-vol2.ts`

| # | Scene (file) | Efek | Komponen | SFX |
| :--- | :--- | :--- | :--- | :--- |
| 13 | `karaoke-caption.ts` | Subtitle karaoke 5 kata | `karaokeCaption` | `pop` ×5 |
| 14 | `versus-split.ts` | Duel LARI vs SEPEDA + skor | `versusSplit` | `bellRound` |
| 15 | `confetti.ts` | "1 JUTA" + konfeti | `confetti`, `pillBadge` | `kaching`, `bell` |
| 16 | `quote-card.ts` | Kutipan serif di atas rak buku | `quoteCard` | `paperTear` |
| 17 | `chapter-card.ts` | BAB 02 + progress dots | `chapterCard` | `tick` |
| 18 | `polaroid-frame.ts` | Tiga polaroid + halftone | `polaroidFrame`, `halftone` | `cameraShutter` ×3 |
| 19 | `breaking-banner.ts` | Banner merah + skyline Jakarta | `breakingBanner` | `impactThud`, `tick` |
| 20 | `bar-chart.ts` | Bar chart 2020–2024 | `barChart` | `pop` ×5 |
| 21 | `waveform.ts` | Equalizer podcast | `waveform` | `heartbeat` ×2 |
| 22 | `annotation.ts` | Lingkaran + panah ke jam 10:29 | `annotationCircle`, `arrowPointer` | `uiClick` ×2 |

### Alur tiap scene

**13 · Karaoke Caption** — lima kata, tiap kata aktif 0,3–0,45 s; yang aktif
berwarna amber dan membesar 1,08×.

**14 · Versus Split** — dua lane dengan foto, divider putih, badge VS pop;
skor berhitung 0 → 42 / 58.

**15 · Confetti** — 64 serpihan seeded jatuh 2,2 s; judul Bebas Neue 220 px,
badge "TERIMA KASIH".

**16 · Quote Card** — dua baris Playfair, tanda kutip amber, garis 180 px,
atribusi mono di atas foto rak buku yang di-grade.

**17 · Chapter Card** — nomor 02 besar, "/ 05", kicker, judul, garis, lima dot
dengan dot aktif berwarna amber.

**18 · Polaroid Collage** — tiga kartu miring dengan satu lakban putih; foto
cycling, smartphone, dan koran; overlay halftone di latar.

**19 · Breaking Banner** — banner merah masuk dari atas, dot berkedip, judul
"Krisis Air Tanah" di atas skyline Jakarta.

**20 · Bar Chart** — lima bar tumbuh berurutan, label tahun di bawah, nilai di
atas bar, bar terakhir amber.

**21 · Waveform** — 44 bar equalizer, tinggi berubah tiap 0,13 s (seeded),
judul serif + meta episode.

**22 · Annotation** — foto makro smartphone; lingkaran tangan menyapu mengelilingi
jam, panah tumbuh dari label "TAMPILAN UTAMA".
