import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { readLocalData, writeLocalData } from "./lib-version-utils.mjs";

const tagsPath = process.argv[2];

if (!tagsPath) {
  console.error("Usage: node scripts/maintenance-apply-content-tags.mjs <tags.json>");
  process.exit(1);
}

const payload = JSON.parse(readFileSync(tagsPath, "utf8"));
const tagsById = payload.cards || payload;
const data = readLocalData();
const allowedCategories = [
  "scene",
  "natural element",
  "object",
  "action",
  "relationship",
  "mood",
  "visual style",
  "color",
  "lighting",
  "creature theme",
];
const summary = {
  applied: basename(tagsPath),
  requested: Object.keys(tagsById).length,
  updated: 0,
  updatedCards: 0,
  unchanged: 0,
  skippedMissing: [],
  skippedNonContent: [],
  allowedCategories,
};
const cardsById = new Map();

for (const [, cards] of data.cardsByDex || []) {
  for (const card of cards) {
    const existing = cardsById.get(card.id) || [];
    existing.push(card);
    cardsById.set(card.id, existing);
  }
}

for (const [id, tags] of Object.entries(tagsById)) {
  const cards = cardsById.get(id) || [];
  if (cards.length === 0) {
    summary.skippedMissing.push(id);
    continue;
  }
  const contentCards = cards.filter((card) => card.backgroundType === "content");
  if (contentCards.length === 0) {
    summary.skippedNonContent.push(id);
    continue;
  }

  const normalizedTags = normalizeTags(tags);
  const changedCards = contentCards.filter((card) => JSON.stringify(card.tags || []) !== JSON.stringify(normalizedTags));
  if (changedCards.length === 0) {
    summary.unchanged += 1;
    continue;
  }

  for (const card of changedCards) card.tags = normalizedTags;
  summary.updated += 1;
  summary.updatedCards += changedCards.length;
}

if (summary.updated > 0) writeLocalData(data);
writeFileSync("tmp/content-tags-apply-summary.json", `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));

function normalizeTags(tags) {
  const seen = new Set();
  const normalized = [];
  for (const tag of tags || []) {
    const value = String(tag || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
    if (!value || seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
  }
  return normalized.slice(0, 14);
}
