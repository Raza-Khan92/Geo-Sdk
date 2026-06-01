import { Graph, Position, type Op } from "@geoprotocol/geo-sdk";
import type { Id } from "@geoprotocol/geo-sdk";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import type {
  BountyConfig,
  BuildResult,
  BuildStats,
  FieldType,
  SchemaMaps,
  SourceDef,
} from "./types.js";
import {
  searchEntityByName,
  searchEntityByNameAndType,
  getEntitySnapshot,
} from "./graph-client.js";
import {
  TYPES,
  ROOT_PROPERTIES,
  ROOT_PROPERTY_TYPES,
  DATA_TYPE_MAP,
  VALUE_TYPE_MAP,
  QUERY_DATA_SOURCE,
  COLLECTION_DATA_SOURCE,
  VIEWS,
} from "./constants.js";

export async function resolveSchema(
  config: BountyConfig,
  spaceId: string
): Promise<SchemaMaps> {
  const schemaOps: Op[] = [];
  const propertyIds = new Map<string, Id>();
  const propertyTypes = new Map<string, FieldType>();
  const typeIds = new Map<string, Id>();
  const enumIds = new Map<string, Id>();
  let createdProperties = 0;
  let createdTypes = 0;
  let createdEnums = 0;

  for (const [key, id] of Object.entries(ROOT_PROPERTIES)) {
    propertyIds.set(key, id as Id);
  }
  for (const [key, type] of Object.entries(ROOT_PROPERTY_TYPES)) {
    propertyTypes.set(key, type);
  }

  if (config.properties) {
    for (const [key, prop] of Object.entries(config.properties)) {
      if (prop.wellKnownId) {
        propertyIds.set(key, prop.wellKnownId as Id);
        console.log(`    [property:wellknown] ${prop.label} → ${prop.wellKnownId}`);
      } else {
        const existing = await searchEntityByNameAndType(prop.label, TYPES.property, spaceId);
        if (existing) {
          propertyIds.set(key, existing as Id);
          console.log(`    [property:reuse] ${prop.label} → ${existing}`);
        } else {
          const result = Graph.createProperty({
            name: prop.label,
            dataType: DATA_TYPE_MAP[prop.type] as any,
          });
          schemaOps.push(...result.ops);
          propertyIds.set(key, result.id);
          createdProperties++;
          console.log(`    [property:new] ${prop.label} → ${result.id}`);
        }
      }
      propertyTypes.set(key, prop.type);
    }
  }

  if (config.types) {
    for (const [key, typeDef] of Object.entries(config.types)) {
      if (typeDef.wellKnownId) {
        typeIds.set(key, typeDef.wellKnownId as Id);
        console.log(`    [type:wellknown] ${typeDef.name} → ${typeDef.wellKnownId}`);
      } else {
        const existing = await searchEntityByNameAndType(typeDef.name, TYPES.type, spaceId);
        if (existing) {
          typeIds.set(key, existing as Id);
          console.log(`    [type:reuse] ${typeDef.name} → ${existing}`);
        } else {
          const propIds = typeDef.properties
            .map((k) => propertyIds.get(k))
            .filter(Boolean) as Id[];
          const result = Graph.createType({
            name: typeDef.name,
            properties: propIds,
          });
          schemaOps.push(...result.ops);
          typeIds.set(key, result.id);
          createdTypes++;
          console.log(`    [type:new] ${typeDef.name} → ${result.id}`);
        }
      }
    }
  }

  if (config.enums) {
    for (const enumDef of config.enums) {
      const typeId = typeIds.get(enumDef.type);
      if (!typeId) {
        console.warn(`    [enum:skip] "${enumDef.name}": type "${enumDef.type}" not resolved`);
        continue;
      }

      if (enumDef.wellKnownId) {
        enumIds.set(enumDef.name, enumDef.wellKnownId as Id);
        console.log(`    [enum:wellknown] ${enumDef.name} → ${enumDef.wellKnownId}`);
      } else {
        const existing = await searchEntityByNameAndType(enumDef.name, typeId, spaceId);
        if (existing) {
          enumIds.set(enumDef.name, existing as Id);
          console.log(`    [enum:reuse] ${enumDef.name} → ${existing}`);
        } else {
          const result = Graph.createEntity({
            name: enumDef.name,
            types: [typeId],
          });
          schemaOps.push(...result.ops);
          enumIds.set(enumDef.name, result.id);
          createdEnums++;
          console.log(`    [enum:new] ${enumDef.name} → ${result.id}`);
        }
      }
    }
  }

  return {
    schemaOps,
    propertyIds,
    propertyTypes,
    typeIds,
    enumIds,
    createdProperties,
    createdTypes,
    createdEnums,
  };
}

