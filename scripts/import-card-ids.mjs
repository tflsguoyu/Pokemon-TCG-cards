import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { writeLocalData } from "./version-utils.mjs";

const DATA_PATH = "local-data.js";
const DATA_PREFIX = "window.PTCG_LOCAL_DATA = ";
const CARD_DIR = "assets/cards";
const TMP_DIR = "tmp/import-card-ids";
const IMAGE_HEIGHT = 825;
const SCRYDEX_CARD_BACK_HASHES = new Set([
  "fd7c3800f9b8ebadcf7c3dd1908934be336a5b9d00d06f581171e9086f5e3a8e",
  "fd7c3800f9b8ebadf4b31a735f569a180e66201741b00fafa17879967884ad2c",
]);

const ids = process.argv.slice(2);
if (ids.length === 0) {
  console.error("Usage: node scripts/import-card-ids.mjs <card-id> [card-id...]");
  process.exit(1);
}

mkdirSync(TMP_DIR, { recursive: true });
mkdirSync(CARD_DIR, { recursive: true });

const data = JSON.parse(readFileSync(DATA_PATH, "utf8").slice(DATA_PREFIX.length).replace(/;\s*$/, ""));
const cardsById = new Map();
for (const [, cards] of data.cardsByDex || []) {
  for (const card of cards) cardsById.set(card.id, card);
}

const summary = {
  requested: ids.length,
  added: 0,
  alreadyPresent: 0,
  downloadedImages: 0,
  skippedNonPokemon: [],
  skippedMissingDex: [],
  failed: [],
};

for (const id of ids) {
  try {
    const card = getTcgdexCard(id);
    if (card.category !== "Pokemon") {
      summary.skippedNonPokemon.push({ id: card.id, name: card.name || "", category: card.category || "" });
      continue;
    }
    if (!Array.isArray(card.dexId) || card.dexId.length === 0) {
      summary.skippedMissingDex.push({ id: card.id, name: card.name || "" });
      continue;
    }

    const imageCandidates = getImageCandidates(card);
    let selectedImage = imageCandidates[0];
    if (!existsSync(`${CARD_DIR}/${card.id}.webp`)) {
      selectedImage = downloadProjectImage(card.id, imageCandidates);
      summary.downloadedImages += 1;
    }

    if (cardsById.has(card.id)) {
      summary.alreadyPresent += 1;
      continue;
    }

    addSetReleaseDate(data, card.set);
    addCard(data, Number(card.dexId[0]), buildLocalCard(card, selectedImage, data));
    summary.added += 1;
  } catch (error) {
    summary.failed.push({ id, error: String(error?.message || error) });
  }
}

if (summary.added > 0 || summary.downloadedImages > 0) {
  writeLocalData(data);
}

writeFileSync(`${TMP_DIR}/summary.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));

function getTcgdexCard(id) {
  const output = execFileSync("curl", ["-fsSL", `https://api.tcgdex.net/v2/en/cards/${encodeURIComponent(id)}`], {
    encoding: "utf8",
  });
  return JSON.parse(output);
}

function buildLocalCard(card, imageSource, data) {
  const number = String(card.localId || "");
  const officialCount = card.set?.cardCount?.official || 0;
  const { label, rank } = getLabelAndRank(card);

  return {
    id: card.id,
    name: card.name,
    image: `./${CARD_DIR}/${card.id}.webp`,
    form: classifyForm(card.name),
    isShiny: false,
    backgroundType: "content",
    eraCode: getEraCode(card.set?.id || card.id),
    setDisplayCode: getSetDisplayCode(card.set?.id || ""),
    ptcgoCode: getPtcgoCode(card, data),
    setId: card.set?.id || "",
    setName: card.set?.name || "",
    number,
    printedNumber: officialCount ? `${number}/${officialCount}` : number,
    rarity: card.rarity || "None",
    label,
    rank,
    imageSource: {
      provider: imageSource.provider,
      url: imageSource.url,
    },
  };
}

function getPtcgoCode(card, data) {
  const direct = card.set?.tcgOnline || card.set?.abbreviation?.official || "";
  if (direct) return direct;

  const setId = String(card.set?.id || "");
  for (const [, cards] of data.cardsByDex || []) {
    const existing = cards.find((item) => item.setId === setId && item.ptcgoCode);
    if (existing) return existing.ptcgoCode;
  }

  const setNameKey = normalizeSetName(card.set?.name || "");
  const fromSetName = new Map(data.ptcgoCodesBySetName || []).get(setNameKey);
  return fromSetName || "";
}

