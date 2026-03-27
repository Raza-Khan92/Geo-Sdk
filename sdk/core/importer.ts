import { Graph } from "@geoprotocol/geo-sdk";
import type { Op, Id } from "@geoprotocol/geo-sdk";
import type { BountyConfig, FieldValueType, ResolvedField, ResolvedSchema } from "./types.js";
import { searchEntityByName, searchEntityByNameAndType } from "./graph-client.js";
import { TYPES } from "./constants.js";

function toGeoDataType(t: FieldValueType): string {
  switch (t) {
    case "text": case "url": return "TEXT";
    case "int64":            return "INT64";
    case "float64":          return "FLOAT64";
    case "bool":             return "BOOLEAN";
    case "date":             return "DATE";
    case "relation":         return "RELATION";
  }
}

function toGeoValueType(t: FieldValueType): "text" | "float" | "bool" | "date" {
  switch (t) {
    case "text": case "url": return "text";
    case "int64": case "float64": return "float";
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
  schema: ResolvedSchema
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

    const existingId = await searchEntityByName(name);
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
        const refName = String(raw).trim();
        const refId = await resolveRefEntity(refName, field, relationCache, ops);
        if (refId) relations[field.propertyId] = { toEntity: refId };
      } else {
        values.push({ property: field.propertyId, type: toGeoValueType(field.type), value: raw });
      }
    }

    const entity = Graph.createEntity({
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
  ops: Op[]
): Promise<Id | null> {
  if (!cache.has(field.key)) cache.set(field.key, new Map());
  const bucket = cache.get(field.key)!;

  if (bucket.has(name)) return bucket.get(name)!;

  const existing = await searchEntityByName(name);
  if (existing) {
    bucket.set(name, existing as Id);
    console.log(`    [ref-exists] "${name}" → ${existing}`);
    return existing as Id;
  }

  const entity = Graph.createEntity({
    name,
    types: field.relationEntityTypeId ? [field.relationEntityTypeId] : [],
  });
  ops.push(...entity.ops);
  bucket.set(name, entity.id);
  console.log(`    [ref-created] "${name}" (${field.label})`);
  return entity.id;
}
