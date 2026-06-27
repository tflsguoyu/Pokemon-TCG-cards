import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { writeLocalData } from "./lib-version-utils.mjs";

const DATA_PATH = "local-data.js";
const DATA_PREFIX = "window.PTCG_LOCAL_DATA = ";
const CARD_DIR = "assets/cards";
const TMP_DIR = "tmp/01-add-card-json";

const ids = process.argv.slice(2);
if (ids.length === 0) {
  console.error("Usage: node scripts/01-add-card-json.mjs <card-id> [card-id...]");
  process.exit(1);
}

mkdirSync(TMP_DIR, { recursive: true });

const data = JSON.parse(readFileSync(DATA_PATH, "utf8").slice(DATA_PREFIX.length).replace(/;\s*$/, ""));
const speciesByDex = new Map((data.species || []).map((species) => [Number(species.id), species.name]));
const cardsById = new Map();
for (const [, cards] of data.cardsByDex || []) {
  for (const card of cards) cardsById.set(card.id, card);
}

const summary = {
  requested: ids.length,
  added: 0,
  alreadyPresent: 0,
  imageSourcesPrepared: 0,
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

    if (cardsById.has(card.id)) {
      summary.alreadyPresent += 1;
      continue;
    }

    addSetReleaseDate(data, card.set);
    addCard(data, Number(card.dexId[0]), buildLocalCard(card, data));
    summary.added += 1;
    summary.imageSourcesPrepared += 1;
  } catch (error) {
    summary.failed.push({ id, error: String(error?.message || error) });
  }
}

if (summary.added > 0) {
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

function buildLocalCard(card, data) {
  const number = String(card.localId || "");
  const officialCount = card.set?.cardCount?.official || 0;
  const { label, rank } = getLabelAndRank(card);
  const pokemonName = speciesByDex.get(Number(card.dexId?.[0])) || card.name || "";
  const cardName = card.name || pokemonName;
  const imageSource = getScrydexImageSource(card);

  return {
    id: card.id,
    name: cardName,
    pokemonName,
    cardName,
    image: `./${CARD_DIR}/${card.id}.webp`,
    form: classifyForm(cardName),
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
      provider: "Scrydex",
      url: imageSource,
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

function getScrydexImageSource(card) {
  const setId = String(card.set?.id || card.id.split("-")[0] || "");
  const localId = String(card.localId || card.id.split("-").slice(1).join("-") || "");
  return `https://images.scrydex.com/pokemon/${getScrydexCardId(setId, localId)}/large`;
}

function getScrydexCardId(setId, localId) {
  const normalizedSetId = String(setId || "").toLowerCase();
  const normalizedLocalId = String(localId || "");
  if (normalizedSetId === "swsh4.5" && /^SV\d+/i.test(normalizedLocalId)) {
    return `swsh45sv-${normalizedLocalId.toUpperCase()}`;
  }
  if (normalizedSetId === "swsh12.5" && /^GG\d+/i.test(normalizedLocalId)) {
    return `swsh12pt5gg-${normalizedLocalId.toUpperCase()}`;
  }
  if (/^swsh(?:9|10|11|12)$/.test(normalizedSetId) && /^TG\d+/i.test(normalizedLocalId)) {
    return `${normalizedSetId}tg-${normalizedLocalId.toUpperCase()}`;
  }
  return `${normalizeScrydexSetId(setId)}-${normalizeScrydexNumber(localId)}`;
}

function normalizeScrydexSetId(value) {
  const setId = String(value || "").toLowerCase().replace(/^([a-z]+)0+(\d)/i, "$1$2");
  if (setId === "swsh4.5") return "swsh45";
  if (setId === "swsh10.5") return "pgo";
  if (setId === "sv10.5b") return "zsv10pt5";
  if (setId === "sv10.5w") return "rsv10pt5";
  if (setId.startsWith("sm")) return setId.replace(/\./g, "");
  return setId.replace(/\.(\d+)/g, "pt$1");
}

function normalizeScrydexNumber(value) {
  const number = String(value || "");
  const numericSuffix = number.match(/^([A-Za-z]*)(0*)(\d+)([a-z]?)$/);
  if (!numericSuffix) return number;
  const [, prefix, , digits, suffix] = numericSuffix;
  return `${prefix}${Number(digits)}${suffix}`;
}

function classifyForm(name) {
  const normalized = String(name || "").toLowerCase();
  const forms = [
    { key: "alolan", label: "Alolan", rank: 10, pattern: /\balolan\b/ },
    { key: "galarian", label: "Galarian", rank: 12, pattern: /\bgalarian\b/ },
    { key: "hisuian", label: "Hisuian", rank: 14, pattern: /\bhisuian\b/ },
    { key: "paldean", label: "Paldean", rank: 16, pattern: /\bpaldean\b/ },
    { key: "origin", label: "Origin", rank: 30, pattern: /\borigin\b/ },
    { key: "single-strike", label: "Single Strike", rank: 40, pattern: /\bsingle strike\b/ },
    { key: "rapid-strike", label: "Rapid Strike", rank: 41, pattern: /\brapid strike\b/ },
  ];
  const match = forms.find((form) => form.pattern.test(normalized));
  return match || { key: "base", label: "Base", rank: 0 };
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
