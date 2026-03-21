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

Create a folder under `bounties/<name>/` with two files:

**config.json** — defines the entity type and fields. Use the block-explorers bounty as a reference. Field types: `text`, `url`, `int64`, `float64`, `bool`, `date`, `relation`.

For fields that map to a Geo root space property (name, description, web url, etc.), add `wellKnownPropertyId` with the ID from `sdk/core/constants.ts` — this reuses the existing property instead of creating a new one.

Property labels follow sentence case: `"Supported networks"`, `"Api url"`.

**data.json** — array of records. Each key must match a field key in config.json. Missing optional fields are skipped. Records already in Geo by name are skipped automatically.

## Bounties

| Folder | Entity type | Records |
|---|---|---|
| `block-explorers` | Block explorer | 47 |