function coerceValue(value: unknown, valueType: string): unknown {
  if (valueType === "integer") {
    const num = Number(value);
    if (Number.isNaN(num)) return null;
    return Math.trunc(num);
  }
  if (valueType === "float") {
    const num = Number(value);
    if (Number.isNaN(num)) return null;
    return num;
  }
  if (valueType === "boolean") return Boolean(value);
  if (valueType === "date" || valueType === "datetime" || valueType === "time") return String(value);
  return String(value);
}

function buildValues(
  record: Record<string, unknown>,
  source: SourceDef,
  schema: SchemaMaps
): Array<{ property: Id; type: string; value: unknown }> {
  const values: Array<{ property: Id; type: string; value: unknown }> = [];
  if (!source.fields) return values;

  for (const [jsonField, propKey] of Object.entries(source.fields)) {
    const raw = record[jsonField];
    if (raw === undefined || raw === null || raw === "") continue;

    const propId = schema.propertyIds.get(propKey);
    const fieldType = schema.propertyTypes.get(propKey);
    if (!propId || !fieldType) continue;

    const valueType = VALUE_TYPE_MAP[fieldType];
    if (!valueType) continue;

    const coerced = coerceValue(raw, valueType);
    if (coerced === null) continue;

    values.push({ property: propId, type: valueType, value: coerced });
  }

  return values;
}

function buildRelations(
  record: Record<string, unknown>,
  source: SourceDef,
  schema: SchemaMaps,
  entityIdsBySource: Record<string, Map<string, Id>>
): Record<string, { toEntity: Id } | Array<{ toEntity: Id }>> {
  const relations: Record<string, { toEntity: Id } | Array<{ toEntity: Id }>> = {};
  if (!source.relations) return relations;

  for (const [jsonField, relDef] of Object.entries(source.relations)) {
    const raw = record[jsonField];
    if (raw === undefined || raw === null) continue;

    const propId = schema.propertyIds.get(relDef.property);
    if (!propId) continue;

    const names = Array.isArray(raw) ? raw : [raw];
    const targets: Array<{ toEntity: Id }> = [];

    for (const n of names) {
      const name = String(n).trim();
      if (!name) continue;
      const targetMap = entityIdsBySource[relDef.source];
      const targetId = targetMap?.get(name) ?? schema.enumIds.get(name);
      if (targetId) targets.push({ toEntity: targetId });
    }

    if (targets.length === 1) relations[propId] = targets[0];
    else if (targets.length > 1) relations[propId] = targets;
  }

  return relations;
}

