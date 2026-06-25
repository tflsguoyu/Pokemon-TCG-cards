import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

const reviewPath = process.argv[2];

if (!reviewPath) {
  console.error("Usage: node scripts/apply-review-results.mjs <ptcg-review-YYYY-MM-DD.json>");
  process.exit(1);
}

const review = readJson(reviewPath);
const localStats = applyToLocalData(review);

console.log(
  JSON.stringify(
    {
      applied: basename(reviewPath),
      review: {
        contentIds: review.contentIds?.length || 0,
        simpleIds: review.simpleIds?.length || 0,
        otherIds: review.otherIds?.length || 0,
        deleteIds: review.deleteIds?.length || 0,
      },
      localData: localStats,
    },
    null,
    2
  )
);

function applyToLocalData(decisions) {
  const contentIds = new Set(decisions.contentIds || []);
  const simpleIds = new Set(decisions.simpleIds || []);
  const otherIds = new Set(decisions.otherIds || []);
  const deleteIds = new Set(decisions.deleteIds || []);
  const prefix = "window.PTCG_LOCAL_DATA = ";
  const path = "local-data.js";
  const data = JSON.parse(readFileSync(path, "utf8").slice(prefix.length).replace(/;\s*$/, ""));
  const removedImages = new Set();
  const stats = {
    changedContent: 0,
    changedSimple: 0,
    changedOther: 0,
    removedCards: 0,
    deletedImages: 0,
    dexWithCards: 0,
  };

  data.cardsByDex = data.cardsByDex
    .map(([dex, cards]) => {
      const kept = [];
      for (const card of cards) {
        if (deleteIds.has(card.id)) {
          stats.removedCards += 1;
          for (const url of [card.image, card.fallbackImage, card.highImage, card.highFallbackImage]) {
            if (String(url || "").startsWith("./assets/cards/")) {
              removedImages.add(String(url).replace(/^\.\//, ""));
            }
          }
          continue;
        }

        if (contentIds.has(card.id) && card.backgroundType !== "content") {
          card.backgroundType = "content";
          stats.changedContent += 1;
        } else if (simpleIds.has(card.id) && card.backgroundType !== "simple") {
          card.backgroundType = "simple";
          stats.changedSimple += 1;
        } else if (otherIds.has(card.id) && card.backgroundType !== "other") {
          card.backgroundType = "other";
          stats.changedOther += 1;
        }
        kept.push(card);
      }
      return [dex, kept];
    })
    .filter(([, cards]) => cards.length > 0);

  writeFileSync(path, `${prefix}${JSON.stringify(data)};\n`);

  for (const imagePath of removedImages) {
    try {
      unlinkSync(imagePath);
      stats.deletedImages += 1;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  stats.dexWithCards = data.cardsByDex.length;
  return stats;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
