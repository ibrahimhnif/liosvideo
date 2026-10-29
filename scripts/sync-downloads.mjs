#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const START = "<!-- downloads:start -->";
const END = "<!-- downloads:end -->";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const README_PATH = join(ROOT, "README.md");

const repo = process.env.GITHUB_REPOSITORY || "ibrahimhnif/liosvideo";
const tag = process.env.TAG || process.argv[2];
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;

const PLATFORMS = [
  { label: "macOS", extensions: [".dmg"] },
  { label: "Windows", extensions: [".msi", ".exe"] },
  { label: "Linux", extensions: [".AppImage", ".deb", ".rpm"] },
];

function fail(message) {
  console.error(`sync-downloads: ${message}`);
  process.exit(1);
}

function archOf(name) {
  const match = name.match(/universal|x86_64|aarch64|arm64|amd64|x64|i686|i386/i);
  if (!match) return "";
  const arch = match[0].toLowerCase();
  if (arch === "universal") return "Universal";
  if (arch === "x86_64" || arch === "amd64" || arch === "x64") return "x64";
  if (arch === "aarch64" || arch === "arm64") return "arm64";
  return arch;
}

function classify(name) {
  const lower = name.toLowerCase();
  const platform = PLATFORMS.find((entry) =>
    entry.extensions.some((extension) => lower.endsWith(extension.toLowerCase()))
  );
  return platform ? { label: platform.label, arch: archOf(name) } : null;
}

if (!tag) fail("pass a release tag, e.g. `node scripts/sync-downloads.mjs v0.1.0`");

const apiUrl = `https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`;
const headers = { Accept: "application/vnd.github+json", "User-Agent": "liosvideo-sync-downloads" };
if (token) headers.Authorization = `Bearer ${token}`;

const response = await fetch(apiUrl, { headers });
if (!response.ok) fail(`GitHub API ${response.status} for ${apiUrl}: ${await response.text()}`);
const release = await response.json();

const rows = new Map();
for (const asset of release.assets ?? []) {
  const target = classify(asset.name);
  if (!target) continue;
  const key = `${target.label}\0${target.arch}`;
  if (!rows.has(key)) rows.set(key, { ...target, links: [] });
  rows.get(key).links.push(`[${asset.name}](${asset.browser_download_url})`);
}

const platformOrder = new Map(PLATFORMS.map((entry, index) => [entry.label, index]));
const sorted = [...rows.values()].sort((a, b) => {
  const byPlatform = platformOrder.get(a.label) - platformOrder.get(b.label);
  return byPlatform !== 0 ? byPlatform : a.arch.localeCompare(b.arch);
});

const lines = [
  START,
  `Latest release: [\`${release.tag_name}\`](${release.html_url}) · [All releases](https://github.com/${repo}/releases)`,
  "",
];

if (sorted.length === 0) {
  lines.push("_No installers have been published for this release yet._");
} else {
  lines.push("| Platform | Architecture | Installer |", "| :--- | :--- | :--- |");
  for (const row of sorted) {
    lines.push(`| ${row.label} | ${row.arch || "—"} | ${row.links.join(" · ")} |`);
  }
}
lines.push(END);

const block = lines.join("\n");
const readme = await readFile(README_PATH, "utf8");
const startIndex = readme.indexOf(START);
const endIndex = readme.indexOf(END);

if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
  fail(`README.md must contain ${START} and ${END} markers`);
}

const next = `${readme.slice(0, startIndex)}${block}${readme.slice(endIndex + END.length)}`;
if (next === readme) {
  console.log("README.md download links already up to date.");
} else {
  await writeFile(README_PATH, next);
  console.log(`Updated README.md download links for ${release.tag_name}.`);
}
