import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { getCardImageFsPath, getCardImagePath } from "./lib-card-image-paths.mjs";
import { readLocalData, writeLocalData } from "./lib-version-utils.mjs";

const CARD_DIR = "assets/cards";
const TMP_DIR = "tmp/maintenance-normalize-card-image-files";
const SUMMARY_PATH = `${TMP_DIR}/summary.json`;

mkdirSync(TMP_DIR, { recursive: true });

const data = readLocalData();
const uniqueByImage = new Map();
const collisions = new Map();

for (const [, cards] of data.cardsByDex || []) {
  for (const card of cards) {
    const targetPath = getCardImageFsPath(card);
    const key = targetPath.toLowerCase();
    const previous = uniqueByImage.get(key);
    if (previous && previous.id !== card.id) {
      collisions.set(key, [...(collisions.get(key) || [previous.id]), card.id]);
      continue;
    }
    uniqueByImage.set(key, { id: card.id, sourcePath: stripLocalPrefix(card.image), targetPath });
  }
}

if (collisions.size) {
  const summary = {
    status: "failed",
    reason: "Normalized image filename collision",
    collisions: Array.from(collisions.entries()).map(([path, ids]) => ({ path, ids: Array.from(new Set(ids)) })),
  };
  writeFileSync(SUMMARY_PATH, JSON.stringify(summary, null, 2));
  console.error(JSON.stringify(summary, null, 2));
  process.exit(1);
}

const referencedFiles = new Set();
const renamed = [];
const missing = [];

for (const [, item] of uniqueByImage) {
  referencedFiles.add(basename(item.targetPath));
  if (item.sourcePath === item.targetPath) {
    if (!existsSync(item.targetPath)) {
      missing.push({ id: item.id, source: item.sourcePath, target: item.targetPath });
    }
    continue;
  }
  if (!existsSync(item.sourcePath) && existsSync(item.targetPath)) continue;
  if (!existsSync(item.sourcePath)) {
    missing.push({ id: item.id, source: item.sourcePath, target: item.targetPath });
    continue;
  }
  if (existsSync(item.targetPath)) rmSync(item.targetPath, { force: true });
  renameSync(item.sourcePath, item.targetPath);
  renamed.push({ id: item.id, from: item.sourcePath, to: item.targetPath });
}

for (const [, cards] of data.cardsByDex || []) {
  for (const card of cards) card.image = getCardImagePath(card);
}

const removed = [];
for (const name of readdirSync(CARD_DIR)) {
  if (!name.endsWith(".webp")) continue;
  if (referencedFiles.has(name)) continue;
  const path = `${CARD_DIR}/${name}`;
  rmSync(path, { force: true });
  removed.push(path);
}

const version = writeLocalData(data);
const summary = {
  status: "ok",
  version,
  referenced: referencedFiles.size,
  renamed: renamed.length,
  removed: removed.length,
  missing: missing.length,
  renamedItems: renamed,
  removedItems: removed,
  missingItems: missing,
};

writeFileSync(SUMMARY_PATH, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));

function stripLocalPrefix(value) {
  return String(value || "").replace(/^\.\//, "");
}
