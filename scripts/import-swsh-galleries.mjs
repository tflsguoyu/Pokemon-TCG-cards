import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { writeLocalData } from "./version-utils.mjs";

const DATA_PATH = "local-data.js";
const DATA_PREFIX = "window.PTCG_LOCAL_DATA = ";
const CARD_DIR = "assets/cards";
const TMP_DIR = "tmp/import-swsh-galleries";
const IMAGE_HEIGHT = 825;
const TRAINER_GALLERY_SET_IDS = ["swsh9", "swsh10", "swsh11", "swsh12"];
const CROWN_ZENITH_SET_ID = "swsh12.5";
const SCRYDEX_CARD_BACK_HASHES = new Set([
  "fd7c3800f9b8ebadcf7c3dd1908934be336a5b9d00d06f581171e9086f5e3a8e",
  "fd7c3800f9b8ebadf4b31a735f569a180e66201741b00fafa17879967884ad2c",
]);

mkdirSync(TMP_DIR, { recursive: true });
mkdirSync(CARD_DIR, { recursive: true });

const data = JSON.parse(readFileSync(DATA_PATH, "utf8").slice(DATA_PREFIX.length).replace(/;\s*$/, ""));
const cardsById = new Map();
for (const [, cards] of data.cardsByDex || []) {
  for (const card of cards) cardsById.set(card.id, card);
}

const setMetadataById = new Map();
const targetSummaries = [];

for (const setId of [...TRAINER_GALLERY_SET_IDS, CROWN_ZENITH_SET_ID]) {
  const set = getTcgdexSet(setId);
  setMetadataById.set(setId, set);
  addSetReleaseDate(data, set);

  for (const card of set.cards || []) {
    const localId = String(card.localId || "");
    if (TRAINER_GALLERY_SET_IDS.includes(setId) && localId.startsWith("TG")) {
      targetSummaries.push({ ...card, setId });
    }
    if (setId === CROWN_ZENITH_SET_ID && (localId.startsWith("GG") || localId === "160")) {
      targetSummaries.push({ ...card, setId });
    }
  }
}

const summary = {
  requested: targetSummaries.length,
  added: 0,
  alreadyPresent: 0,
  downloadedImages: 0,
  skippedNonPokemon: [],
  skippedMissingDex: [],
  failed: [],
};

for (const target of targetSummaries) {
  try {
    const card = getTcgdexCard(target.id);
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

    const set = setMetadataById.get(target.setId) || card.set || {};
    addCard(data, Number(card.dexId[0]), buildLocalCard(card, set, selectedImage));
    summary.added += 1;
  } catch (error) {
    summary.failed.push({ id: target.id, error: String(error?.message || error) });
  }
}

if (summary.added > 0 || summary.downloadedImages > 0) {
  writeLocalData(data);
}

writeFileSync(`${TMP_DIR}/summary.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));

function getTcgdexSet(id) {
  const output = execFileSync("curl", ["-fsSL", `https://api.tcgdex.net/v2/en/sets/${encodeURIComponent(id)}`], {
    encoding: "utf8",
  });
  return JSON.parse(output);
}

function getTcgdexCard(id) {
  const output = execFileSync("curl", ["-fsSL", `https://api.tcgdex.net/v2/en/cards/${encodeURIComponent(id)}`], {
    encoding: "utf8",
  });
  return JSON.parse(output);
}

function buildLocalCard(card, set, imageSource) {
  const number = String(card.localId || "");
  const officialCount = set.cardCount?.official || card.set?.cardCount?.official || 0;
  const { label, rank } = getLabelAndRank(card);

  return {
    id: card.id,
    name: card.name,
    image: `./${CARD_DIR}/${card.id}.webp`,
    form: classifyForm(card.name),
    isShiny: false,
    backgroundType: "content",
    eraCode: "SWSH",
    setDisplayCode: getSetDisplayCode(card.set?.id || set.id),
    ptcgoCode: set.tcgOnline || card.set?.tcgOnline || set.abbreviation?.official || "",
    setId: card.set?.id || set.id,
    setName: set.name || card.set?.name || "",
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
  const localId = String(card.localId || "");
  if (localId.startsWith("TG")) return { label: "TG", rank: 1 };
  if (localId.startsWith("GG")) return { label: "GG", rank: 1 };
  if (localId === "160") return { label: "Secret", rank: 2 };
  const rarity = String(card.rarity || "").toLowerCase();
  if (rarity === "illustration rare") return { label: "IR", rank: 1 };
  if (rarity === "special illustration rare") return { label: "SIR", rank: 2 };
  if (rarity === "ultra rare") return { label: "FA", rank: 3 };
  return { label: "Rare", rank: 4 };
}

function getSetDisplayCode(setId) {
  const match = String(setId || "").match(/^swsh(\d+)(?:\.(\d+))?$/i);
  if (!match) return String(setId || "").toUpperCase();
  return `SWSH${String(match[1]).padStart(2, "0")}${match[2] ? `.${match[2]}` : ""}`;
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
