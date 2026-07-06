import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { normalizeCardImageFileNameFromId } from "./lib-card-image-paths.mjs";

const DEFAULT_CACHE_DIR = join(
  process.env.HOME || "",
  "Library/Containers/pedrommcarrasco.Dex/Data/Library/Caches/com.onevcat.Kingfisher.ImageCache.default"
);
const CARD_DIR = "assets/cards";
const TMP_DIR = "tmp/dex-cache-import";
const IMAGE_HEIGHT = 825;

const args = process.argv.slice(2);
const options = parseArgs(args);
const cacheDir = resolve(options.cacheDir || DEFAULT_CACHE_DIR);

if (options.help || args.length === 0) {
  printHelp();
  process.exit(0);
}

if (!existsSync(cacheDir)) {
  fail(`Dex cache not found: ${cacheDir}`);
}

mkdirSync(TMP_DIR, { recursive: true });

if (options.clearCache) {
  if (!options.yes) fail("Refusing to clear Dex cache without --yes.");
  for (const name of readdirSync(cacheDir)) {
    rmSync(join(cacheDir, name), { recursive: true, force: true });
  }
  console.log(`Cleared Dex cache: ${cacheDir}`);
  process.exit(0);
}

const recentFiles = getRecentImageFiles(cacheDir, options);

if (options.list) {
  for (const item of recentFiles) {
    console.log([item.name, item.width, item.height, item.size, new Date(item.mtimeMs).toISOString()].join("\t"));
  }
}

if (options.sheet) {
  if (!recentFiles.length) fail("No matching Dex cache images found for contact sheet.");
  const sheetPath = options.sheetPath || join(TMP_DIR, "contact-sheet.jpg");
  const contactDir = join(TMP_DIR, "contact");
  mkdirSync(contactDir, { recursive: true });
  const copied = recentFiles.map((item, index) => {
    const target = join(contactDir, `${String(index + 1).padStart(3, "0")}_${item.name}.png`);
    copyFileSync(item.path, target);
    return target;
  });
  execFileSync("magick", [
    "montage",
    ...copied,
    "-thumbnail",
    "160x224",
    "-label",
    "%f",
    "-tile",
    "5x",
    "-geometry",
    "+8+24",
    sheetPath,
  ]);
  console.log(`Wrote ${sheetPath}`);
}

for (const item of options.imports) {
  const source = resolveCacheFile(cacheDir, item.cacheName);
  const output = join(CARD_DIR, normalizeCardImageFileNameFromId(item.cardId));
  mkdirSync(CARD_DIR, { recursive: true });
  execFileSync("magick", [source, "-resize", `x${IMAGE_HEIGHT}`, "-quality", "92", output]);
  const info = identify(output);
  console.log(`${item.cardId}\t${info.width}x${info.height}\t${output}`);
}

function parseArgs(values) {
  const parsed = {
    cacheDir: "",
    list: false,
    sheet: false,
    sheetPath: "",
    imports: [],
    minutes: 60,
    minBytes: 300_000,
    width: 612,
    height: 853,
    limit: 80,
    clearCache: false,
    yes: false,
    help: false,
  };

  for (let index = 0; index < values.length; index += 1) {
    const arg = values[index];
    if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--clear-cache") parsed.clearCache = true;
    else if (arg === "--yes") parsed.yes = true;
    else if (arg === "--list") parsed.list = true;
    else if (arg === "--sheet") parsed.sheet = true;
    else if (arg === "--cache-dir") parsed.cacheDir = values[++index] || "";
    else if (arg === "--sheet-path") parsed.sheetPath = values[++index] || "";
    else if (arg === "--minutes") parsed.minutes = Number(values[++index] || parsed.minutes);
    else if (arg === "--min-bytes") parsed.minBytes = Number(values[++index] || parsed.minBytes);
    else if (arg === "--width") parsed.width = Number(values[++index] || parsed.width);
    else if (arg === "--height") parsed.height = Number(values[++index] || parsed.height);
    else if (arg === "--limit") parsed.limit = Number(values[++index] || parsed.limit);
    else if (arg === "--import") {
      const pair = values[++index] || "";
      const [cardId, cacheName] = pair.split("=");
      if (!cardId || !cacheName) fail(`Invalid --import value: ${pair}`);
      parsed.imports.push({ cardId, cacheName });
    } else if (/^[^=]+=.+$/.test(arg)) {
      const [cardId, cacheName] = arg.split("=");
      parsed.imports.push({ cardId, cacheName });
    } else {
      fail(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function getRecentImageFiles(directory, opts) {
  const now = Date.now();
  return readdirSync(directory)
    .map((name) => {
      const path = join(directory, name);
      const stats = statSync(path);
      if (!stats.isFile()) return null;
      if (stats.size < opts.minBytes) return null;
      const ageMinutes = Math.round((now - stats.mtimeMs) / 60000);
      if (opts.minutes > 0 && ageMinutes > opts.minutes) return null;
      return { name, path, size: stats.size, ageMinutes, mtimeMs: stats.mtimeMs };
    })
    .filter(Boolean)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, Math.max(opts.limit * 30, 200))
    .map((item) => ({ ...item, ...identify(item.path) }))
    .filter((item) => {
      if (!item.width || !item.height) return false;
      if (opts.width > 0 && item.width !== opts.width) return false;
      if (opts.height > 0 && item.height !== opts.height) return false;
      return true;
    })
    .slice(0, opts.limit);
}

function resolveCacheFile(directory, name) {
  const direct = resolve(name);
  if (existsSync(direct)) return direct;
  const fromCache = join(directory, basename(name));
  if (existsSync(fromCache)) return fromCache;
  fail(`Cache file not found: ${name}`);
}

function identify(path) {
  try {
    const output = execFileSync("magick", ["identify", "-format", "%w %h", path], { encoding: "utf8" });
    const [width, height] = output.trim().split(/\s+/).map(Number);
    return { width, height };
  } catch {
    return { width: 0, height: 0 };
  }
}

function printHelp() {
  console.log(`Usage:
  node scripts/tool-import-dex-cache-image.mjs --list
  node scripts/tool-import-dex-cache-image.mjs --sheet
  node scripts/tool-import-dex-cache-image.mjs --clear-cache --yes
  node scripts/tool-import-dex-cache-image.mjs mep-055=11b95f8090bdfb0640b0e0bd5ef9f1f3

Options:
  --clear-cache    Delete all files in the Dex Kingfisher image cache. Requires --yes
  --yes            Confirm destructive options
  --minutes N       Only scan images modified in the last N minutes. Default: 60
  --width N         Filter by pixel width. Default: 612
  --height N        Filter by pixel height. Default: 853
  --min-bytes N     Filter tiny thumbnails. Default: 300000
  --limit N         Maximum files to list or put on sheet. Default: 80
  --sheet-path PATH Contact sheet output. Default: tmp/dex-cache-import/contact-sheet.jpg
  --cache-dir PATH  Override Dex Kingfisher cache path

Open the target card in Dex first, then list or sheet the recent cache files.
Imported images are written to assets/cards/{cardId}.webp at height ${IMAGE_HEIGHT}.`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
