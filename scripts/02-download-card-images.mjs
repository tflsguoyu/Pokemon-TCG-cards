import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { writeLocalData } from "./lib-version-utils.mjs";

const DATA_PATH = "local-data.js";
const DATA_PREFIX = "window.PTCG_LOCAL_DATA = ";
const CARD_DIR = "assets/cards";
const TMP_DIR = "tmp/02-download-card-images";
const SUMMARY_PATH = "tmp/02-download-card-images-summary.json";
const IMAGE_HEIGHT = 825;
const CONCURRENCY = Number(process.env.REFRESH_IMAGE_CONCURRENCY || 6);
const ONLY_IDS = new Set(
  String(process.env.REFRESH_IMAGE_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
);
const SCRYDEX_CARD_BACK_HASHES = new Set([
  "fd7c3800f9b8ebadcf7c3dd1908934be336a5b9d00d06f581171e9086f5e3a8e",
  "fd7c3800f9b8ebadf4b31a735f569a180e66201741b00fafa17879967884ad2c",
]);

mkdirSync(TMP_DIR, { recursive: true });

const data = JSON.parse(readFileSync(DATA_PATH, "utf8").slice(DATA_PREFIX.length).replace(/;\s*$/, ""));
const setsById = new Map(data.setsById || []);
const cards = [];
for (const [, list] of data.cardsByDex || []) {
  for (const card of list) {
    if (!card.id || !card.image) continue;
    cards.push(card);
  }
}

const uniqueCards = Array.from(new Map(cards.map((card) => [card.id, card])).values())
  .filter((card) => ONLY_IDS.size === 0 || ONLY_IDS.has(String(card.id)))
  .sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));

const summary = {
  startedAt: new Date().toISOString(),
  total: uniqueCards.length,
  converted: 0,
  failed: 0,
  sourceCounts: {},
  alphaCounts: {},
  results: [],
};

let nextIndex = 0;
let completed = 0;

await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (nextIndex < uniqueCards.length) {
      const index = nextIndex;
      nextIndex += 1;
      const card = uniqueCards[index];
      const result = await refreshCard(card, index);
      summary.results.push(result);
      summary.sourceCounts[result.provider] = (summary.sourceCounts[result.provider] || 0) + 1;
      summary.alphaCounts[result.hasTransparentPixels ? "transparent" : "opaque"] =
        (summary.alphaCounts[result.hasTransparentPixels ? "transparent" : "opaque"] || 0) + 1;
      if (result.status === "converted") summary.converted += 1;
      if (result.status === "failed") summary.failed += 1;
      completed += 1;
      if (completed % 25 === 0 || completed === uniqueCards.length) {
        console.log(`[${completed}/${uniqueCards.length}] ${card.id} -> ${result.provider}`);
        writeSummary();
      }
    }
  })
);

summary.finishedAt = new Date().toISOString();
writeSummary();

for (const [, list] of data.cardsByDex || []) {
  for (const card of list) {
    const result = summary.results.find((item) => item.id === card.id);
    if (!result || result.status !== "converted" || !result.sourceUrl) continue;
    card.imageSource = {
      provider: result.provider,
      url: result.sourceUrl,
    };
  }
}
writeLocalData(data);

console.log(JSON.stringify(summary, null, 2));

