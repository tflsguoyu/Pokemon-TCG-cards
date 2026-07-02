import { mkdirSync, writeFileSync } from "node:fs";
import { readLocalData, writeLocalData } from "./lib-version-utils.mjs";

const TMP_DIR = "tmp/maintenance-refresh-all-json";
const SUMMARY_PATH = `${TMP_DIR}/summary.json`;
const CARD_DIR = "assets/cards";
const CONCURRENCY = Number(process.env.REFRESH_CARD_JSON_CONCURRENCY || 8);

mkdirSync(TMP_DIR, { recursive: true });

const data = readLocalData();
const speciesByDex = new Map((data.species || []).map((species) => [Number(species.id), species.name]));
const setsById = new Map(data.setsById || []);
const cardsById = new Map();
const cardRefs = [];

for (const [dexId, cards] of data.cardsByDex || []) {
  for (const card of cards) {
    cardRefs.push({ dexId: Number(dexId), card });
    if (!cardsById.has(card.id)) cardsById.set(card.id, []);
    cardsById.get(card.id).push({ dexId: Number(dexId), card });
  }
}

const ids = Array.from(cardsById.keys()).sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
const remoteCards = new Map();
const summary = {
  startedAt: new Date().toISOString(),
  totalUnique: ids.length,
  updatedUnique: 0,
  fallbackUnique: 0,
  failedUnique: 0,
  setDatesUpdated: 0,
  setDatesFailed: [],
  fallback: [],
  failed: [],
};

let nextIndex = 0;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (nextIndex < ids.length) {
      const id = ids[nextIndex];
      nextIndex += 1;
      const remote = await getTcgdexCard(id);
      if (remote) {
        remoteCards.set(id, remote);
        summary.updatedUnique += 1;
      } else {
        summary.fallbackUnique += 1;
        summary.fallback.push({ id, reason: "TCGdex API did not return card metadata; refreshed from existing local JSON" });
      }
      if ((summary.updatedUnique + summary.fallbackUnique + summary.failedUnique) % 100 === 0) writeSummary();
    }
  })
);

for (const { dexId, card } of cardRefs) {
  const remote = remoteCards.get(card.id);
  refreshLocalCard(card, remote, dexId);
}

await refreshSetReleaseDates();
const version = writeLocalData(data);
summary.version = version;
summary.finishedAt = new Date().toISOString();
writeSummary();
console.log(JSON.stringify(summary, null, 2));

async function getTcgdexCard(id) {
  try {
    const response = await fetch(`https://api.tcgdex.net/v2/en/cards/${encodeURIComponent(id)}`);
    if (!response.ok) return null;
    const card = await response.json();
    if (card.category && card.category !== "Pokemon") return null;
    return card;
  } catch {
    return null;
  }
}

