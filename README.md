# Geo Bounty Uploader

Publish structured bounty data to the [Geo Browser](https://www.geobrowser.io) knowledge graph from a single JSON config. One config can declare properties, types, enums, multiple data sources, and well-known entity references — all linked by name.

## Install

```bash
npm install
```

Create a `.env`:

```
PRIVATE_KEY=0x...
SPACE_ID=
```

Get your private key from [geobrowser.io/export-wallet](https://www.geobrowser.io/export-wallet). Leave `SPACE_ID` blank to upload to your personal space; the SDK will create one if it doesn't exist.

## Run

```bash
# Preview without publishing (validates, builds ops, saves them, but no transaction)
npx tsx sdk/upload.ts bounty.config.json --dry-run

# Publish
npx tsx sdk/upload.ts bounty.config.json
```

If you omit the config path, `bounty.config.json` at the repo root is used.

## Layout

```
geo-uploader/
├── bounty.config.json        # config describing one bounty
├── data/                     # JSON data files referenced by the config
│   └── rwa.json
├── sdk/
│   ├── upload.ts             # CLI: validate, build, publish
│   ├── delete.ts             # CLI: reverse a publish or delete an entity
│   └── core/
│       ├── types.ts          # BountyConfig shape
│       ├── constants.ts      # Root space IDs and type/value mappings
│       ├── graph-client.ts   # GraphQL + publish helpers
│       ├── importer.ts       # Schema resolution + ops builder
│       └── validate.ts       # Input validation
└── data_to_delete/           # Saved ops files (created on publish)
```

## Config

A bounty config has five top-level sections plus identity. Only `sources` is required.

### `bountyName` / `editName`

Display name for the bounty and the edit name written on-chain.

### `properties`

Custom properties to create or reuse. Each key is your local handle; `label` is the display name in Geo.

```json
"properties": {
  "issuer":   { "label": "Issuer",     "type": "text" },
  "tvlUsd":   { "label": "TVL (USD)",  "type": "int64" },
  "auditUrl": { "label": "Audit URL",  "type": "url" },
  "issuedAt": { "label": "Issued at",  "type": "date" },
  "isLive":   { "label": "Is live",    "type": "bool" },
  "chain":    { "label": "Chain",      "type": "relation" }
}
```

Field types: `text`, `url`, `int64`, `float64`, `bool`, `date`, `datetime`, `relation`.

Pass `wellKnownId` if the property already exists in Geo and you want to reuse it without searching:

```json
"website": { "label": "Website", "type": "url", "wellKnownId": "412ff593e9154012a43d4c27ec5c68b6" }
```

Without `wellKnownId`, the SDK searches Geo for a property with the same name and type and reuses it; if none is found, it creates a new one.

### `types`

Entity types and which properties belong to them.

```json
"types": {
  "rwa": {
    "name": "RWA",
    "properties": ["issuer", "tvlUsd", "auditUrl", "issuedAt", "isLive", "chain"]
  }
}
```

Same `wellKnownId` escape hatch applies.

### `enums`

Inline simple entities (e.g. category buckets). Each enum entity gets registered under the given `source` name so relations can target it by name.

```json
"enums": [
  { "name": "Treasury Bills", "type": "rwaCategory", "source": "categories" },
  { "name": "Real Estate",    "type": "rwaCategory", "source": "categories" }
]
```

### `sources`

The data files. Each entry maps a JSON file to entity creation rules.

```json
"sources": {
  "rwas": {
    "file": "rwa.json",
    "type": "rwa",
    "order": 0,
    "fields": {
      "issuer": "issuer",
      "tvlUsd": "tvlUsd"
    },
    "relations": {
      "chain":    { "property": "chain",    "source": "chains" },
      "category": { "property": "category", "source": "categories" }
    }
  }
}
```

- `order` — lower numbers process first. Use this when one source references another.
- `fields` — JSON-field-name → property key (from `properties`).
- `relations` — JSON-field-name → `{ property, source }`. The value at that JSON field (a name, or array of names) is resolved against entities in the named source (other source, enum source, or `existingEntities`).

### `existingEntities`

Hand-mapped well-known IDs for entities already in Geo. Useful for chains, networks, large protocols — anything you want to guarantee is reused rather than recreated.

```json
"existingEntities": {
  "chains": {
    "Ethereum": "69d67eaa80d3419a911424d63aed6d67",
    "Polygon":  "e2c22cd5838247a2be7809ed78c2adf3"
  }
}
```

When a record has `"chain": "Ethereum"` and the source has `relations.chain.source = "chains"`, the SDK uses the mapped ID directly — no search, no duplicate.

## Deduplication and enrichment

For every record, the SDK does three checks in order:

1. **Is the name already in this source's map?** (from `existingEntities` or earlier in the same run.) Pure reuse — the existing ID is used for relations from other entities, no values or relations are added to it.
2. **Does an entity with this name + type exist in the target space?** (`search` query scoped to the space.) If yes, the SDK fetches the entity's current values and relations and **enriches** it — adds only the properties and relations from your record that aren't already there. Nothing is overwritten.
3. Otherwise, create a new entity with the full record.

This means:
- Re-running the same config is safe — properties already on the entity are not re-added, relations already present are not duplicated.
- Adding a new field to your data and re-running will append that field to existing entities without touching the rest.
- Hand-mapped entities in `existingEntities` are treated as untouchable references. If you want enrichment behavior for an entity, remove it from `existingEntities` and let runtime search find it.

Type-aware matching prevents false merges: an entity named "Ethereum" with type `Network` and an entity named "Ethereum" with type `Project` are kept as two distinct entities. The dedup key is always `name + type`.

## Data files

Each file under `data/` is a plain JSON array of records. Every record must have a `name`. Optional fields: `description` and whatever the source's `fields` / `relations` reference.

```json
[
  {
    "name": "Ondo OUSG",
    "description": "Tokenized exposure to short-term US Treasuries",
    "issuer": "Ondo Finance",
    "tvlUsd": 500000000,
    "chain": "Ethereum",
    "category": "Treasury Bills"
  }
]
```

## Delete

```bash
# Reverse the last publish for a config (uses the saved ops file)
npx tsx sdk/delete.ts bounty.config.json

# Reverse a specific saved ops file
npx tsx sdk/delete.ts data_to_delete/publish_ops_1715000000000.json

# Delete a single entity by ID
npx tsx sdk/delete.ts 69d67eaa80d3419a911424d63aed6d67
```

## Tests

```bash
npx vitest run
```

## Type-check

```bash
npx tsc --noEmit
```