async function refreshCard(card, index) {
  const id = String(card.id);
  const output = `${CARD_DIR}/${id}.webp`;
  const candidates = getCandidates(card);
  const downloaded = [];

  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    const sourcePath = `${TMP_DIR}/${safeFileName(id)}-${i}.source`;
    try {
      const ok = await downloadImage(candidate.url, sourcePath);
      if (!ok) continue;
      if (candidate.provider === "Scrydex" && isScrydexCardBack(sourcePath)) continue;
      const info = identify(sourcePath);
      downloaded.push({ ...candidate, sourcePath, info });
    } catch (error) {
      downloaded.push({ ...candidate, error: String(error?.message || error) });
    }
  }

  const selected =
    downloaded.find((item) => item.provider === "Scrydex" && hasTransparentPixels(item.info)) ||
    downloaded.find((item) => item.provider === "Scrydex" && item.sourcePath) ||
    downloaded.find((item) => item.provider === "Pokemon.cn" && item.sourcePath) ||
    downloaded.find((item) => item.provider === "PokiPair" && item.sourcePath);

  if (!selected) {
    const existingInfo = existsSync(output) ? identify(output) : null;
    return {
      id,
      index,
      status: "failed",
      provider: "Existing local",
      sourceUrl: card.imageSource?.url || "",
      output,
      hasTransparentPixels: hasTransparentPixels(existingInfo),
      outputSize: existingInfo?.size || "",
      reason: `No usable image. Tried: ${candidates.map((candidate) => candidate.url).join(", ") || "none"}`,
    };
  }

  const tmpOutput = `${TMP_DIR}/${safeFileName(id)}.webp`;
  convertToProjectWebp(selected.sourcePath, tmpOutput);
  renameSync(tmpOutput, output);
  const outputInfo = identify(output);
  return {
    id,
    index,
    status: "converted",
    provider: selected.provider,
    sourceUrl: selected.url,
    sourceSize: selected.info.size,
    output,
    outputSize: outputInfo.size,
    hasAlphaChannel: hasAlphaChannel(outputInfo),
    hasTransparentPixels: hasTransparentPixels(outputInfo),
  };
}

function getCandidates(card) {
  const candidates = [];
  const scrydexUrls = new Set();
  const sourceUrl = String(card.imageSource?.url || "");
  const sourceProvider = String(card.imageSource?.provider || "").toLowerCase();
  const isPokemonCnSource = isPokemonCnUrl(sourceUrl) || sourceProvider === "pokemon.cn";
  const isPokiPairSource = isPokiPairUrl(sourceUrl) || sourceProvider === "pokipair";
  const shouldUseChineseSource = isPokemonCnSource || isPokiPairSource || isSimplifiedChineseCard(card);

  if (shouldUseChineseSource) {
    if (isPokemonCnUrl(sourceUrl)) candidates.push({ provider: "Pokemon.cn", url: sourceUrl });
    if (isPokiPairUrl(sourceUrl)) candidates.push({ provider: "PokiPair", url: sourceUrl });
    return candidates;
  }

  if (isScrydexUrl(sourceUrl)) {
    scrydexUrls.add(toScrydexLargeUrl(sourceUrl));
    scrydexUrls.add(getCorrectedScrydexUrl(sourceUrl));
  }
  for (const id of getScrydexIds(card)) {
    scrydexUrls.add(`https://images.scrydex.com/pokemon/${id}/large`);
  }
  candidates.push(...Array.from(scrydexUrls).filter(Boolean).map((url) => ({ provider: "Scrydex", url })));
  return candidates;
}

function getScrydexIds(card) {
  const ids = new Set();
  const id = String(card.id || "");
  const setId = String(card.setId || "").toLowerCase();
  const number = String(card.number || getPrintedNumber(card) || "").split("/")[0];
  ids.add(id);
  ids.add(id.toLowerCase());

  const numericIdMatch = id.match(/^(.+)-(\d+)$/);
  if (numericIdMatch) ids.add(`${numericIdMatch[1]}-${Number(numericIdMatch[2])}`);
  const idParts = id.match(/^(.+)-(.+)$/);
  if (idParts) {
    ids.add(getScrydexCardId(idParts[1], idParts[2]));
    ids.add(`${idParts[1].replace(/\./g, "")}-${normalizeScrydexNumber(idParts[2])}`);
    ids.add(`${idParts[1].toLowerCase().replace(/\./g, "")}-${normalizeScrydexNumber(idParts[2])}`);
    ids.add(`${normalizeScrydexSetId(idParts[1])}-${normalizeScrydexNumber(idParts[2])}`);
  }

  if (setId && number) {
    ids.add(getScrydexCardId(setId, number));
    ids.add(`${setId}-${number}`);
    ids.add(`${setId}-${number.toLowerCase()}`);
    ids.add(`${setId.replace(/\./g, "")}-${normalizeScrydexNumber(number)}`);
    ids.add(`${normalizeScrydexSetId(setId)}-${normalizeScrydexNumber(number)}`);
    const numericNumberMatch = number.match(/^0*(\d+)$/);
    if (numericNumberMatch) ids.add(`${setId}-${Number(numericNumberMatch[1])}`);
    const alphaNumberMatch = number.match(/^([a-z]+)0*(\d+)$/i);
    if (alphaNumberMatch) ids.add(`${setId}-${alphaNumberMatch[1].toLowerCase()}${Number(alphaNumberMatch[2])}`);
  }

  return Array.from(ids);
}

