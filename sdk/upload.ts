import "dotenv/config";
import { readFileSync, readdirSync } from "fs";
import { join, resolve } from "path";
import type { BountyConfig } from "./core/types.js";
import { resolveSchema, importRecords } from "./core/importer.js";
import { publishOps } from "./core/graph-client.js";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const bountyArg = args.find((a) => !a.startsWith("--"));

if (!bountyArg) {
  console.error("Usage: npx tsx sdk/upload.ts <bounty-folder> [--dry-run]");
  process.exit(1);
}

const bountyDir = resolve(bountyArg);
const files = readdirSync(bountyDir).filter((f) => f.endsWith(".json"));

if (files.length === 0) {
  console.error(`No JSON files found in ${bountyDir}`);
  process.exit(1);
}

let config: BountyConfig | undefined;
let records: Record<string, unknown>[] | undefined;

for (const file of files) {
  const parsed = JSON.parse(readFileSync(join(bountyDir, file), "utf-8"));
  if (Array.isArray(parsed)) {
    records = parsed;
  } else if (parsed && typeof parsed === "object" && parsed.bountyName) {
    config = parsed as BountyConfig;
  }
}

if (!config) {
  console.error(`No config file found in ${bountyDir} (needs an object with "bountyName")`);
  process.exit(1);
}
if (!records) {
  console.error(`No data file found in ${bountyDir} (needs a JSON array)`);
  process.exit(1);
}

console.log("═══════════════════════════════════════════════════");
console.log(`  ${config.bountyName}`);
console.log(`  Records : ${records.length}${dryRun ? "  [DRY RUN]" : ""}`);
console.log("═══════════════════════════════════════════════════");

console.log("\nStep 1 — Resolving schema...");
const schema = await resolveSchema(config);

console.log("\nStep 2 — Building entity ops...");
const { ops: entityOps, created, skipped } = await importRecords(records, schema);

const allOps = [...schema.schemaOps, ...entityOps];

console.log("\n───────────────────────────────────────────────────");
console.log(`  Total ops : ${allOps.length}`);
console.log(`  Created   : ${created}`);
console.log(`  Skipped   : ${skipped} (already in Geo)`);
console.log("───────────────────────────────────────────────────");

if (allOps.length === 0) {
  console.log("\n  Nothing new to publish.");
  process.exit(0);
}

if (dryRun) {
  console.log("\n  Dry run — not publishing. Remove --dry-run to publish.");
  process.exit(0);
}

const privateKey = process.env.PRIVATE_KEY as `0x${string}` | undefined;
if (!privateKey || privateKey === "0x") {
  console.error("\n  Set PRIVATE_KEY in .env (from https://www.geobrowser.io/export-wallet)");
  process.exit(1);
}

console.log("\nStep 3 — Publishing...");
const result = await publishOps({
  ops: allOps,
  editName: config.editName,
  privateKey,
  spaceId: process.env.SPACE_ID,
});

if (result.success) {
  console.log("\n  Published!");
  console.log(`  Space : ${result.spaceId}`);
  console.log(`  Edit  : ${result.editId}`);
  console.log(`  CID   : ${result.cid}`);
  console.log(`  Tx    : ${result.transactionHash}`);
} else {
  console.error(`\n  Failed: ${result.error}`);
  process.exit(1);
}
