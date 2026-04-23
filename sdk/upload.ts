import "dotenv/config";
import { readFileSync, readdirSync } from "fs";
import { join, resolve } from "path";
import { createPublicClient, http } from "viem";
import { getSmartAccountWalletClient, personalSpace } from "@geoprotocol/geo-sdk";
import { SpaceRegistryAbi } from "@geoprotocol/geo-sdk/abis";
import { TESTNET } from "@geoprotocol/geo-sdk/contracts";
import { TESTNET_RPC_URL } from "./core/constants.js";
import type { BountyConfig } from "./core/types.js";
import { resolveSchema, importRecords } from "./core/importer.js";
import { publishOps } from "./core/graph-client.js";

async function resolveSpaceId(privateKey: `0x${string}`): Promise<string> {
  const walletClient = await getSmartAccountWalletClient({ privateKey });
  const address = walletClient.account!.address;
  const publicClient = createPublicClient({ transport: http(TESTNET_RPC_URL) });

  const hasSpace = await personalSpace.hasSpace({ address });
  if (!hasSpace) {
    console.log("  Creating personal space...");
    const { to, calldata } = personalSpace.createSpace();
    const tx = await walletClient.sendTransaction({ to, data: calldata });
    await publicClient.waitForTransactionReceipt({ hash: tx });
  }

  const spaceIdHex = (await publicClient.readContract({
    address: TESTNET.SPACE_REGISTRY_ADDRESS,
    abi: SpaceRegistryAbi,
    functionName: "addressToSpaceId",
    args: [address],
  })) as `0x${string}`;

  return spaceIdHex.slice(2, 34).toLowerCase();
}

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
    if (records) console.warn(`  [warn] Multiple data files found — overwriting with ${file}`);
    records = parsed;
  } else if (parsed && typeof parsed === "object" && parsed.bountyName) {
    if (config) console.warn(`  [warn] Multiple config files found — overwriting with ${file}`);
    config = parsed as BountyConfig;
  } else {
    console.warn(`  [warn] Unrecognised JSON file skipped: ${file} (not an array and has no "bountyName" key)`);
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

let spaceId = process.env.SPACE_ID;
if (!spaceId) {
  if (dryRun) {
    console.error("\n  SPACE_ID must be set for dry run (or set PRIVATE_KEY to resolve personal space)");
    process.exit(1);
  }
  const privateKey = process.env.PRIVATE_KEY as `0x${string}` | undefined;
  if (!privateKey || privateKey === "0x") {
    console.error("\n  Set PRIVATE_KEY in .env to resolve personal space (or set SPACE_ID)");
    process.exit(1);
  }
  console.log("\nResolving personal space...");
  spaceId = await resolveSpaceId(privateKey);
  console.log(`  Space: ${spaceId}`);
}

console.log("\nStep 1 — Resolving schema...");
const schema = await resolveSchema(config, spaceId);

console.log("\nStep 2 — Building entity ops...");
const { ops: entityOps, created, skipped } = await importRecords(records, schema, spaceId);

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
  spaceId,
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