function isScrydexUrl(url) {
  return /^https:\/\/images\.scrydex\.com\/pokemon\//i.test(url);
}

function getPrintedNumber(card) {
  const number = String(card.number || "");
  if (card.variant?.number) {
    const variantNumber = String(card.variant.number || "");
    const variantTotal = String(card.variant.total || "");
    return variantTotal ? `${number}${variantNumber}/${variantTotal}` : `${number}${variantNumber}`;
  }
  const total = (setsById.get(card.setId) || {}).total;
  return number && total ? `${number}/${total}` : number;
}

function getSetDisplayCode(setId) {
  const swshMatch = String(setId || "").match(/^swsh(\d+)(?:\.(\d+))?$/i);
  if (swshMatch) return `SWSH${String(swshMatch[1]).padStart(2, "0")}${swshMatch[2] ? `.${swshMatch[2]}` : ""}`;
  return String(setId || "").toUpperCase();
}

function isPokiPairUrl(url) {
  return /^https:\/\/(?:media\.)?pokipair\.com\//i.test(url);
}

function isPokemonCnUrl(url) {
  return /^https:\/\/(?:image\.pokemon\.com\.cn|special\.pokemon\.cn)\//i.test(url);
}

function isSimplifiedChineseCard(card) {
  const language = String(card.language || "").trim().toUpperCase();
  if (language === "CN") return true;

  const setMeta = setsById.get(card.setId) || {};
  const possibleSetCodes = [card.setId, getSetDisplayCode(card.setId), setMeta.ptcgoCode, String(card.id || "").split("-")[0]]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  return possibleSetCodes.some((code) => /^(?:CS|CSV|CBB|CSMP|CSVL)\w*$/i.test(code) || /^151C$/i.test(code));
}

function toScrydexLargeUrl(url) {
  if (!isScrydexUrl(url)) return "";
  return url.replace(/\/(?:small|large)(?:\?.*)?$/i, "/large");
}

function getCorrectedScrydexUrl(url) {
  if (!isScrydexUrl(url)) return "";
  const match = toScrydexLargeUrl(url).match(/^(https:\/\/images\.scrydex\.com\/pokemon\/)([^/]+)\/large$/i);
  if (!match) return "";
  const [, prefix, slug] = match;
  const slugMatch = slug.match(/^(.+)-([^-]+)$/);
  if (!slugMatch) return "";
  const [, setId, number] = slugMatch;
  return `${prefix}${getScrydexCardId(setId, number)}/large`;
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

function isScrydexCardBack(filePath) {
  const hash = createHash("sha256").update(readFileSync(filePath)).digest("hex");
  return SCRYDEX_CARD_BACK_HASHES.has(hash);
}

async function downloadImage(url, filePath) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) return false;
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.startsWith("image/")) return false;
  writeFileSync(filePath, Buffer.from(await response.arrayBuffer()));
  return true;
}

function convertToProjectWebp(input, output) {
  execFileSync("/opt/miniconda3/bin/magick", [
    input,
    "-resize",
    `x${IMAGE_HEIGHT}`,
    "-alpha",
    "set",
    "-background",
    "none",
    "-define",
    "webp:lossless=true",
    output,
  ]);
}

function identify(filePath) {
  if (!filePath || !existsSync(filePath)) return null;
  const output = execFileSync(
    "/opt/miniconda3/bin/magick",
    ["identify", "-format", "%[channels]\t%[opaque]\t%wx%h", filePath],
    { encoding: "utf8" }
  ).trim();
  const [channels, opaque, size] = output.split("\t");
  return { channels, opaque: opaque === "True", size };
}

function hasTransparentPixels(info) {
  return Boolean(info?.channels?.includes("a") && !info.opaque);
}

function hasAlphaChannel(info) {
  return Boolean(info?.channels?.includes("a"));
}

function safeFileName(value) {
  return basename(String(value)).replace(/[^a-zA-Z0-9_.-]/g, "_");
}

function writeSummary() {
  writeFileSync(SUMMARY_PATH, JSON.stringify(summary, null, 2));
}
