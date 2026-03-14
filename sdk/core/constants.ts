// Well-known entity IDs from the Geo root space ontology.
// Source: https://github.com/geo-explorers/geo-sdk-tutorial/blob/main/src/constants.ts
// These IDs already exist live in Geo — reuse them instead of creating duplicates.

export const ROOT_SPACE_ID = "a19c345ab9866679b001d7d2138d88a1";

export const TESTNET_API_URL = "https://testnet-api.geobrowser.io/graphql";

// Built-in Geo types
export const TYPES = {
  person:     "7ed45f2bc48b419e8e4664d5ff680b0d",
  project:    "484a18c5030a499cb0f2ef588ff16d50",
  topic:      "5ef5a5860f274d8e8f6c59ae5b3e89e2",
  image:      "ba4e41460010499da0a3caaa7f579d0e",
} as const;

// Built-in Geo properties — use these via wellKnownPropertyId in config.json
export const PROPERTIES = {
  name:        "a126ca530c8e48d5b88882c734c38935",
  description: "9b1f76ff9711404c861e59dc3fa7d037",
  web_url:     "eed38e74e67946bf8a42ea3e4f8fb5fb",
  topics:      "458fbc070dbf4c928f5716f3fdde7c32",
  avatar:      "01412f8381894ab1836565c7fd358cc1",
  cover:       "34f535072e6b42c5a84443981a77cfa2",
} as const;
