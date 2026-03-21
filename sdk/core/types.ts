import type { Op, Id } from "@geoprotocol/geo-sdk";

export type FieldValueType =
  | "text"
  | "url"
  | "int64"
  | "float64"
  | "bool"
  | "date"
  | "relation";

export interface FieldConfig {
  key: string;
  label: string;
  type: FieldValueType;
  wellKnownPropertyId?: string;
  relationEntityType?: string;
  required?: boolean;
}

export interface BountyConfig {
  bountyName: string;
  editName: string;
  entityTypeName: string;
  fields: FieldConfig[];
}

export interface ResolvedField {
  key: string;
  label: string;
  type: FieldValueType;
  propertyId: Id;
  relationEntityTypeId?: Id;
  required?: boolean;
}

export interface ResolvedSchema {
  entityTypeId: Id;
  fields: ResolvedField[];
  schemaOps: Op[];
}
