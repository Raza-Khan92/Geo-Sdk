import { Graph } from "@geoprotocol/geo-sdk";
import { createHash } from "crypto";
import type { Op, Id } from "@geoprotocol/geo-sdk";
import type { BountyConfig, FieldValueType, ResolvedField, ResolvedSchema } from "./types.js";
import { searchEntityByName, searchEntityByNameAndType } from "./graph-client.js";
import { TYPES } from "./constants.js";

// Generate a deterministic UUID from a string using SHA-256 hash
function derivedUuidFromString(input: string): Id {
  const hash = createHash('sha256').update(input).digest('hex');
  // Format as UUID: 8-4-4-4-12
  const uuid = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
  return uuid as Id;
}

export function toGeoDataType(t: FieldValueType): "TEXT" | "INT64" | "FLOAT64" | "BOOLEAN" | "DATE" | "RELATION" {
  switch (t) {
    case "text": case "url": return "TEXT";
    case "int64":            return "INT64";
    case "float64":          return "FLOAT64";
    case "bool":             return "BOOLEAN";
    case "date":             return "DATE";
    case "relation":         return "RELATION";
  }
}

// Note: int64 is mapped to "float" because JavaScript's number type cannot
// safely represent all int64 values (precision loss above Number.MAX_SAFE_INTEGER).
// This is safe for small integers (e.g., year fields) but not for arbitrary int64.
export function toGeoValueType(t: FieldValueType): "text" | "float" | "bool" | "date" {
  switch (t) {
    case "text": case "url": return "text";
    case "int64": case "float64": return "float"; // JS number; unsafe for large int64
    case "bool":  return "bool";
    case "date":  return "date";
    default:      return "text";
  }
}

async function resolveProperty(label: string, dataType: string, ops: Op[]): Promise<Id> {
  const existing = await searchEntityByNameAndType(label, TYPES.property);
  if (existing) return existing as Id;
  const result = Graph.createProperty({ name: label, dataType: dataType as any });
  ops.push(...result.ops);
  return result.id;
}

async function resolveType(name: string, propertyIds: Id[], ops: Op[]): Promise<Id> {
  const existing = await searchEntityByNameAndType(name, TYPES.type);
  if (existing) return existing as Id;
  const result = Graph.createType({ name, properties: propertyIds });
  ops.push(...result.ops);
  return result.id;
}

export async function resolveSchema(config: BountyConfig): Promise<ResolvedSchema> {
  const schemaOps: Op[] = [];
  const resolvedFields: ResolvedField[] = [];
  const allPropertyIds: Id[] = [];
  const relationTypeCache = new Map<string, Id>();

  console.log("\n  Resolving schema...");

  for (const field of config.fields) {
    let propertyId: Id;

    if (field.wellKnownPropertyId) {
      propertyId = field.wellKnownPropertyId as Id;
      console.log(`    [root] ${field.label} → ${propertyId}`);
    } else {
      const dataType = toGeoDataType(field.type);
      propertyId = await resolveProperty(field.label, dataType, schemaOps);
      console.log(`    [prop] ${field.label} → ${propertyId}`);
    }

    allPropertyIds.push(propertyId);
    resolvedFields.push({
      key: field.key,
      label: field.label,
      type: field.type,
      propertyId,
      required: field.required,
    });
  }

  for (const field of config.fields) {
    if (field.type === "relation" && field.relationEntityType) {
      const typeName = field.relationEntityType;
      if (!relationTypeCache.has(typeName)) {
        const typeId = await resolveType(typeName, [], schemaOps);
        relationTypeCache.set(typeName, typeId);
        console.log(`    [reltype] ${typeName} → ${typeId}`);
      }
    }
  }

  for (const rf of resolvedFields) {
    const cfg = config.fields.find((f) => f.key === rf.key);
    if (cfg?.type === "relation" && cfg.relationEntityType) {
      rf.relationEntityTypeId = relationTypeCache.get(cfg.relationEntityType);
    }
  }

  console.log(`\n  Resolving entity type "${config.entityTypeName}"...`);
  let entityTypeId: Id;
  if (config.wellKnownEntityTypeId) {
    entityTypeId = config.wellKnownEntityTypeId as Id;
    console.log(`    [root] → ${entityTypeId}`);
  } else {
    entityTypeId = await resolveType(config.entityTypeName, allPropertyIds, schemaOps);
    console.log(`    → ${entityTypeId}`);
  }

  return { entityTypeId, fields: resolvedFields, schemaOps };
}

