import { describe, it, expect } from "vitest";
import { toGeoValueType, toGeoDataType } from "./importer.js";

describe("toGeoValueType", () => {
  it('maps text → "text"', () => expect(toGeoValueType("text")).toBe("text"));
  it('maps url → "text"', () => expect(toGeoValueType("url")).toBe("text"));
  it('maps int64 → "float" (JS number limitation)', () => expect(toGeoValueType("int64")).toBe("float"));
  it('maps float64 → "float"', () => expect(toGeoValueType("float64")).toBe("float"));
  it('maps bool → "bool"', () => expect(toGeoValueType("bool")).toBe("bool"));
  it('maps date → "date"', () => expect(toGeoValueType("date")).toBe("date"));
});

describe("toGeoDataType", () => {
  it('maps text → "TEXT"', () => expect(toGeoDataType("text")).toBe("TEXT"));
  it('maps url → "TEXT"', () => expect(toGeoDataType("url")).toBe("TEXT"));
  it('maps int64 → "INT64"', () => expect(toGeoDataType("int64")).toBe("INT64"));
  it('maps float64 → "FLOAT64"', () => expect(toGeoDataType("float64")).toBe("FLOAT64"));
  it('maps bool → "BOOLEAN"', () => expect(toGeoDataType("bool")).toBe("BOOLEAN"));
  it('maps date → "DATE"', () => expect(toGeoDataType("date")).toBe("DATE"));
  it('maps relation → "RELATION"', () => expect(toGeoDataType("relation")).toBe("RELATION"));
});
