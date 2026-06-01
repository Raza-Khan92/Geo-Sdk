import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

vi.mock("./graph-client.js", () => ({
  searchEntityByName: vi.fn().mockResolvedValue(null),
  searchEntityByNameAndType: vi.fn().mockResolvedValue(null),
  getEntitySnapshot: vi.fn().mockResolvedValue({
    propertyIds: new Set<string>(),
    relationKeys: new Set<string>(),
  }),
}));

import { buildOps } from "./importer.js";
import { searchEntityByNameAndType, getEntitySnapshot } from "./graph-client.js";
import type { BountyConfig } from "./types.js";

const SPACE_ID = "00000000000000000000000000000000";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "geo-uploader-test-"));
}

function writeJson(dir: string, name: string, data: unknown) {
  writeFileSync(join(dir, name), JSON.stringify(data));
}

function baseConfig(overrides: Partial<BountyConfig> = {}): BountyConfig {
  return {
    bountyName: "Test",
    editName: "Test edit",
    sources: {},
    ...overrides,
  };
}

describe("buildOps", () => {
  it("returns no ops when there are no sources", async () => {
    const dir = tmp();
    const result = await buildOps(baseConfig(), dir, SPACE_ID);
    expect(result.ops).toHaveLength(0);
    expect(result.stats.entities).toBe(0);
  });

  it("creates a property and a type", async () => {
    const dir = tmp();
    const config = baseConfig({
      properties: { issuer: { label: "Issuer", type: "text" } },
      types: { rwa: { name: "RWA", properties: ["issuer"] } },
    });
    const result = await buildOps(config, dir, SPACE_ID);
    expect(result.stats.properties).toBeGreaterThanOrEqual(1);
    expect(result.stats.types).toBeGreaterThanOrEqual(1);
    expect(result.ops.length).toBeGreaterThan(0);
  });

  it("creates entities from a source data file", async () => {
    const dir = tmp();
    writeJson(dir, "rwa.json", [
      { name: "Ondo OUSG", description: "Tokenized treasuries" },
      { name: "Maple Cash" },
    ]);
    const config = baseConfig({
      types: { rwa: { name: "RWA", properties: [] } },
      sources: { rwas: { file: "rwa.json", type: "rwa", order: 0 } },
    });
    const result = await buildOps(config, dir, SPACE_ID);
    expect(result.stats.entities).toBe(2);
    expect(result.entityIdsBySource.rwas?.size).toBe(2);
  });

  it("skips records with no name", async () => {
    const dir = tmp();
    writeJson(dir, "rwa.json", [{ name: "Ondo OUSG" }, { description: "no name" }]);
    const config = baseConfig({
      types: { rwa: { name: "RWA", properties: [] } },
      sources: { rwas: { file: "rwa.json", type: "rwa" } },
    });
    const result = await buildOps(config, dir, SPACE_ID);
    expect(result.stats.entities).toBe(1);
  });

  it("reuses existingEntities and does not re-create them", async () => {
    const dir = tmp();
    writeJson(dir, "rwa.json", [{ name: "Ondo OUSG", chain: "Ethereum" }]);
    const config = baseConfig({
      properties: { chain: { label: "Chain", type: "relation" } },
      types: { rwa: { name: "RWA", properties: ["chain"] } },
      sources: {
        rwas: {
          file: "rwa.json",
          type: "rwa",
          order: 0,
          relations: { chain: { property: "chain", source: "chains" } },
        },
      },
      existingEntities: {
        chains: { Ethereum: "69d67eaa80d3419a911424d63aed6d67" },
      },
    });
    const result = await buildOps(config, dir, SPACE_ID);
    expect(result.entityIdsBySource.chains?.get("Ethereum")).toBe(
      "69d67eaa80d3419a911424d63aed6d67"
    );
    expect(result.stats.relations).toBeGreaterThanOrEqual(1);
  });

  it("resolves cross-source relations in order", async () => {
    const dir = tmp();
    writeJson(dir, "issuers.json", [{ name: "Ondo Finance" }]);
    writeJson(dir, "rwa.json", [{ name: "Ondo OUSG", issuer: "Ondo Finance" }]);
    const config = baseConfig({
      properties: { issuerRel: { label: "Issuer entity", type: "relation" } },
      types: {
        issuer: { name: "Issuer", properties: [] },
        rwa: { name: "RWA", properties: ["issuerRel"] },
      },
      sources: {
        issuers: { file: "issuers.json", type: "issuer", order: 0 },
        rwas: {
          file: "rwa.json",
          type: "rwa",
          order: 1,
          relations: { issuer: { property: "issuerRel", source: "issuers" } },
        },
      },
    });
    const result = await buildOps(config, dir, SPACE_ID);
    expect(result.stats.entities).toBe(2);
    expect(result.stats.relations).toBeGreaterThanOrEqual(1);
  });

  it("enriches an existing entity with missing values and relations", async () => {
    const dir = tmp();
    writeJson(dir, "people.json", [
      {
        name: "Elon Musk",
        netWorth: 250000000000,
        twitter: "https://x.com/elonmusk",
        chain: "Ethereum",
      },
    ]);
    const config = baseConfig({
      properties: {
        netWorth: { label: "Net worth (USD)", type: "int64" },
        twitter:  { label: "Twitter",         type: "url" },
        chain:    { label: "Chain",           type: "relation" },
      },
      types: { person: { name: "Person", properties: ["netWorth", "twitter", "chain"] } },
      sources: {
        people: {
          file: "people.json",
          type: "person",
          fields: { netWorth: "netWorth", twitter: "twitter" },
          relations: { chain: { property: "chain", source: "chains" } },
        },
      },
      existingEntities: {
        chains: { Ethereum: "69d67eaa80d3419a911424d63aed6d67" },
      },
    });

    const fakeId = "abcd1234abcd1234abcd1234abcd1234";
    (searchEntityByNameAndType as any).mockImplementation((name: string) =>
      Promise.resolve(name === "Elon Musk" ? fakeId : null)
    );
    (getEntitySnapshot as any).mockResolvedValue({
      propertyIds: new Set<string>(),
      relationKeys: new Set<string>(),
    });

    const result = await buildOps(config, dir, "11111111111111111111111111111111");

    expect(result.stats.entities).toBe(0);
    expect(result.stats.enriched).toBe(1);
    expect(result.ops.some((o) => o.type === "updateEntity")).toBe(true);
    expect(result.ops.some((o) => o.type === "createRelation")).toBe(true);

    (searchEntityByNameAndType as any).mockReset().mockResolvedValue(null);
    (getEntitySnapshot as any).mockReset().mockResolvedValue({
      propertyIds: new Set<string>(),
      relationKeys: new Set<string>(),
    });
  });

  it("skips already-present values and relations when enriching (idempotent re-run)", async () => {
    const dir = tmp();
    writeJson(dir, "people.json", [
      { name: "Elon Musk", netWorth: 250000000000, chain: "Ethereum" },
    ]);

    const NET_WORTH_PROP = "11112222333344445555666677778888";
    const CHAIN_PROP     = "aaaabbbbccccddddeeeeffff00001111";
    const PERSON_TYPE    = "12341234123412341234123412341234";
    const ETHEREUM_ID    = "69d67eaa80d3419a911424d63aed6d67";

    const config = baseConfig({
      properties: {
        netWorth: { label: "Net worth (USD)", type: "int64",    wellKnownId: NET_WORTH_PROP },
        chain:    { label: "Chain",           type: "relation", wellKnownId: CHAIN_PROP },
      },
      types: {
        person: { name: "Person", properties: ["netWorth", "chain"], wellKnownId: PERSON_TYPE },
      },
      sources: {
        people: {
          file: "people.json",
          type: "person",
          fields: { netWorth: "netWorth" },
          relations: { chain: { property: "chain", source: "chains" } },
        },
      },
      existingEntities: {
        chains: { Ethereum: ETHEREUM_ID },
      },
    });

    const ENTITY_ID = "abcd1234abcd1234abcd1234abcd1234";
    (searchEntityByNameAndType as any).mockImplementation((name: string) =>
      Promise.resolve(name === "Elon Musk" ? ENTITY_ID : null)
    );
    (getEntitySnapshot as any).mockResolvedValue({
      propertyIds: new Set<string>([NET_WORTH_PROP]),
      relationKeys: new Set<string>([`${CHAIN_PROP}:${ETHEREUM_ID}`]),
    });

    const result = await buildOps(config, dir, "11111111111111111111111111111111");

    expect(result.stats.enriched).toBe(0);
    expect(result.stats.reused).toBe(1);
    expect(result.ops.some((o) => o.type === "updateEntity")).toBe(false);
    expect(result.ops.some((o) => o.type === "createRelation")).toBe(false);

    (searchEntityByNameAndType as any).mockReset().mockResolvedValue(null);
    (getEntitySnapshot as any).mockReset().mockResolvedValue({
      propertyIds: new Set<string>(),
      relationKeys: new Set<string>(),
    });
  });

  it("creates enum entities that relations can target by name", async () => {
    const dir = tmp();
    writeJson(dir, "rwa.json", [{ name: "Ondo OUSG", category: "Treasury Bills" }]);
    const config = baseConfig({
      properties: { categoryRel: { label: "Category", type: "relation" } },
      types: {
        rwa: { name: "RWA", properties: ["categoryRel"] },
        rwaCategory: { name: "RWA Category", properties: [] },
      },
      enums: [{ name: "Treasury Bills", type: "rwaCategory", source: "categories" }],
      sources: {
        rwas: {
          file: "rwa.json",
          type: "rwa",
          relations: { category: { property: "categoryRel", source: "categories" } },
        },
      },
    });
    const result = await buildOps(config, dir, SPACE_ID);
    expect(result.stats.enums).toBe(1);
    expect(result.stats.relations).toBeGreaterThanOrEqual(1);
  });
});
