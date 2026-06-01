import "dotenv/config";
import { readFileSync, readdirSync, existsSync } from "fs";
import { dirname, isAbsolute, join, resolve } from "path";
import { Graph } from "@geoprotocol/geo-sdk";
import type { Op } from "@geoprotocol/geo-sdk";
import { gql, publishOps } from "./core/graph-client.js";
import { ROOT_PROPERTIES } from "./core/constants.js";

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith("--"));
const targetArg = positional[0];

if (!targetArg) {
  console.error("Usage:");
  console.error("  npm run delete <ops-file.json>");
  console.error("  npm run delete <entity-id>");
  console.error("  npm run delete <config.json>   # reverses the latest publish for this config");
  process.exit(1);
}

const privateKey = process.env.PRIVATE_KEY as `0x${string}` | undefined;
if (!privateKey || privateKey === "0x") {
  console.error("Set PRIVATE_KEY in .env");
  process.exit(1);
}

const spaceId = process.env.SPACE_ID;
if (!spaceId) {
  console.error("Set SPACE_ID in .env");
  process.exit(1);
}

function deriveOpsFromSavedFile(filePath: string): Op[] {
  const saved = JSON.parse(readFileSync(filePath, "utf-8"));
  if (!Array.isArray(saved)) throw new Error("Ops file must be a JSON array");

  const deleteOps: Op[] = [];

  const createEntityOps = saved.filter((o: any) => o.type === "createEntity");
  const entityIds: string[] = Array.from(new Set(createEntityOps.map((o: any) => o.id)));

  for (const id of entityIds) {
    const original = createEntityOps.find((o: any) => o.id === id);
    const props: string[] = Array.from(new Set([
      ROOT_PROPERTIES.name,
      ...(original?.description ? [ROOT_PROPERTIES.description] : []),
      ...(original?.values ?? []).map((v: any) => v.property).filter(Boolean),
    ]));
    const { ops } = Graph.updateEntity({
      id,
      unset: props.map((p) => ({ property: p })),
    });
    deleteOps.push(...ops);
  }

  const relationOps = saved.filter((o: any) => o.type === "createRelation");
  const relationIds: string[] = Array.from(new Set(relationOps.map((o: any) => o.id)));
  for (const id of relationIds) {
    const { ops } = Graph.deleteRelation({ id });
    deleteOps.push(...ops);
  }

  return deleteOps;
}

async function deriveOpsFromEntityId(entityId: string): Promise<Op[]> {
  const data = await gql(
    `query($id: UUID!, $sid: UUID!) {
      values(filter: { entityId: { is: $id }, spaceId: { is: $sid } }) { propertyId }
      relations(filter: { fromEntityId: { is: $id }, spaceId: { is: $sid } }) { id }
    }`,
    { id: entityId, sid: spaceId }
  );

  const propertyIds: string[] = Array.from(
    new Set((data.values ?? []).map((v: any) => v.propertyId).filter(Boolean))
  );
  const relationIds: string[] = (data.relations ?? []).map((r: any) => r.id);

  const deleteOps: Op[] = [];
  if (propertyIds.length > 0) {
    const { ops } = Graph.updateEntity({
      id: entityId,
      unset: propertyIds.map((p) => ({ property: p })),
    });
    deleteOps.push(...ops);
  }
  for (const id of relationIds) {
    const { ops } = Graph.deleteRelation({ id });
    deleteOps.push(...ops);
  }
  return deleteOps;
}

function latestOpsFileForConfig(configPath: string): string | null {
  const baseDir = dirname(configPath);
  const opsDir = join(baseDir, "data_to_delete");
  if (!existsSync(opsDir)) return null;
  const files = readdirSync(opsDir)
    .filter((f) => f.startsWith("publish_ops_") && f.endsWith(".json"))
    .sort();
  if (files.length === 0) return null;
  return join(opsDir, files[files.length - 1]);
}

const targetPath = isAbsolute(targetArg) ? targetArg : resolve(targetArg);

let deleteOps: Op[];
let summary: string;

if (existsSync(targetPath)) {
  const isConfig = targetPath.endsWith(".json") && (() => {
    try {
      const parsed = JSON.parse(readFileSync(targetPath, "utf-8"));
      return parsed && typeof parsed === "object" && "bountyName" in parsed;
    } catch {
      return false;
    }
  })();

  if (isConfig) {
    const opsFile = latestOpsFileForConfig(targetPath);
    if (!opsFile) {
      console.error(`No saved ops file found in ${join(dirname(targetPath), "data_to_delete")}`);
      process.exit(1);
    }
    console.log(`Reversing publish using ${opsFile}`);
    deleteOps = deriveOpsFromSavedFile(opsFile);
    summary = `Reverse publish: ${(JSON.parse(readFileSync(targetPath, "utf-8")) as any).bountyName}`;
  } else {
    console.log(`Reversing ops from ${targetPath}`);
    deleteOps = deriveOpsFromSavedFile(targetPath);
    summary = `Reverse ops file: ${targetPath}`;
  }
} else if (/^[0-9a-f]{32}$/i.test(targetArg)) {
  console.log(`Deleting entity ${targetArg} in space ${spaceId}...`);
  deleteOps = await deriveOpsFromEntityId(targetArg);
  summary = `Delete entity ${targetArg}`;
} else {
  console.error(`Not a file path or 32-char entity ID: ${targetArg}`);
  process.exit(1);
}

if (deleteOps.length === 0) {
  console.log("\n  Nothing to delete.");
  process.exit(0);
}

console.log(`\n  ${deleteOps.length} ops to publish.`);

const result = await publishOps({
  ops: deleteOps,
  editName: summary,
  privateKey,
  spaceId,
});

if (result.success) {
  console.log("\n  Deleted.");
  console.log(`  Edit  : ${result.editId}`);
  console.log(`  Tx    : ${result.transactionHash}`);
} else {
  console.error(`\n  Failed: ${result.error}`);
  process.exit(1);
}