async function getTcgdexSet(setId) {
  try {
    const response = await fetch(`https://api.tcgdex.net/v2/en/sets/${encodeURIComponent(setId)}`);
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function refreshSetReleaseDates() {
  const setIds = new Set();
  for (const [, cards] of data.cardsByDex || []) {
    for (const card of cards) {
      if (card.setId) setIds.add(card.setId);
    }
  }

  for (const setId of Array.from(setIds).sort()) {
    const set = await getTcgdexSet(setId);
    if (!set?.releaseDate) {
      if (!setsById.get(setId)?.releaseDate) summary.setDatesFailed.push({ setId });
      continue;
    }
    const existing = setsById.get(setId) || {};
    const next = {
      ...existing,
      eraCode: existing.eraCode || getEraCode(setId),
      name: set.name || existing.name || "",
      total: set.cardCount?.official || existing.total || "",
      releaseDate: set.releaseDate,
    };
    if (JSON.stringify(existing) !== JSON.stringify(next)) {
      setsById.set(setId, next);
      summary.setDatesUpdated += 1;
    }
  }

  data.setsById = Array.from(setsById.entries()).sort(([a], [b]) => String(a).localeCompare(String(b)));
}

function refreshLocalCard(card, remote, currentDexId) {
  const dexId = Number(remote?.dexId?.[0] || currentDexId);
  const set = remote?.set || {};
  const setId = String(set.id || card.setId || card.id.split("-")[0] || "");
  const number = card.variant?.number
    ? String(card.number || "")
    : String(remote?.localId || card.number || "").split("/")[0];
  const officialCount = set.cardCount?.official || 0;
  const cardName = remote?.name || card.cardName || "";
  const { label, rank } = getLabelAndRank(remote || card, card);

  card.language = card.language || "EN";
  card.cardName = cardName;
  card.image = `./${CARD_DIR}/${card.id}.webp`;
  card.form = classifyForm(cardName);
  card.isShiny = isShinyCard(remote) || Boolean(card.isShiny);
  card.backgroundType = card.backgroundType || "content";
  card.setId = setId;
  card.number = number;
  card.rarity = remote?.rarity || card.rarity || "None";
  card.label = label;
  card.rank = rank;
  card.imageSource = {
    provider: "Scrydex",
    url: getScrydexImageSource(setId, number),
  };

  upsertSetMeta(setId, {
    eraCode: getEraCode(setId),
    ptcgoCode: getPtcgoCode(remote, card),
    name: set.name || getSetMeta(card).name || "",
    total: officialCount || getSetMeta(card).total || "",
  });
}

function getPtcgoCode(remote, card) {
  const direct = remote?.set?.tcgOnline || remote?.set?.abbreviation?.official || "";
  if (direct) return direct;

  const setId = String(remote?.set?.id || card.setId || "");
  const existingSet = setsById.get(setId);
  if (existingSet?.ptcgoCode) return existingSet.ptcgoCode;

  return "";
}

function getScrydexImageSource(setId, number) {
  return `https://images.scrydex.com/pokemon/${getScrydexCardId(setId, number)}/large`;
}

function getScrydexCardId(setId, number) {
  const normalizedSetId = String(setId || "").toLowerCase();
  const normalizedNumber = String(number || "");
  if (normalizedSetId === "swsh4.5" && /^SV\d+/i.test(normalizedNumber)) {
    return `swsh45sv-${normalizedNumber.toUpperCase()}`;
  }
  if (normalizedSetId === "swsh12.5" && /^GG\d+/i.test(normalizedNumber)) {
    return `swsh12pt5gg-${normalizedNumber.toUpperCase()}`;
  }
  if (/^swsh(?:9|10|11|12)$/.test(normalizedSetId) && /^TG\d+/i.test(normalizedNumber)) {
    return `${normalizedSetId}tg-${normalizedNumber.toUpperCase()}`;
  }
  return `${normalizeScrydexSetId(setId)}-${normalizeScrydexNumber(number)}`;
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
  return forms.find((form) => form.pattern.test(normalized)) || { key: "base", label: "Base", rank: 0 };
}

function isShinyCard(source) {
  const description = String(source?.description || "").toLowerCase();
  return description.includes("different color than usual");
}

function getLabelAndRank(source, existing) {
  const rarity = String(source?.rarity || "").toLowerCase();
  const localId = String(source?.localId || existing?.number || "");
  if (localId.startsWith("TG")) return { label: "TG", rank: 1 };
  if (localId.startsWith("GG")) return { label: "GG", rank: 1 };
  if (rarity === "illustration rare") return { label: "IR", rank: 1 };
  if (rarity === "special illustration rare") return { label: "SIR", rank: 2 };
  if (rarity === "secret rare") return { label: "Secret", rank: 2 };
  if (rarity === "rare rainbow") return { label: "Secret", rank: 2 };
  if (rarity === "rare secret") return { label: "Secret", rank: 2 };
  if (rarity === "ultra rare") return { label: "FA", rank: 3 };
  if (rarity === "rare ultra") return { label: "FA", rank: 3 };
  if (rarity === "shiny rare") return { label: "Shiny", rank: 5 };
  if (rarity === "shiny rare v") return { label: "Shiny V", rank: 5 };
  if (rarity === "shiny rare vmax") return { label: "Shiny VMAX", rank: 5 };
  if (rarity === "shiny ultra rare") return { label: "Shiny", rank: 5 };
  if (rarity === "radiant rare") return { label: "Rare", rank: 4 };
  if (rarity === "mega attack rare") return { label: "MAR", rank: 1 };
  if (existing?.label === "Promo" || String(getPtcgoCodeFromExisting(existing) || "").startsWith("PR-")) return { label: "Promo", rank: 4 };
  return { label: "Rare", rank: 4 };
}

function upsertSetMeta(setId, updates) {
  if (!setId) return;
  const existing = setsById.get(setId) || {};
  const next = Object.fromEntries(
    Object.entries({ ...existing, ...updates }).filter(([, value]) => value !== "" && value !== undefined && value !== null)
  );
  setsById.set(setId, next);
  data.setsById = Array.from(setsById.entries()).sort(([a], [b]) => String(a).localeCompare(String(b)));
}

function getSetMeta(card) {
  return setsById.get(card?.setId) || {};
}

function getSetName(card) {
  return getSetMeta(card).name || "";
}

function getPrintedNumber(card) {
  const number = String(card?.number || "");
  if (card?.variant?.number) {
    const variantNumber = String(card.variant.number || "");
    const variantTotal = String(card.variant.total || "");
    return variantTotal ? `${number}${variantNumber}/${variantTotal}` : `${number}${variantNumber}`;
  }
  const total = getSetMeta(card).total;
  return number && total ? `${number}/${total}` : number;
}

function getPtcgoCodeFromExisting(card) {
  return card?.ptcgoCode || getSetMeta(card).ptcgoCode || "";
}

function getEraCode(setId) {
  if (["dc1", "g1"].includes(String(setId))) return "XY";
  if (String(setId).startsWith("me")) return "ME";
  if (String(setId).startsWith("bw")) return "BW";
  if (String(setId).startsWith("swsh")) return "SWSH";
  if (String(setId).startsWith("sv")) return "SV";
  if (String(setId).startsWith("sm")) return "SM";
  if (String(setId).startsWith("xy")) return "XY";
  if (String(setId).startsWith("bw")) return "BW";
  return "";
}

function writeSummary() {
  writeFileSync(SUMMARY_PATH, JSON.stringify(summary, null, 2));
}
