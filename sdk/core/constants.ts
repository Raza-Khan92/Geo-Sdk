import type { FieldType } from "./types.js";

export const ROOT_SPACE_ID = "a19c345ab9866679b001d7d2138d88a1";

export const TESTNET_API_URL = "https://testnet-api.geobrowser.io/graphql";
export const API_URL = process.env.API_URL ?? TESTNET_API_URL;
export const RPC_URL = process.env.RPC_URL ?? "https://rpc-geo-test-zc16z3tcvf.t.conduit.xyz";

export const TYPES = {
  type:        "e7d737c536764c609fa16aa64a8c90ad",
  property:    "808a04ceb21c4d888ad12e240613e5ca",
  person:      "7ed45f2bc48b419e8e4664d5ff680b0d",
  project:     "484a18c5030a499cb0f2ef588ff16d50",
  company:     "e059a29e6f6b437bbc15c7983d078c0d",
  topic:       "5ef5a5860f274d8e8f6c59ae5b3e89e2",
  text_block:  "76474f2f00894e77a0410b39fb17d0bf",
  data_block:  "b8803a8665de412bbb357e0c84adf473",
  image:       "ba4e41460010499da0a3caaa7f579d0e",
  video:       "06e527a31af94e47a5a26e22fded083d",
  pdf:         "a2b30b3ed1d74fd0abbc12c38b477036",
} as const;

export const ROOT_PROPERTIES = {
  name:             "a126ca530c8e48d5b88882c734c38935",
  description:      "9b1f76ff9711404c861e59dc3fa7d037",
  types:            "8f151ba4de204e3c9cb499ddf96f48f1",
  web_url:          "412ff593e9154012a43d4c27ec5c68b6",
  birth_date:       "60f8b943d9a742109356fc108ee7212c",
  date_founded:     "41aa3d9847b64a97b7ec427e575b910e",
  topics:           "458fbc070dbf4c928f5716f3fdde7c32",
  avatar:           "8a5bfe12e3c340058b7ce0a695632664",
  cover:            "e53e2d1e29b44e3b980a1ed1df2def67",
  blocks:           "beaba5cba67741a8b35377030613fc70",
  markdown_content: "e3e363d1dd294ccb8e6ff3b76d99bc33",
  data_source_type: "1f69cc9880d444abad493df6a7b15ee4",
  filter:           "14a46854bfd14b1882152785c2dab9f3",
  collection_item:  "a99f9ce12ffa4dac8c61f6310d46064a",
  view:             "1907fd1c81114a3ca378b1f353425b65",
  ipfs_url:         "8aa0684bf2454c0e85a89561a455cfaf",
  width:            "67990b42a09749e7bf1fa67770ce8329",
  height:           "cbc2145b3a3d46fcab90f28497d4ea22",
} as const;

export const QUERY_DATA_SOURCE      = "3b069b04adbe4728917d1283fd4ac27e";
export const COLLECTION_DATA_SOURCE = "1295037a5d9c4d09b27c5502654b9177";

export const VIEWS = {
  table:   "cba271cef7c140339047614d174c69f1",
  list:    "7d497dba09c249b8968f716bcf520473",
  gallery: "ccb70fc917f04a54b86e3b4d20cc7130",
  bullets: "0aaac6f7c916403eaf6d2e086dc92ada",
} as const;

export const ROOT_PROPERTY_TYPES: Record<string, FieldType> = {
  name:        "text",
  description: "text",
  web_url:     "url",
  birth_date:  "date",
  date_founded:"date",
  topics:      "relation",
};

export const DATA_TYPE_MAP: Record<FieldType, string> = {
  text:     "TEXT",
  url:      "TEXT",
  int64:    "INTEGER",
  float64:  "FLOAT",
  bool:     "BOOLEAN",
  date:     "DATE",
  time:     "TIME",
  datetime: "DATETIME",
  schedule: "SCHEDULE",
  point:    "POINT",
  bytes:    "BYTES",
  decimal:  "DECIMAL",
  relation: "RELATION",
};

export const VALUE_TYPE_MAP: Record<FieldType, string | null> = {
  text:     "text",
  url:      "text",
  int64:    "integer",
  float64:  "float",
  bool:     "boolean",
  date:     "date",
  time:     "time",
  datetime: "datetime",
  schedule: "schedule",
  point:    "point",
  bytes:    "bytes",
  decimal:  "decimal",
  relation: null,
};
