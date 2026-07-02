import { readFileSync } from "node:fs";

const query = process.argv.slice(2).join(" ").trim().toLowerCase();

if (!query) {
  console.error("Usage: node scripts/tool-find-card.mjs <card id | code | name | number>");
  process.exit(1);
}

const prefix = "window.PTCG_LOCAL_DATA = ";
const data = JSON.parse(readFileSync("local-data.js", "utf8").slice(prefix.length).replace(/;\s*$/, ""));
const speciesCn = new Map((data.species_cn || []).map(([id, name]) => [Number(id), name]));
const setsById = new Map(data.setsById || []);
const matches = [];

for (const [dexId, cards] of data.cardsByDex || []) {
  for (const card of cards) {
    const cardDexIds = getCardDexIds(card, Number(dexId));
    const haystack = [
      card.id,
      card.cardName,
      speciesCn.get(Number(dexId)) || "",
      getDexSearchText(cardDexIds),
      card.setId,
      getSetName(card),
      getPtcgoCode(card),
      getSetDisplayCode(card.setId),
      card.number,
      getPrintedNumber(card),
      formatCardCode(card),
      card.label,
      card.rarity,
      card.backgroundType,
    ]
      .join(" ")
      .toLowerCase();

    if (!haystack.includes(query)) continue;
    matches.push({
      dexId: Number(dexId),
      dexIds: cardDexIds,
      pokemon: getPrimaryPokemonName(card, Number(dexId)),
      cardName: card.cardName,
      zhName: speciesCn.get(Number(dexId)) || "",
      id: card.id,
      code: formatCardCode(card),
      label: card.label,
      rarity: card.rarity,
      backgroundType: card.backgroundType,
      isShiny: card.isShiny,
      releaseDate: card.releaseDate || getSetMeta(card).releaseDate || "",
      setId: card.setId,
      setName: getSetName(card),
      image: card.image || "",
    });
  }
}

function getCardDexIds(card, fallbackDexId) {
  const ids = Array.isArray(card.dexIds) && card.dexIds.length ? card.dexIds : [fallbackDexId];
  return Array.from(new Set(ids.map(Number).filter((id) => Number.isFinite(id) && id > 0)));
}

function getDexSearchText(dexIds) {
  const speciesById = new Map((data.species || []).map((mon) => [Number(mon.id), mon.name]));
  return dexIds
    .flatMap((dexId) => [String(dexId).padStart(4, "0"), speciesById.get(dexId) || "", speciesCn.get(dexId) || ""])
    .join(" ");
}

function getPrimaryPokemonName(card, fallbackDexId) {
  const primaryDexId = Number(card.primaryDexId || getCardDexIds(card, fallbackDexId)[0] || fallbackDexId);
  const species = (data.species || []).find((mon) => Number(mon.id) === primaryDexId);
  return species?.name || "";
}

console.log(JSON.stringify(matches.slice(0, 100), null, 2));
if (matches.length > 100) {
  console.error(`Showing first 100 of ${matches.length} matches.`);
}

function formatCardCode(card) {
  const language = card.language || "EN";
  const era = getMenuEraCode(card);
  const setCode = getMenuSetCode(card);
  const number = getMenuCardNumber(card);
  return `[${language}] ${[era, setCode, number].filter(Boolean).join("-")}`;
}

function getMenuEraCode(card) {
  const id = String(card.setId || card.id || "").toLowerCase();
  const setMeta = getSetMeta(card);
  if (card.eraCode || setMeta.eraCode) return card.eraCode || setMeta.eraCode;
  if (id.startsWith("me")) return "ME";
  if (id.startsWith("sv")) return "SV";
  if (id.startsWith("swsh")) return "SWSH";
  if (id.startsWith("sm")) return "SM";
  if (id.startsWith("xy")) return "XY";
  if (id.startsWith("bw")) return "BW";
  if (id.startsWith("dp")) return "DP";
  if (id.startsWith("pl")) return "PL";
  if (id.startsWith("hgss")) return "HGSS";
  if (id.startsWith("ex")) return "EX";
  if (id.startsWith("base")) return "BASE";
  return getSetDisplayCode(card.setId);
}

function getMenuSetCode(card) {
  const ptcgoCode = getPtcgoCode(card);
  if (card.label === "Promo" || /^PR-/i.test(ptcgoCode)) return "PROMO";
  const setMeta = getSetMeta(card);
  return ptcgoCode || getSetDisplayCode(card.setId) || card.setId || setMeta.name || "";
}

function getMenuCardNumber(card) {
  if (card.variant?.number) {
    return [card.number, card.variant.number].filter(Boolean).map(formatMenuNumberPart).join("-");
  }
  const number = String(card.number || getPrintedNumber(card) || "").split("/")[0];
  return formatMenuNumberPart(number);
}

function getSetMeta(card) {
  return setsById.get(card.setId) || {};
}

function getSetName(card) {
  return getSetMeta(card).name || card.setId || "";
}

function getPtcgoCode(card) {
  return String(getSetMeta(card).ptcgoCode || "").trim();
}

function getPrintedNumber(card) {
  const number = String(card.number || "");
  if (card.variant?.number) {
    const variantNumber = String(card.variant.number || "");
    const variantTotal = String(card.variant.total || "");
    return variantTotal ? `${number}${variantNumber}/${variantTotal}` : `${number}${variantNumber}`;
  }
  const total = getSetMeta(card).total;
  return number && total ? `${number}/${total}` : number;
}

function formatMenuNumberPart(number) {
  return /^\d+$/.test(number) ? String(Number(number)) : number;
}

function getSetDisplayCode(setId) {
  const swshMatch = String(setId || "").match(/^swsh(\d+)(?:\.(\d+))?$/i);
  if (swshMatch) return `SWSH${String(swshMatch[1]).padStart(2, "0")}${swshMatch[2] ? `.${swshMatch[2]}` : ""}`;
  return String(setId || "").toUpperCase();
}
