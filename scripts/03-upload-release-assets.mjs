#!/usr/bin/env node

import { existsSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

const CARD_DIR = "assets/cards";
const REPOSITORY = "tflsguoyu/Pokemon-TCG-cards";
const GROUPS = [
  {
    key: "sv",
    tag: "card-assets-sv",
    title: "PTCG card assets - Scarlet & Violet",
    test: /^(sv|svp|csv|cs|cbb|151c)/i,
  },
  {
    key: "swsh-me",
    tag: "card-assets-swsh-me",
    title: "PTCG card assets - Sword & Shield / Mega Evolution",
    test: /^(swsh|me|mep)/i,
  },
  {
    key: "legacy",
    tag: "card-assets-legacy",
    title: "PTCG card assets - Legacy",
    test: /./,
  },
];
const BATCH_SIZE = Number(process.env.RELEASE_UPLOAD_BATCH_SIZE || 20);
const RATE_LIMIT_DELAY_MS = Number(process.env.RELEASE_UPLOAD_RATE_LIMIT_DELAY_MS || 180000);

const execute = process.argv.includes("--execute");

if (!existsSync(CARD_DIR)) {
  throw new Error(`Missing ${CARD_DIR}`);
}

const files = readdirSync(CARD_DIR)
  .filter((file) => file.endsWith(".webp"))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

const grouped = new Map(GROUPS.map((group) => [group.key, []]));
for (const file of files) {
  const group = GROUPS.find((candidate) => candidate.test.test(file));
  grouped.get(group.key).push(`${CARD_DIR}/${file}`);
}

for (const group of GROUPS) {
  const assets = grouped.get(group.key);
  console.log(`${group.tag}: ${assets.length} assets`);
  if (assets.length > 1000) {
    throw new Error(`${group.tag} has ${assets.length} assets, which exceeds GitHub's 1000 assets per release limit.`);
  }
}

if (!execute) {
  console.log("\nDry run only. Run with --execute after signing in with GitHub CLI.");
  process.exit(0);
}

for (const group of GROUPS) {
  ensureRelease(group);
  const uploadedNames = getReleaseAssetNames(group.tag);
  const assets = grouped.get(group.key).filter((assetPath) => !uploadedNames.has(getFileName(assetPath)));
  console.log(`${group.tag}: ${uploadedNames.size} already uploaded, ${assets.length} remaining`);
  for (let index = 0; index < assets.length; index += BATCH_SIZE) {
    const batch = assets.slice(index, index + BATCH_SIZE);
    await uploadBatch(group.tag, batch);
    console.log(`Uploaded ${Math.min(index + BATCH_SIZE, assets.length)} / ${assets.length} to ${group.tag}`);
  }
}

function ensureRelease(group) {
  const view = spawnSync("gh", ["release", "view", group.tag, "--repo", REPOSITORY], { stdio: "ignore" });
  if (view.status === 0) return;

  run("gh", [
    "release",
    "create",
    group.tag,
    "--repo",
    REPOSITORY,
    "--title",
    group.title,
    "--notes",
    "Static card image assets used by GitHub Pages.",
  ]);
}

function getReleaseAssetNames(tag) {
  const idResult = spawnSync("gh", ["api", `/repos/${REPOSITORY}/releases/tags/${tag}`, "--jq", ".id"], {
    encoding: "utf8",
  });
  if (idResult.status !== 0) return new Set();

  const releaseId = idResult.stdout.trim();
  const assetResult = spawnSync(
    "gh",
    ["api", "--paginate", `/repos/${REPOSITORY}/releases/${releaseId}/assets`, "--jq", ".[].name"],
    { encoding: "utf8" }
  );
  if (assetResult.status !== 0) return new Set();
  return new Set(assetResult.stdout.split("\n").map((line) => line.trim()).filter(Boolean));
}

async function uploadBatch(tag, batch) {
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const result = spawnSync("gh", ["release", "upload", tag, ...batch, "--repo", REPOSITORY, "--clobber"], {
      encoding: "utf8",
    });
    process.stdout.write(result.stdout || "");
    process.stderr.write(result.stderr || "");

    if (result.status === 0) return;

    const output = `${result.stdout || ""}\n${result.stderr || ""}`;
    if (!/secondary rate limit|rate limit/i.test(output) || attempt === 6) {
      throw new Error(`gh release upload ${tag} failed with exit code ${result.status}`);
    }

    const delayMinutes = Math.round(RATE_LIMIT_DELAY_MS / 60000);
    console.log(`Rate limited while uploading ${tag}. Waiting ${delayMinutes} minutes before retry ${attempt + 1}/6.`);
    await delay(RATE_LIMIT_DELAY_MS);
  }
}

function getFileName(assetPath) {
  return assetPath.split("/").pop();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}
