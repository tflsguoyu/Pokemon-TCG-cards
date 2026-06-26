import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { writeLocalData } from "./version-utils.mjs";

const DATA_PATH = "local-data.js";
const DATA_PREFIX = "window.PTCG_LOCAL_DATA = ";
const CARD_DIR = "assets/cards";
const TMP_DIR = "tmp/refresh-card-images";
const SUMMARY_PATH = "tmp/refresh-card-images-summary.json";
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
    if (!result || !result.sourceUrl) continue;
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
  const candidates = await getCandidates(card);
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
    downloaded.find((item) => item.provider === "TCGdex" && hasTransparentPixels(item.info)) ||
    downloaded.find((item) => item.provider === "Scrydex" && hasTransparentPixels(item.info)) ||
    downloaded.find((item) => item.provider === "TCGdex" && item.sourcePath) ||
    downloaded.find((item) => item.provider === "Scrydex" && item.sourcePath);

  if (!selected) {
    const existingInfo = existsSync(output) ? identify(output) : null;
    return {
      id,
      index,
      status: "failed",
      provider: "Existing local",
      sourceUrl: card.image || "",
      output,
      hasTransparentPixels: hasTransparentPixels(existingInfo),
      outputSize: existingInfo?.size || "",
      reason: "No usable TCGdex or Scrydex image",
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
    hasTransparentPixels: hasTransparentPixels(outputInfo),
  };
}

async function getCandidates(card) {
  const candidates = [];
  for (const url of await getTcgdexImageUrls(card.id)) {
    candidates.push({ provider: "TCGdex", url });
  }
  for (const id of getScrydexIds(card)) {
    candidates.push({ provider: "Scrydex", url: `https://images.scrydex.com/pokemon/${id}/large` });
  }
  return candidates;
}

async function getTcgdexImageUrls(id) {
  try {
    const response = await fetch(`https://api.tcgdex.net/v2/en/cards/${encodeURIComponent(id)}`);
    if (!response.ok) return [];
    const card = await response.json();
    if (!card.image) return [];
    return [`${card.image}/high.webp`, `${card.image}/low.webp`];
  } catch {
    return [];
  }
}

function getScrydexIds(card) {
  const ids = new Set();
  const id = String(card.id || "");
  const setId = String(card.setId || "").toLowerCase();
  const number = String(card.number || card.printedNumber || "").split("/")[0];
  ids.add(id);
  ids.add(id.toLowerCase());

  const numericIdMatch = id.match(/^(.+)-(\d+)$/);
  if (numericIdMatch) ids.add(`${numericIdMatch[1]}-${Number(numericIdMatch[2])}`);

  if (setId && number) {
    ids.add(`${setId}-${number}`);
    ids.add(`${setId}-${number.toLowerCase()}`);
    const numericNumberMatch = number.match(/^0*(\d+)$/);
    if (numericNumberMatch) ids.add(`${setId}-${Number(numericNumberMatch[1])}`);
    const alphaNumberMatch = number.match(/^([a-z]+)0*(\d+)$/i);
    if (alphaNumberMatch) ids.add(`${setId}-${alphaNumberMatch[1].toLowerCase()}${Number(alphaNumberMatch[2])}`);
  }

  return Array.from(ids);
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

function safeFileName(value) {
  return basename(String(value)).replace(/[^a-zA-Z0-9_.-]/g, "_");
}

function writeSummary() {
  writeFileSync(SUMMARY_PATH, JSON.stringify(summary, null, 2));
}
