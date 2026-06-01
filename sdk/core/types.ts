import type { Op, Id } from "@geoprotocol/geo-sdk";

export type FieldType =
  | "text"
  | "url"
  | "int64"
  | "float64"
  | "bool"
  | "date"
  | "time"
  | "datetime"
  | "schedule"
  | "point"
  | "bytes"
  | "decimal"
  | "relation";

export interface PropertyDef {
  label: string;
  type: FieldType;
  wellKnownId?: string;
}

export interface TypeDef {
  name: string;
  properties: string[];
  wellKnownId?: string;
}

export interface EnumDef {
  name: string;
  type: string;
  source: string;
  wellKnownId?: string;
}

export interface QueryDataBlockConfig {
  name: string;
  filterType: string;
  view?: "table" | "list" | "gallery" | "bullets";
}

export interface CollectionDataBlockConfig {
  name: string;
  items: { source: string; names: string[] };
  view?: "table" | "list" | "gallery" | "bullets";
}

export interface SourceDef {
  file: string;
  type?: string;
  order?: number;
  fields?: Record<string, string>;
  relations?: Record<string, { property: string; source: string }>;
  blocksField?: string;
  blocksView?: "table" | "list" | "gallery" | "bullets";
  avatarField?: string;
  coverField?: string;
  queryDataBlocks?: QueryDataBlockConfig[];
  collectionDataBlocks?: CollectionDataBlockConfig[];
  checkDuplicates?: boolean;
}

export interface BountyConfig {
  bountyName: string;
  editName: string;
  properties?: Record<string, PropertyDef>;
  types?: Record<string, TypeDef>;
  enums?: EnumDef[];
  sources: Record<string, SourceDef>;
  existingEntities?: Record<string, Record<string, string>>;
}

export interface SchemaMaps {
  propertyIds: Map<string, Id>;
  propertyTypes: Map<string, FieldType>;
  typeIds: Map<string, Id>;
  enumIds: Map<string, Id>;
  schemaOps: Op[];
  createdProperties: number;
  createdTypes: number;
  createdEnums: number;
}

export interface BuildStats {
  properties: number;
  types: number;
  enums: number;
  entities: number;
  relations: number;
  blocks: number;
  dataBlocks: number;
  images: number;
  reused: number;
  enriched: number;
}

export interface BuildResult {
  ops: Op[];
  stats: BuildStats;
  entityIdsBySource: Record<string, Map<string, Id>>;
}
