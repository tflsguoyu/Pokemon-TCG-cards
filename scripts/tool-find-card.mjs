import { readFileSync } from "node:fs";

const query = process.argv.slice(2).join(" ").trim().toLowerCase();

if (!query) {
  console.error("Usage: node scripts/tool-find-card.mjs <card id | code | name | number>");
  process.exit(1);
}

const prefix = "window.PTCG_LOCAL_DATA = ";
const data = JSON.parse(readFileSync("local-data.js", "utf8").slice(prefix.length).replace(/;\s*$/, ""));
const zhNames = new Map((data.zhNames || []).map(([id, name]) => [Number(id), name]));
const setReleaseDates = new Map(data.setReleaseDates || []);
const matches = [];

for (const [dexId, cards] of data.cardsByDex || []) {
  for (const card of cards) {
    const haystack = [
      card.id,
      card.name,
      zhNames.get(Number(dexId)) || "",
      card.setId,
      card.setName,
      card.ptcgoCode,
      card.setDisplayCode,
      card.number,
      card.printedNumber,
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
      pokemon: card.name,
      zhName: zhNames.get(Number(dexId)) || "",
      id: card.id,
      code: formatCardCode(card),
      label: card.label,
      rarity: card.rarity,
      backgroundType: card.backgroundType,
      isShiny: card.isShiny,
      releaseDate: card.releaseDate || setReleaseDates.get(card.setId) || "",
      setId: card.setId,
      setName: card.setName,
      image: card.image || "",
    });
  }
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
  if (card.eraCode) return card.eraCode;
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
  return card.setDisplayCode || "";
}

function getMenuSetCode(card) {
  const ptcgoCode = String(card.ptcgoCode || "").trim();
  if (card.label === "Promo" || /^PR-/i.test(ptcgoCode)) return "PROMO";
  return ptcgoCode || card.setDisplayCode || card.setId || card.setName || "";
}

function getMenuCardNumber(card) {
  const number = String(card.number || card.printedNumber || "").split("/")[0];
  return /^\d+$/.test(number) ? String(Number(number)) : number;
}
