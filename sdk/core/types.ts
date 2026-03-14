import type { Op, Id } from "@geoprotocol/geo-sdk";

// Supported field value types
export type FieldValueType =
  | "text"
  | "url"
  | "int64"
  | "float64"
  | "bool"
  | "date"
  | "relation";

// One column in your data.json
export interface FieldConfig {
  key: string;                   // matches the JSON key in data.json
  label: string;                 // human-readable name, used as Geo property name
  type: FieldValueType;
  wellKnownPropertyId?: string;  // skip creation, reuse an existing root-space property
  relationEntityType?: string;   // for type=relation: Geo type to assign new ref entities
  required?: boolean;
}

// The config.json at the top of each bounty folder
export interface BountyConfig {
  bountyName: string;      // shown in logs
  editName: string;        // name of the on-chain Geo edit
  entityTypeName: string;  // Geo type for the main entities (e.g. "Smart Contract Protocol")
  fields: FieldConfig[];
}

// A field after its Geo property ID has been resolved
export interface ResolvedField {
  key: string;
  label: string;
  type: FieldValueType;
  propertyId: Id;
  relationEntityTypeId?: Id;
  required?: boolean;
}

// Everything needed to start importing records
export interface ResolvedSchema {
  entityTypeId: Id;
  fields: ResolvedField[];
  schemaOps: Op[];  // ops for any newly created properties/types
}
