import { credit, layout, scene, stack } from "liosvideo";
import { archiveBackdrop, line, narrate, reveal, theme } from "../styles/archive-doc";

export default scene("archive-doc", { duration: 5, background: theme.colors.bg }, ({ root, width, height, duration }) => {
  const L = layout({ width, height });

  // swap in an archive photo: pass src (a file in assets/images) to archiveBackdrop
  root.add(archiveBackdrop({ width, height, duration }));

  const kicker = line("kicker", "PROFIL • 1998", L.type.label);
  const head = line("headline", "Krisis Moneter", L.type.display);
  const figure = line("accent", "Rp 16.800", L.type.h1, "figure");
  const detail = line("detail", "per dolar AS, Juni 1998", L.type.body);
  root.add(stack(L.slot("center"), [kicker, head, figure, detail], { name: "story", gap: L.gap(2), align: "center" }));
  reveal(kicker, 0.2);
  reveal(head, 0.5, "pop");
  reveal(figure, 1.3, "pop");
  reveal(detail, 1.9);

  // karaoke captions once the VO exists, e.g. narrate(root, ["hook-1", "hook-2"])
  narrate(root, []);
  credit(root, { source: ["Bank Indonesia", "ANTARA"], lang: "id", at: 0.4 });
});
