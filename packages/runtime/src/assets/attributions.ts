// Rows of the project's assets/ATTRIBUTIONS.md, injected by the host (CLI and desktop) before
// the composition is evaluated, so scene code can credit an asset exactly as it is recorded.

export interface Attribution {
  asset: string;
  source: string;
  author: string;
  license: string;
  notes: string;
}

type Field = keyof Attribution;

// header words (English and Indonesian) -> field; checked in order, first match wins
const HEADERS: [Field, RegExp][] = [
  ["asset", /^(asset|aset|file|berkas|path)\b/i],
  ["license", /(licen[cs]e|lisensi)/i],
  ["author", /(author|creator|pembuat|kreator|fotografer|photographer|credit)/i],
  ["source", /(source|sumber|url|link)/i],
  ["notes", /(notes?|usage|scene|catatan|pemakaian|adegan)/i],
];
const STANDARD: Field[] = ["asset", "source", "author", "license", "notes"];

let rows = new Map<string, Attribution>();
let byName = new Map<string, Attribution>();

const normalise = (path: string) => path.trim().replace(/^`|`$/g, "").trim().replace(/^\.?\//, "");
const basename = (path: string) => path.split("/").pop() ?? path;
const cellsOf = (line: string) => line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

/**
 * Parses the attribution table(s). Columns are matched by header name (Asset/File, Source/Sumber,
 * Author/Creator, License/Lisensi, Notes/Scene), falling back to the standard order.
 */
export function registerAttributions(markdown: string): void {
  rows = new Map();
  byName = new Map();
  let columns: (Field | undefined)[] = STANDARD;
  for (const line of (markdown ?? "").split("\n")) {
    if (!line.trim().startsWith("|")) continue;
    const cells = cellsOf(line);
    if (cells.every((c) => /^:?-*:?$/.test(c))) continue; // separator row
    const header = cells.map((c) => HEADERS.find(([, re]) => re.test(c))?.[0]);
    if (header[0] === "asset" && !cells[0].includes(".")) {
      columns = header; // a header row: remember which column is which
      continue;
    }
    const row: Attribution = { asset: "", source: "", author: "", license: "", notes: "" };
    cells.forEach((c, i) => {
      const field = columns[i];
      if (field && !row[field]) row[field] = field === "asset" ? normalise(c) : c;
    });
    if (!row.asset) continue;
    rows.set(row.asset, row);
    if (!byName.has(basename(row.asset))) byName.set(basename(row.asset), row);
  }
}

/** The attribution row for a project asset path (or a row listing just its file name). */
export function attribution(asset: string): Attribution | undefined {
  const hosted = (globalThis as { __liosAttributions?: string }).__liosAttributions;
  if (!rows.size && hosted) registerAttributions(hosted);
  const path = normalise(asset);
  return rows.get(path) ?? byName.get(basename(path));
}

/**
 * The recorded file `<dir>/<stem>.<any extension>`, for names that leave the extension out
 * (`sfx: "whoosh"` finds an `assets/audio/sfx/whoosh.mp3` downloaded with its row). A `.wav`
 * wins when several are recorded.
 */
export function attributedFile(dir: string, stem: string): string | undefined {
  const hosted = (globalThis as { __liosAttributions?: string }).__liosAttributions;
  if (!rows.size && hosted) registerAttributions(hosted);
  const prefix = `${normalise(dir).replace(/\/$/, "")}/${stem}.`;
  const found = [...rows.keys()].filter((path) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"));
  return found.find((path) => path.endsWith(".wav")) ?? found[0];
}
