import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

const DATA_PATH = "local-data.js";
const DATA_PREFIX = "window.PTCG_LOCAL_DATA = ";
const CARD_DIR = "assets/cards";
const TMP_DIR = "tmp/import-svp-promos";
const IMAGE_HEIGHT = 825;
const SCRYDEX_CARD_BACK_HASHES = new Set([
  "fd7c3800f9b8ebadcf7c3dd1908934be336a5b9d00d06f581171e9086f5e3a8e",
  "fd7c3800f9b8ebadf4b31a735f569a180e66201741b00fafa17879967884ad2c",
]);

const DEFAULT_NUMBERS = [
  "013",
  "014",
  "027",
  "044",
  "051",
  "052",
  "053",
  "056",
  "065",
  "066",
  "069",
  "070",
  "071",
  "072",
  "073",
  "074",
  "075",
  "076",
  "077",
  "078",
  "079",
  "080",
  "081",
  "082",
  "083",
  "084",
  "085",
  "088",
  "097",
  "098",
  "123",
  "125",
  "129",
  "130",
  "131",
  "132",
  "141",
  "159",
  "165",
  "166",
  "173",
  "174",
  "189",
  "194",
  "195",
  "203",
  "204",
  "206",
  "207",
  "208",
  "209",
  "210",
  "211",
  "212",
];

const numbers = (process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_NUMBERS).map((number) =>
  String(number).padStart(3, "0")
);

mkdirSync(TMP_DIR, { recursive: true });
mkdirSync(CARD_DIR, { recursive: true });

const data = JSON.parse(readFileSync(DATA_PATH, "utf8").slice(DATA_PREFIX.length).replace(/;\s*$/, ""));
const cardsById = new Map();
for (const [, cards] of data.cardsByDex || []) {
  for (const card of cards) cardsById.set(card.id, card);
}

const summary = {
  requested: numbers.length,
  added: 0,
  alreadyPresent: 0,
  downloadedImages: 0,
  skippedNonPokemon: [],
  skippedMissingDex: [],
  failed: [],
};

for (const number of numbers) {
  const id = `svp-${number}`;
  try {
    const card = getTcgdexCard(id);
    if (card.category !== "Pokemon") {
      summary.skippedNonPokemon.push({ id, category: card.category || "" });
      continue;
    }
    if (!Array.isArray(card.dexId) || card.dexId.length === 0) {
      summary.skippedMissingDex.push({ id, name: card.name || "" });
      continue;
    }

    const imageCandidates = getImageCandidates(card);
    let selectedImage = imageCandidates[0];
    if (!existsSync(`${CARD_DIR}/${id}.webp`)) {
      selectedImage = downloadProjectImage(id, imageCandidates);
      summary.downloadedImages += 1;
    }

    if (cardsById.has(id)) {
      summary.alreadyPresent += 1;
      continue;
    }

    addCard(data, Number(card.dexId[0]), buildLocalCard(card, selectedImage));
    summary.added += 1;
  } catch (error) {
    summary.failed.push({ id, error: String(error?.message || error) });
  }
}

if (summary.added > 0) {
  data.version = Number(data.version || 0) + 1;
  data.generatedAt = new Date().toISOString();
  data.cardsByDex.sort((a, b) => Number(a[0]) - Number(b[0]));
  writeFileSync(DATA_PATH, `${DATA_PREFIX}${JSON.stringify(data)};\n`);
}

writeFileSync(`${TMP_DIR}/summary.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));

function getTcgdexCard(id) {
  const output = execFileSync("curl", ["-fsSL", `https://api.tcgdex.net/v2/en/cards/${encodeURIComponent(id)}`], {
    encoding: "utf8",
  });
  return JSON.parse(output);
}

function buildLocalCard(card, imageSource) {
  const number = String(card.localId || "").padStart(3, "0");
  const officialCount = card.set?.cardCount?.official || 225;
  const rarity = card.rarity || "None";
  const { label, rank } = getLabelAndRank(rarity);

  return {
    id: card.id,
    name: card.name,
    image: `./${CARD_DIR}/${card.id}.webp`,
    form: classifyForm(card.name),
    isShiny: false,
    backgroundType: "content",
    eraCode: "SV",
    setDisplayCode: "SV",
    ptcgoCode: "PR-SV",
    setId: "svp",
    setName: card.set?.name || "SVP Black Star Promos",
    number,
    printedNumber: `${number}/${officialCount}`,
    rarity,
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

function getImageCandidates(card) {
  const candidates = [];
  if (card.image) {
    candidates.push({ provider: "TCGdex", url: `${card.image}/high.webp` });
    candidates.push({ provider: "TCGdex", url: `${card.image}/low.webp` });
  }
  const unpaddedId = card.id.replace(/-(0+)(\d+)$/, "-$2");
  if (unpaddedId !== card.id) {
    candidates.push({ provider: "Scrydex", url: `https://images.scrydex.com/pokemon/${unpaddedId}/large` });
    candidates.push({ provider: "Scrydex", url: `https://images.scrydex.com/pokemon/${unpaddedId}/small` });
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
    { key: "paldean", label: "Paldean", shortLabel: "Pal", rank: 13, pattern: /\bpaldean\b/ },
    { key: "origin", label: "Origin", shortLabel: "Origin", rank: 30, pattern: /\borigin\b/ },
    { key: "therian", label: "Therian", shortLabel: "Therian", rank: 31, pattern: /\btherian\b/ },
    { key: "mega", label: "Mega", shortLabel: "Mega", rank: 22, pattern: /\bmega\b/ },
  ];
  const match = forms.find((form) => form.pattern.test(normalized));
  return match || { key: "base", label: "Base", shortLabel: "Std", rank: 0 };
}

function getLabelAndRank(rarity) {
  const normalized = String(rarity || "").toLowerCase();
  if (normalized === "illustration rare") return { label: "IR", rank: 1 };
  if (normalized === "special illustration rare") return { label: "SIR", rank: 2 };
  if (normalized === "mega attack rare") return { label: "MAR", rank: 2 };
  if (normalized === "ultra rare") return { label: "FA", rank: 3 };
  return { label: "Promo", rank: 4 };
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