export async function importRecords(
  records: Record<string, unknown>[],
  schema: ResolvedSchema,
  spaceId?: string
): Promise<{ ops: Op[]; created: number; skipped: number }> {
  const ops: Op[] = [];
  let created = 0;
  let skipped = 0;

  const relationCache = new Map<string, Map<string, Id>>();

  console.log(`\n  Importing ${records.length} records...\n`);

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const name = String(record["name"] ?? "").trim();

    if (!name) {
      console.warn(`  [skip] record #${i + 1}: no "name" field`);
      skipped++;
      continue;
    }

    const missing = schema.fields
      .filter((f) => f.required && !record[f.key])
      .map((f) => f.label);
    if (missing.length) {
      console.warn(`  [skip] "${name}": missing required: ${missing.join(", ")}`);
      skipped++;
      continue;
    }

    const existingId = await searchEntityByName(name, spaceId);
    if (existingId) {
      console.log(`  [exists] "${name}" (${existingId})`);
      skipped++;
      continue;
    }

    const values: Array<{ property: Id; type: string; value: unknown }> = [];
    const relations: Record<string, { toEntity: Id }> = {};

    for (const field of schema.fields) {
      const raw = record[field.key];
      if (raw === undefined || raw === null || raw === "") continue;

      if (field.type === "relation") {
        const rawStr = String(raw).trim();
        // Only the first value is linked when a field contains comma-separated names.
        // Use separate relation fields (e.g., primaryExplorer, secondaryExplorer) for
        // multiple relations to the same property.
        const refName = rawStr.includes(",") ? rawStr.split(",")[0].trim() : rawStr;
        if (rawStr.includes(",")) {
          console.warn(
            `  [warn] "${name}".${field.key}: multiple values detected — only first ("${refName}") will be linked.`
          );
        }
        const refId = await resolveRefEntity(refName, field, relationCache, ops, spaceId);
        if (refId) relations[field.propertyId] = { toEntity: refId };
      } else {
        const valueType = toGeoValueType(field.type);
        const valueObj: any = { property: field.propertyId };
        valueObj[valueType] = raw;
        values.push(valueObj);
      }
    }

    // Use a deterministic ID derived from the entity name so re-runs are idempotent.
    // Per GRC-20 spec, CreateEntity is an upsert — the same ID will update in place.
    const entityId = derivedUuidFromString(name);
    const entity = Graph.createEntity({
      id: entityId,
      name,
      types: [schema.entityTypeId],
      values: values as any,
      relations,
    });
    ops.push(...entity.ops);
    created++;

    console.log(`  [created] "${name}" (${values.length} values, ${Object.keys(relations).length} relations)`);
  }

  return { ops, created, skipped };
}

async function resolveRefEntity(
  name: string,
  field: ResolvedField,
  cache: Map<string, Map<string, Id>>,
  ops: Op[],
  spaceId?: string
): Promise<Id | null> {
  if (!cache.has(field.key)) cache.set(field.key, new Map());
  const bucket = cache.get(field.key)!;

  if (bucket.has(name)) return bucket.get(name)!;

  const existing = await searchEntityByName(name, spaceId);
  if (existing) {
    bucket.set(name, existing as Id);
    console.log(`    [ref-exists] "${name}" → ${existing}`);
    return existing as Id;
  }

  // Creates a stub entity (name + type only). If the referenced bounty dataset has
  // already been uploaded, its full entity will be found above and this branch won't
  // run. Because a deterministic ID is used (derivedUuidFromString), if the full
  // entity is uploaded later the stub will be upserted with the complete data.
  const entityId = derivedUuidFromString(name);
  const entity = Graph.createEntity({
    id: entityId,
    name,
    types: field.relationEntityTypeId ? [field.relationEntityTypeId] : [],
  });
  ops.push(...entity.ops);
  bucket.set(name, entity.id);
  console.log(`    [ref-created] "${name}" (${field.label})`);
  return entity.id;
}
