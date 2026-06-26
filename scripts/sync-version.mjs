import { readLocalData, syncProjectVersion, writeLocalData } from "./version-utils.mjs";

const shouldBump = process.argv.includes("--bump");
const data = readLocalData();

if (shouldBump) {
  const version = writeLocalData(data);
  console.log(JSON.stringify({ version, bumped: true }, null, 2));
} else {
  syncProjectVersion(data.version);
  console.log(JSON.stringify({ version: data.version, bumped: false }, null, 2));
}
