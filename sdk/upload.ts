import "dotenv/config";
import { readFileSync, existsSync } from "fs";
import { dirname, isAbsolute, join, resolve } from "path";
import { createPublicClient, http } from "viem";
import {
  getSmartAccountWalletClient,
  personalSpace,
  TESTNET_RPC_URL,
} from "@geoprotocol/geo-sdk";
import { SpaceRegistryAbi } from "@geoprotocol/geo-sdk/abis";
import { TESTNET } from "@geoprotocol/geo-sdk/contracts";
import type { BountyConfig } from "./core/types.js";
import { buildOps } from "./core/importer.js";
import { validateBounty } from "./core/validate.js";
import { publishOps, saveOps, printOpsSummary } from "./core/graph-client.js";

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
const positional = args.filter((a) => !a.startsWith("--"));
const configArg = positional[0] ?? "bounty.config.json";
const configPath = isAbsolute(configArg) ? configArg : resolve(configArg);

if (!existsSync(configPath)) {
  console.error(`Config file not found: ${configPath}`);
  console.error("Usage: npm run upload [config.json] [--dry-run]");
  process.exit(1);
}

const config: BountyConfig = JSON.parse(readFileSync(configPath, "utf-8"));
const baseDir = dirname(configPath);
const dataDir = join(baseDir, "data");

console.log("═══════════════════════════════════════════════════");
console.log(`  ${config.bountyName}${dryRun ? "  [DRY RUN]" : ""}`);
console.log(`  Config: ${configPath}`);
console.log(`  Data:   ${dataDir}`);
console.log("═══════════════════════════════════════════════════");

const dataBySource: Record<string, any[]> = {};
for (const [sourceName, source] of Object.entries(config.sources)) {
  const filePath = join(dataDir, source.file);
  if (!existsSync(filePath)) {
    console.error(`\n  Data file not found: ${filePath} (source "${sourceName}")`);
    process.exit(1);
  }
  const parsed = JSON.parse(readFileSync(filePath, "utf-8"));
  if (!Array.isArray(parsed)) {
    console.error(`\n  Data file must be a JSON array: ${filePath}`);
    process.exit(1);
  }
  dataBySource[sourceName] = parsed;
}

console.log("\nStep 0 — Validating records...");
const validation = validateBounty(config, dataBySource);

if (validation.warnings.length > 0) {
  console.log(`\n  Warnings (${validation.warnings.length}):`);
  for (const w of validation.warnings) {
    console.log(`    ! [${w.source}] ${w.name} → ${w.field}: ${w.message}`);
  }
}

if (!validation.valid) {
  console.error(`\n  Validation failed (${validation.errors.length} errors):`);
  for (const e of validation.errors) {
    console.error(`    × [${e.source}] ${e.name} → ${e.field}: ${e.message}`);
  }
  process.exit(1);
}

const totalRecords = Object.values(dataBySource).reduce((s, arr) => s + arr.length, 0);
console.log(`  ${totalRecords} records OK across ${Object.keys(dataBySource).length} sources.`);

let spaceId = process.env.SPACE_ID;
if (!spaceId) {
  if (dryRun) {
    console.error("\n  SPACE_ID must be set in .env for dry-run schema resolution.");
    process.exit(1);
  }
  const privateKey = process.env.PRIVATE_KEY as `0x${string}` | undefined;
  if (!privateKey || privateKey === "0x") {
    console.error("\n  Set PRIVATE_KEY in .env");
    process.exit(1);
  }
  console.log("\nResolving personal space...");
  spaceId = await resolveSpaceId(privateKey);
  console.log(`  Space: ${spaceId}`);
}

console.log("\nStep 1 — Building ops...");
let buildResult;
try {
  buildResult = await buildOps(config, dataDir, spaceId);
} catch (err) {
  console.error(`\n  Build failed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}

const { ops, stats } = buildResult;

console.log("\n───────────────────────────────────────────────────");
console.log("  Build summary");
console.log("───────────────────────────────────────────────────");
console.log(`  Properties created: ${stats.properties}`);
console.log(`  Types created     : ${stats.types}`);
console.log(`  Enums created     : ${stats.enums}`);
console.log(`  Entities created  : ${stats.entities}`);
console.log(`  Entities enriched : ${stats.enriched}`);
console.log(`  Relations created : ${stats.relations}`);
console.log(`  Text blocks       : ${stats.blocks}`);
console.log(`  Data blocks       : ${stats.dataBlocks}`);
console.log(`  Images uploaded   : ${stats.images}`);
console.log(`  Reused entities   : ${stats.reused}`);
printOpsSummary(ops);
console.log("───────────────────────────────────────────────────");

if (ops.length === 0) {
  console.log("\n  Nothing new to publish.");
  process.exit(0);
}

saveOps(ops, join(baseDir, "data_to_delete"), `publish_ops_${Date.now()}.json`);

if (dryRun) {
  console.log("\n  Dry run complete. Remove --dry-run to publish.");
  process.exit(0);
}

const privateKey = process.env.PRIVATE_KEY as `0x${string}` | undefined;
if (!privateKey || privateKey === "0x") {
  console.error("\n  Set PRIVATE_KEY in .env");
  process.exit(1);
}

console.log("\nStep 2 — Publishing...");
const result = await publishOps({
  ops,
  editName: config.editName,
  privateKey,
  spaceId,
});

if (result.success) {
  console.log("\n  Published.");
  console.log(`  Space : ${result.spaceId}`);
  console.log(`  Edit  : ${result.editId}`);
  console.log(`  CID   : ${result.cid}`);
  console.log(`  Tx    : ${result.transactionHash}`);
  console.log(`\n  Verify: https://www.geobrowser.io/space/${result.spaceId}`);
} else {
  console.error(`\n  Failed: ${result.error}`);
  process.exit(1);
}