export async function buildOps(
  config: BountyConfig,
  dataDir: string,
  spaceId: string
): Promise<BuildResult> {
  const stats: BuildStats = {
    properties: 0,
    types: 0,
    enums: 0,
    entities: 0,
    relations: 0,
    blocks: 0,
    dataBlocks: 0,
    images: 0,
    reused: 0,
    enriched: 0,
  };

  console.log("\n  Resolving schema...");
  const schema = await resolveSchema(config, spaceId);
  stats.properties = schema.createdProperties;
  stats.types = schema.createdTypes;
  stats.enums = schema.createdEnums;

  const entityIdsBySource: Record<string, Map<string, Id>> = {};
  const lastPosByEntity: Record<string, string> = {};

  if (config.enums) {
    for (const enumDef of config.enums) {
      const id = schema.enumIds.get(enumDef.name);
      if (!id) continue;
      if (!entityIdsBySource[enumDef.source]) entityIdsBySource[enumDef.source] = new Map();
      entityIdsBySource[enumDef.source].set(enumDef.name, id);
    }
  }

  if (config.existingEntities) {
    for (const [sourceName, mapping] of Object.entries(config.existingEntities)) {
      if (!entityIdsBySource[sourceName]) entityIdsBySource[sourceName] = new Map();
      for (const [name, id] of Object.entries(mapping)) {
        entityIdsBySource[sourceName].set(name, id as Id);
      }
    }
  }

  const entityOps: Op[] = [];
  const sortedSources = Object.entries(config.sources).sort(
    ([, a], [, b]) => (a.order ?? 0) - (b.order ?? 0)
  );

  for (const [sourceName, source] of sortedSources) {
    const filePath = join(dataDir, source.file);
    if (!existsSync(filePath)) {
      throw new Error(`Source file not found: ${filePath} (source "${sourceName}")`);
    }

    let records: Record<string, unknown>[];
    try {
      records = JSON.parse(readFileSync(filePath, "utf-8"));
    } catch (err) {
      throw new Error(`Failed to parse ${filePath}: ${err instanceof Error ? err.message : err}`);
    }
    if (!Array.isArray(records)) {
      throw new Error(`Source file ${filePath} must contain a JSON array`);
    }

    if (!entityIdsBySource[sourceName]) entityIdsBySource[sourceName] = new Map();
    const idMap = entityIdsBySource[sourceName];

    const sourceTypeId = source.type ? schema.typeIds.get(source.type) : undefined;
    if (source.type && !sourceTypeId) {
      console.warn(`\n  [source:skip] "${sourceName}": type "${source.type}" not resolved`);
      continue;
    }

    console.log(`\n  Processing "${sourceName}" (${records.length} records from ${source.file})...`);

    for (const record of records) {
      const name = record?.name ? String(record.name).trim() : "";
      if (!name) {
        console.warn(`    [skip] record with no name`);
        continue;
      }

      if (idMap.has(name)) {
        stats.reused++;
        continue;
      }

      const existing = sourceTypeId
        ? await searchEntityByNameAndType(name, sourceTypeId, spaceId)
        : source.checkDuplicates
          ? await searchEntityByName(name, spaceId)
          : null;

      if (existing) {
        idMap.set(name, existing as Id);

        const snapshot = await getEntitySnapshot(existing, spaceId);

        const recordValues = buildValues(record, source, schema);
        if (record.description) {
          recordValues.push({
            property: ROOT_PROPERTIES.description as Id,
            type: "text",
            value: String(record.description),
          });
        }
        const newValues = recordValues.filter(
          (v) => !snapshot.propertyIds.has(v.property as string)
        );

        const recordRelations = buildRelations(record, source, schema, entityIdsBySource);
        const newRelationOps: Op[] = [];
        let addedRelations = 0;
        for (const [propId, value] of Object.entries(recordRelations)) {
          const targets = Array.isArray(value) ? value : [value];
          for (const target of targets) {
            const key = `${propId}:${target.toEntity}`;
            if (snapshot.relationKeys.has(key)) continue;
            const rel = Graph.createRelation({
              fromEntity: existing as Id,
              toEntity: target.toEntity,
              type: propId as Id,
            });
            newRelationOps.push(...rel.ops);
            addedRelations++;
          }
        }

        if (newValues.length > 0) {
          const upd = Graph.updateEntity({
            id: existing as Id,
            values: newValues as any,
          });
          entityOps.push(...upd.ops);
        }
        entityOps.push(...newRelationOps);

        if (newValues.length > 0 || addedRelations > 0) {
          stats.enriched++;
          console.log(
            `    [enrich] "${name}" → ${existing} (+${newValues.length} values, +${addedRelations} relations)`
          );
        } else {
          stats.reused++;
          console.log(`    [reuse] "${name}" → ${existing}`);
        }
        continue;
      }

      const values = buildValues(record, source, schema);
      const relations = buildRelations(record, source, schema, entityIdsBySource);

      const createArgs: Parameters<typeof Graph.createEntity>[0] = {
        name,
        values: values as any,
        relations: relations as any,
      };
      if (sourceTypeId) createArgs.types = [sourceTypeId];
      if (record.description) createArgs.description = String(record.description);

      const result = Graph.createEntity(createArgs);
      entityOps.push(...result.ops);
      idMap.set(name, result.id);
      stats.entities++;

      const relationCount = Object.values(relations).reduce(
        (sum, v) => sum + (Array.isArray(v) ? v.length : 1),
        0
      );
      console.log(`    [new] "${name}" → ${result.id} (${values.length} values, ${relationCount} relations)`);
    }

    // ── Text Blocks ──────────────────────────────────────────────────────────
    if (source.blocksField) {
      for (const record of records) {
        const blocks = (record as any)[source.blocksField];
        if (!blocks || !Array.isArray(blocks) || blocks.length === 0) continue;

        const parentId = idMap.get(String(record.name ?? "").trim());
        if (!parentId) continue;

        for (const line of blocks) {
          const { id: blockId, ops: blockOps } = Graph.createEntity({
            types: [TYPES.text_block as Id],
            values: [{ property: ROOT_PROPERTIES.markdown_content as Id, type: "text", value: String(line) }],
          } as any);
          entityOps.push(...blockOps);

          const pos = Position.generateBetween(lastPosByEntity[parentId] ?? null, null);
          lastPosByEntity[parentId] = pos;

          const relArgs: any = {
            fromEntity: parentId,
            toEntity: blockId,
            type: ROOT_PROPERTIES.blocks,
            position: pos,
          };
          if (source.blocksView) {
            const viewId = VIEWS[source.blocksView];
            if (viewId) relArgs.entityRelations = { [ROOT_PROPERTIES.view]: { toEntity: viewId } };
          }

          const { ops: relOps } = Graph.createRelation(relArgs);
          entityOps.push(...relOps);
          stats.blocks++;
        }
      }
    }

    // ── Query Data Blocks ────────────────────────────────────────────────────
    if (source.queryDataBlocks) {
      for (const qdb of source.queryDataBlocks) {
        const filterTypeId = schema.typeIds.get(qdb.filterType);
        if (!filterTypeId) {
          console.warn(`    [skip] query data block "${qdb.name}": type "${qdb.filterType}" not resolved`);
          continue;
        }

        for (const record of records) {
          const parentId = idMap.get(String(record.name ?? "").trim());
          if (!parentId) continue;

          const queryFilter = JSON.stringify({
            spaceId: { in: [process.env["SPACE_ID"]] },
            filter: { [ROOT_PROPERTIES.types]: { is: filterTypeId } },
          });

          const { id: blockId, ops: blockOps } = Graph.createEntity({
            name: qdb.name,
            types: [TYPES.data_block as Id],
            values: [{ property: ROOT_PROPERTIES.filter as Id, type: "text", value: queryFilter }],
            relations: { [ROOT_PROPERTIES.data_source_type]: { toEntity: QUERY_DATA_SOURCE } },
          } as any);
          entityOps.push(...blockOps);

          const pos = Position.generateBetween(lastPosByEntity[parentId] ?? null, null);
          lastPosByEntity[parentId] = pos;

          const relArgs: any = {
            fromEntity: parentId,
            toEntity: blockId,
            type: ROOT_PROPERTIES.blocks,
            position: pos,
          };
          if (qdb.view) {
            const viewId = VIEWS[qdb.view];
            if (viewId) relArgs.entityRelations = { [ROOT_PROPERTIES.view]: { toEntity: viewId } };
          }

          const { ops: relOps } = Graph.createRelation(relArgs);
          entityOps.push(...relOps);
          stats.dataBlocks++;
          console.log(`    [data-block:query] "${qdb.name}" on "${record.name}"`);
        }
      }
    }

    // ── Collection Data Blocks ───────────────────────────────────────────────
    if (source.collectionDataBlocks) {
      for (const cdb of source.collectionDataBlocks) {
        const itemIds: { toEntity: string }[] = [];
        const sourceMap = entityIdsBySource[cdb.items.source];
        if (sourceMap) {
          for (const name of cdb.items.names) {
            const eid = sourceMap.get(name);
            if (eid) itemIds.push({ toEntity: eid });
          }
        }
        if (itemIds.length === 0) {
          console.warn(`    [skip] collection data block "${cdb.name}": no items resolved`);
          continue;
        }

        for (const record of records) {
          const parentId = idMap.get(String(record.name ?? "").trim());
          if (!parentId) continue;

          const { id: blockId, ops: blockOps } = Graph.createEntity({
            name: cdb.name,
            types: [TYPES.data_block as Id],
            relations: {
              [ROOT_PROPERTIES.data_source_type]: { toEntity: COLLECTION_DATA_SOURCE },
              [ROOT_PROPERTIES.collection_item]: itemIds,
            },
          } as any);
          entityOps.push(...blockOps);

          const pos = Position.generateBetween(lastPosByEntity[parentId] ?? null, null);
          lastPosByEntity[parentId] = pos;

          const relArgs: any = {
            fromEntity: parentId,
            toEntity: blockId,
            type: ROOT_PROPERTIES.blocks,
            position: pos,
          };
          if (cdb.view) {
            const viewId = VIEWS[cdb.view];
            if (viewId) relArgs.entityRelations = { [ROOT_PROPERTIES.view]: { toEntity: viewId } };
          }

          const { ops: relOps } = Graph.createRelation(relArgs);
          entityOps.push(...relOps);
          stats.dataBlocks++;
          console.log(`    [data-block:collection] "${cdb.name}" on "${record.name}" (${itemIds.length} items)`);
        }
      }
    }

    // ── Avatar Images ────────────────────────────────────────────────────────
    if (source.avatarField) {
      for (const record of records) {
        const avatarUrl = (record as any)[source.avatarField];
        if (!avatarUrl) continue;
        const parentId = idMap.get(String(record.name ?? "").trim());
        if (!parentId) continue;

        const { id: imageId, ops: imageOps } = await Graph.createImage({
          url: String(avatarUrl),
          name: `${record.name} Avatar`,
          network: "TESTNET",
        });
        entityOps.push(...imageOps);

        const { ops: attachOps } = Graph.createRelation({
          fromEntity: parentId,
          toEntity: imageId,
          type: ROOT_PROPERTIES.avatar as Id,
        });
        entityOps.push(...attachOps);
        stats.images++;
        console.log(`    [avatar] "${record.name}" → ${imageId}`);
      }
    }

    // ── Cover Images ─────────────────────────────────────────────────────────
    if (source.coverField) {
      for (const record of records) {
        const coverUrl = (record as any)[source.coverField];
        if (!coverUrl) continue;
        const parentId = idMap.get(String(record.name ?? "").trim());
        if (!parentId) continue;

        const { id: imageId, ops: imageOps } = await Graph.createImage({
          url: String(coverUrl),
          name: `${record.name} Cover`,
          network: "TESTNET",
        });
        entityOps.push(...imageOps);

        const { ops: attachOps } = Graph.createRelation({
          fromEntity: parentId,
          toEntity: imageId,
          type: ROOT_PROPERTIES.cover as Id,
        });
        entityOps.push(...attachOps);
        stats.images++;
        console.log(`    [cover] "${record.name}" → ${imageId}`);
      }
    }
  }

  const allOps = [...schema.schemaOps, ...entityOps];
  stats.relations = allOps.filter((o) => o.type === "createRelation").length;

  return { ops: allOps, stats, entityIdsBySource };
}
