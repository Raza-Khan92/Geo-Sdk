import "dotenv/config";
import { readFileSync, existsSync } from "fs";
import { gql } from "./sdk/core/graph-client.js";
import { TYPES } from "./sdk/core/constants.js";
import type { BountyConfig } from "./sdk/core/types.js";

const SPACE_ID = process.env.SPACE_ID ?? "";
if (!SPACE_ID) {
  console.error("Set SPACE_ID in .env");
  process.exit(1);
}

let config: BountyConfig | null = null;
if (existsSync("bounty.config.json")) {
  config = JSON.parse(readFileSync("bounty.config.json", "utf-8"));
}

async function spaceInfo(spaceId: string) {
  const data = await gql(`query($id: UUID!) {
    space(id: $id) {
      type
      address
      topic { name description }
      editorsList { memberSpaceId }
      membersList { memberSpaceId }
    }
  }`, { id: spaceId });

  const s = data?.space;
  if (!s) { console.log(`  Space ${spaceId} not found.`); return; }
  console.log(`\n  Space: ${spaceId}`);
  console.log(`  Type : ${s.type}`);
  if (s.topic?.name) console.log(`  Name : ${s.topic.name}`);
  if (s.topic?.description) console.log(`  Desc : ${s.topic.description.slice(0, 120)}`);
  console.log(`  Editors : ${s.editorsList?.length ?? 0}`);
  console.log(`  Members : ${s.membersList?.length ?? 0}`);
}

async function listByType(spaceId: string, typeId: string, typeName: string) {
  const data = await gql(`query($spaceId: UUID!, $typeId: UUID!) {
    entities(
      filter: {
        spaceIds: { contains: $spaceId }
        typeIds: { contains: $typeId }
      }
      first: 30
      orderBy: UPDATED_AT_DESC
    ) {
      id
      name
      description
    }
  }`, { spaceId, typeId });

  const items: any[] = data?.entities ?? [];
  if (items.length === 0) return;
  console.log(`\n  ${typeName} (${items.length} shown):`);
  for (const e of items) {
    const desc = e.description ? `  — ${e.description.slice(0, 60)}` : "";
    console.log(`    ${e.name} [${e.id}]${desc}`);
  }
}

async function inspectEntity(entityId: string, spaceId: string) {
  const data = await gql(`query($id: UUID!, $sid: UUID!) {
    entity(id: $id) {
      id name description
      types { id name }
    }
    values(filter: { entityId: { is: $id }, spaceId: { is: $sid } }) {
      propertyId
      text boolean integer float date datetime time
    }
    relations(filter: { fromEntityId: { is: $id }, spaceId: { is: $sid } }) {
      typeId
      toEntity { id name }
      position
    }
  }`, { id: entityId, sid: spaceId });

  const e = data?.entity;
  if (!e) { console.log(`  Entity ${entityId} not found.`); return; }

  console.log(`\n  Entity: ${e.name} [${e.id}]`);
  if (e.description) console.log(`  Description: ${e.description}`);
  if (e.types?.length) console.log(`  Types: ${e.types.map((t: any) => t.name).join(", ")}`);

  const values: any[] = data?.values ?? [];
  if (values.length > 0) {
    console.log(`\n  Values (${values.length}):`);
    for (const v of values) {
      const val = v.text ?? v.boolean ?? v.integer ?? v.float ?? v.date ?? v.datetime ?? v.time;
      console.log(`    [${v.propertyId}] = ${val}`);
    }
  }

  const relations: any[] = data?.relations ?? [];
  if (relations.length > 0) {
    console.log(`\n  Relations (${relations.length}):`);
    for (const r of relations) {
      console.log(`    [${r.typeId}] → ${r.toEntity?.name} [${r.toEntity?.id}]`);
    }
  }
}

async function main() {
  const entityId = process.argv[2];
  if (entityId && /^[0-9a-f]{32}$/i.test(entityId)) {
    await inspectEntity(entityId, SPACE_ID);
    return;
  }

  await spaceInfo(SPACE_ID);

  if (config?.types) {
    for (const [, typeDef] of Object.entries(config.types)) {
      if (typeDef.wellKnownId) {
        await listByType(SPACE_ID, typeDef.wellKnownId, typeDef.name);
      }
    }
  }

  await listByType(SPACE_ID, TYPES.topic, "Topic");
  await listByType(SPACE_ID, TYPES.person, "Person");
  await listByType(SPACE_ID, TYPES.project, "Project");
  await listByType(SPACE_ID, TYPES.company, "Company");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
