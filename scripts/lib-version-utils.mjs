import { readFileSync, writeFileSync } from "node:fs";

export const DATA_PATH = "local-data.js";
export const DATA_PREFIX = "window.PTCG_LOCAL_DATA = ";

export function readLocalData(path = DATA_PATH) {
  return JSON.parse(readFileSync(path, "utf8").slice(DATA_PREFIX.length).replace(/;\s*$/, ""));
}

export function writeLocalData(data, { bump = true, sortCards = true } = {}) {
  if (bump) {
    data.version = Number(data.version || 0) + 1;
    data.generatedAt = new Date().toISOString();
  }
  if (sortCards) {
    data.cardsByDex?.sort((a, b) => Number(a[0]) - Number(b[0]));
  }

  writeFileSync(DATA_PATH, `${DATA_PREFIX}${JSON.stringify(data)};\n`);
  syncProjectVersion(data.version);
  return data.version;
}

export function syncProjectVersion(version) {
  const normalized = Number(version);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    throw new Error(`Invalid project version: ${version}`);
  }

  updateFile("app.js", (text) => text.replace(/const CACHE_VERSION = \d+;/, `const CACHE_VERSION = ${normalized};`));
  updateFile("tags.js", (text) => text.replace(/const CACHE_VERSION = \d+;/, `const CACHE_VERSION = ${normalized};`));
  updateFile("sw.js", (text) =>
    text
      .replace(/ptcg-national-dex-v\d+/g, `ptcg-national-dex-v${normalized}`)
      .replace(/(\.\/(?:form-index|local-data|app|tags)\.js\?v=)\d+/g, `$1${normalized}`)
      .replace(/(\.\/(?:styles|tags)\.css\?v=)\d+/g, `$1${normalized}`)
  );
  updateFile("index.html", (text) => text.replace(/(\.\/(?:styles\.css|form-index\.js|local-data\.js|app\.js)\?v=)\d+/g, `$1${normalized}`));
  updateFile("tags.html", (text) => text.replace(/(\.\/(?:tags\.css|local-data\.js|tags\.js)\?v=)\d+/g, `$1${normalized}`));
  updateFile("review.html", (text) => text.replace(/(\.\/(?:review\.css|local-data\.js|review\.js)\?v=)\d+/g, `$1${normalized}`));
}

function updateFile(path, transform) {
  const before = readFileSync(path, "utf8");
  const after = transform(before);
  if (after !== before) writeFileSync(path, after);
}
