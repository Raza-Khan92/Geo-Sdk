# Geo Bounty Uploader

Upload bounty datasets to the [Geo Browser](https://www.geobrowser.io) knowledge graph. Each bounty is a folder with a config and data file. The SDK handles schema resolution, deduplication, and publishing — no code changes needed per bounty.

## Setup

1. Install dependencies: `npm install`
2. Create a `.env` file:

```
PRIVATE_KEY=0x...
SPACE_ID=
```

Get your private key from [geobrowser.io/export-wallet](https://www.geobrowser.io/export-wallet). `SPACE_ID` is optional — leave blank to use your personal space.

## Running a bounty

```bash
# Preview without publishing
npx tsx sdk/upload.ts bounties/block-explorers --dry-run

# Publish
npx tsx sdk/upload.ts bounties/block-explorers
```

## Adding a new bounty

Create a folder under `bounties/<name>/` with two files. File names don't matter — the SDK detects the config by the presence of a `bountyName` field and the data by being a JSON array.

**config.json** — defines the entity type and fields.

```json
{
  "bountyName": "My bounty",
  "editName": "Add my bounty data",
  "entityTypeName": "MyType",
  "wellKnownEntityTypeId": "<existing Geo type ID, if the type already exists>",
  "fields": [
    { "key": "name", "label": "Name", "type": "text", "wellKnownPropertyId": "a126ca530c8e48d5b88882c734c38935", "required": true },
    { "key": "website", "label": "Website", "type": "url", "wellKnownPropertyId": "<ID>" },
    { "key": "relatedEntity", "label": "Related entity", "type": "relation", "relationEntityType": "SomeType" }
  ]
}
```

Field types: `text`, `url`, `int64`, `float64`, `bool`, `date`, `relation`.

Use `wellKnownEntityTypeId` to point to a type that already exists in Geo — the SDK will use it directly without creating a new one.

Use `wellKnownPropertyId` on any field to point to a property that already exists in Geo — the SDK will use it directly without creating a new one. Property IDs for common Geo root space properties are in `sdk/core/constants.ts`.

**data.json** — array of records. Each key must match a field key in config.json. Missing optional fields are skipped. Records already in Geo by name are skipped automatically.

## Bounties

| Folder | Entity type | Records |
|---|---|---|
| `block-explorers` | Explorer | 65 |
| `networks` | Network | 39 |