function normalizeSetName(name) {
  return String(name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function addCard(data, dexId, card) {
  const existingGroup = data.cardsByDex.find(([id]) => Number(id) === dexId);
  if (existingGroup) {
    existingGroup[1].push(card);
    existingGroup[1].sort(compareCards);
    return;
  }

  data.cardsByDex.push([dexId, [card]]);
}

function addSetReleaseDate(data, set) {
  if (!set?.id || !set?.releaseDate) return;
  const dates = new Map(data.setReleaseDates || []);
  if (dates.has(set.id)) return;
  dates.set(set.id, set.releaseDate);
  data.setReleaseDates = Array.from(dates.entries()).sort(([a], [b]) => String(a).localeCompare(String(b)));
}

function getImageCandidates(card) {
  const candidates = [];
  if (card.image) {
    candidates.push({ provider: "TCGdex", url: `${card.image}/high.webp` });
    candidates.push({ provider: "TCGdex", url: `${card.image}/low.webp` });
  }
  candidates.push({ provider: "Scrydex", url: `https://images.scrydex.com/pokemon/${card.id}/large` });
  candidates.push({ provider: "Scrydex", url: `https://images.scrydex.com/pokemon/${card.id}/small` });
  return candidates;
}

function downloadProjectImage(id, candidates) {
  const sourcePath = `${TMP_DIR}/${safeFileName(id)}.source`;
  const outputPath = `${CARD_DIR}/${id}.webp`;
  const tmpOutputPath = `${TMP_DIR}/${safeFileName(id)}.webp`;

  let selected = null;
  for (const candidate of candidates) {
    try {
      execFileSync("curl", ["-fsSL", "-o", sourcePath, candidate.url]);
      if (candidate.provider === "Scrydex" && isScrydexCardBack(sourcePath)) {
        selected = null;
        continue;
      }
      selected = candidate;
      break;
    } catch {
      selected = null;
    }
  }

  if (!selected) throw new Error(`No TCGdex or Scrydex image for ${id}`);

  execFileSync("/opt/miniconda3/bin/magick", [
    sourcePath,
    "-resize",
    `x${IMAGE_HEIGHT}`,
    "-background",
    "none",
    "-define",
    "webp:lossless=true",
    tmpOutputPath,
  ]);
  renameSync(tmpOutputPath, outputPath);
  return selected;
}

function classifyForm(name) {
  const normalized = String(name || "").toLowerCase();
  const forms = [
    { key: "alolan", label: "Alolan", shortLabel: "Alo", rank: 10, pattern: /\balolan\b/ },
    { key: "galarian", label: "Galarian", shortLabel: "Gal", rank: 12, pattern: /\bgalarian\b/ },
    { key: "hisuian", label: "Hisuian", shortLabel: "His", rank: 14, pattern: /\bhisuian\b/ },
    { key: "origin", label: "Origin", shortLabel: "Origin", rank: 30, pattern: /\borigin\b/ },
    { key: "single-strike", label: "Single Strike", shortLabel: "Single", rank: 40, pattern: /\bsingle strike\b/ },
    { key: "rapid-strike", label: "Rapid Strike", shortLabel: "Rapid", rank: 41, pattern: /\brapid strike\b/ },
  ];
  const match = forms.find((form) => form.pattern.test(normalized));
  return match || { key: "base", label: "Base", shortLabel: "Std", rank: 0 };
}

function getLabelAndRank(card) {
  const rarity = String(card.rarity || "").toLowerCase();
  if (String(card.localId || "").startsWith("TG")) return { label: "TG", rank: 1 };
  if (String(card.localId || "").startsWith("GG")) return { label: "GG", rank: 1 };
  if (rarity === "illustration rare") return { label: "IR", rank: 1 };
  if (rarity === "special illustration rare") return { label: "SIR", rank: 2 };
  if (rarity === "secret rare") return { label: "Secret", rank: 2 };
  if (rarity === "ultra rare") return { label: "FA", rank: 3 };
  return { label: "Rare", rank: 4 };
}

function getEraCode(setId) {
  if (String(setId).startsWith("swsh")) return "SWSH";
  if (String(setId).startsWith("sv")) return "SV";
  if (String(setId).startsWith("sm")) return "SM";
  if (String(setId).startsWith("xy")) return "XY";
  return "";
}

function getSetDisplayCode(setId) {
  const swshMatch = String(setId || "").match(/^swsh(\d+)(?:\.(\d+))?$/i);
  if (swshMatch) return `SWSH${String(swshMatch[1]).padStart(2, "0")}${swshMatch[2] ? `.${swshMatch[2]}` : ""}`;
  return String(setId || "").toUpperCase();
}

function compareCards(a, b) {
  return (
    Number(a.rank || 99) - Number(b.rank || 99) ||
    String(a.setId || "").localeCompare(String(b.setId || "")) ||
    String(a.number || "").localeCompare(String(b.number || ""), undefined, { numeric: true }) ||
    String(a.id || "").localeCompare(String(b.id || ""), undefined, { numeric: true })
  );
}

function safeFileName(value) {
  return basename(String(value)).replace(/[^a-zA-Z0-9_.-]/g, "_");
}

function isScrydexCardBack(filePath) {
  const hash = createHash("sha256").update(readFileSync(filePath)).digest("hex");
  return SCRYDEX_CARD_BACK_HASHES.has(hash);
}
