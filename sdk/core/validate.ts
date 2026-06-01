import type { BountyConfig, FieldType } from "./types.js";

export interface ValidationIssue {
  source: string;
  index: number;
  name: string;
  field: string;
  message: string;
  severity: "error" | "warning";
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

const URL_RE = /^https?:\/\/.+/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const TIME_RE = /^\d{2}:\d{2}/;

function isValidValue(value: unknown, type: FieldType): { ok: boolean; message?: string } {
  if (type === "url") {
    if (!URL_RE.test(String(value)))
      return { ok: false, message: `expected URL (http/https), got "${value}"` };
  }
  if (type === "date") {
    const str = String(value);
    if (!DATE_RE.test(str) || isNaN(Date.parse(str)))
      return { ok: false, message: `expected ISO date (YYYY-MM-DD), got "${str}"` };
  }
  if (type === "datetime") {
    const str = String(value);
    if (!DATETIME_RE.test(str) || isNaN(Date.parse(str)))
      return { ok: false, message: `expected ISO datetime (YYYY-MM-DDTHH:MM...), got "${str}"` };
  }
  if (type === "time") {
    const str = String(value);
    if (!TIME_RE.test(str))
      return { ok: false, message: `expected time (HH:MM...), got "${str}"` };
  }
  if (type === "int64" || type === "float64" || type === "decimal") {
    if (Number.isNaN(Number(value)))
      return { ok: false, message: `expected number, got "${value}"` };
  }
  if (type === "bool") {
    if (typeof value !== "boolean")
      return { ok: false, message: `expected boolean, got ${typeof value}` };
  }
  return { ok: true };
}

export function validateBounty(
  config: BountyConfig,
  dataBySource: Record<string, any[]>
): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  const nameSetsBySource: Record<string, Set<string>> = {};
  for (const [sourceName, records] of Object.entries(dataBySource)) {
    nameSetsBySource[sourceName] = new Set(
      records.map((r) => (r?.name ? String(r.name).trim() : "")).filter(Boolean)
    );
  }

  if (config.existingEntities) {
    for (const [sourceName, mapping] of Object.entries(config.existingEntities)) {
      if (!nameSetsBySource[sourceName]) nameSetsBySource[sourceName] = new Set();
      for (const name of Object.keys(mapping)) nameSetsBySource[sourceName].add(name);
    }
  }

  if (config.enums) {
    for (const enumDef of config.enums) {
      if (!nameSetsBySource[enumDef.source]) nameSetsBySource[enumDef.source] = new Set();
      nameSetsBySource[enumDef.source].add(enumDef.name);
    }
  }

  for (const [sourceName, source] of Object.entries(config.sources)) {
    const records = dataBySource[sourceName] ?? [];

    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      const name = record?.name ? String(record.name).trim() : "";

      if (!name) {
        errors.push({ source: sourceName, index: i, name: `[index ${i}]`, field: "name", message: "missing or empty name", severity: "error" });
        continue;
      }

      if (source.fields && config.properties) {
        for (const [jsonField, propKey] of Object.entries(source.fields)) {
          const value = record[jsonField];
          if (value === undefined || value === null || value === "") continue;

          const propDef = config.properties[propKey];
          if (!propDef) {
            warnings.push({ source: sourceName, index: i, name, field: jsonField, message: `references unknown property key "${propKey}"`, severity: "warning" });
            continue;
          }

          const check = isValidValue(value, propDef.type);
          if (!check.ok) {
            errors.push({ source: sourceName, index: i, name, field: jsonField, message: check.message!, severity: "error" });
          }
        }
      }

      if (source.relations) {
        for (const [jsonField, relDef] of Object.entries(source.relations)) {
          const value = record[jsonField];
          if (value === undefined || value === null) continue;

          const targets = Array.isArray(value) ? value : [value];
          const targetNames = nameSetsBySource[relDef.source];

          for (const t of targets) {
            const targetName = String(t).trim();
            if (!targetName) continue;
            if (!targetNames || !targetNames.has(targetName)) {
              warnings.push({
                source: sourceName,
                index: i,
                name,
                field: jsonField,
                message: `relation target "${targetName}" not found in source "${relDef.source}" — will be searched at runtime`,
                severity: "warning",
              });
            }
          }
        }
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}
