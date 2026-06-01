import { createPublicClient, type Hex, http } from "viem";
import {
  getSmartAccountWalletClient,
  getWalletClient,
  personalSpace,
  daoSpace,
  TESTNET_RPC_URL,
} from "@geoprotocol/geo-sdk";
import { SpaceRegistryAbi } from "@geoprotocol/geo-sdk/abis";
import { TESTNET } from "@geoprotocol/geo-sdk/contracts";
import type { Op } from "@geoprotocol/geo-sdk";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { API_URL } from "./constants.js";

interface WalletSender {
  account: { address: `0x${string}` } | null | undefined;
  sendTransaction(args: { to: `0x${string}`; data: `0x${string}` }): Promise<`0x${string}`>;
}

export async function gql(query: string, variables?: Record<string, unknown>): Promise<any> {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Geo API ${res.status}: ${res.statusText}`);
  const json = await res.json();
  if (json.errors) {
    console.error("  [api error]", JSON.stringify(json.errors, null, 2));
    throw new Error(`GraphQL: ${json.errors[0].message}`);
  }
  return json.data;
}

export async function searchEntityByName(
  name: string,
  spaceId?: string
): Promise<string | null> {
  const data = await gql(
    `query($name: String!, $spaceIds: [UUID!]) {
      search(query: $name, first: 20, spaceIds: $spaceIds) { id name }
    }`,
    { name, spaceIds: spaceId ? [spaceId] : null }
  );
  const results: { id: string; name: string }[] = data?.search ?? [];
  const hit = results.find((e) => e.name?.toLowerCase() === name.toLowerCase());
  return hit?.id ?? null;
}

export async function searchEntityByNameAndType(
  name: string,
  typeId: string,
  spaceId?: string
): Promise<string | null> {
  const data = await gql(
    `query($name: String!, $spaceIds: [UUID!]) {
      search(query: $name, first: 20, spaceIds: $spaceIds) { id name types { id } }
    }`,
    { name, spaceIds: spaceId ? [spaceId] : null }
  );
  const results: { id: string; name: string; types: { id: string }[] }[] = data?.search ?? [];
  const hit = results.find(
    (e) =>
      e.name?.toLowerCase() === name.toLowerCase() &&
      e.types?.some((t) => t.id === typeId)
  );
  return hit?.id ?? null;
}

export interface EntitySnapshot {
  propertyIds: Set<string>;
  relationKeys: Set<string>;
}

export async function getEntitySnapshot(
  entityId: string,
  spaceId: string
): Promise<EntitySnapshot> {
  const data = await gql(
    `query($id: UUID!, $sid: UUID!) {
      values(filter: { entityId: { is: $id }, spaceId: { is: $sid } }) {
        propertyId
      }
      relations(filter: { fromEntityId: { is: $id }, spaceId: { is: $sid } }) {
        typeId
        toEntity { id }
      }
    }`,
    { id: entityId, sid: spaceId }
  );
  const propertyIds = new Set<string>(
    (data.values ?? []).map((v: any) => v.propertyId).filter(Boolean)
  );
  const relationKeys = new Set<string>(
    (data.relations ?? [])
      .filter((r: any) => r.typeId && r.toEntity?.id)
      .map((r: any) => `${r.typeId}:${r.toEntity.id}`)
  );
  return { propertyIds, relationKeys };
}

export interface PublishConfig {
  ops: Op[];
  editName: string;
  privateKey: `0x${string}`;
  spaceId?: string;
  useSmartAccount?: boolean;
}

export interface PublishResult {
  success: boolean;
  spaceId?: string;
  editId?: string;
  cid?: string;
  transactionHash?: string;
  error?: string;
}

async function resolvePersonalSpaceId(
  address: string,
  walletClient: WalletSender
): Promise<string> {
  const publicClient = createPublicClient({ transport: http(TESTNET_RPC_URL) });

  const hasSpace = await personalSpace.hasSpace({ address: address as `0x${string}` });
  if (!hasSpace) {
    console.log("  Creating personal space...");
    const { to, calldata } = personalSpace.createSpace();
    const tx = await walletClient.sendTransaction({ to, data: calldata });
    await publicClient.waitForTransactionReceipt({ hash: tx });
  }

  const spaceIdHex = (await publicClient.readContract({
    address: TESTNET.SPACE_REGISTRY_ADDRESS,
    abi: SpaceRegistryAbi,
    functionName: "addressToSpaceId",
    args: [address as `0x${string}`],
  })) as Hex;

  return spaceIdHex.slice(2, 34).toLowerCase();
}

export async function publishOps(config: PublishConfig): Promise<PublishResult> {
  const { ops, editName, privateKey, useSmartAccount = true } = config;
  try {
    const walletClient: WalletSender = useSmartAccount
      ? await getSmartAccountWalletClient({ privateKey })
      : await getWalletClient({ privateKey });

    const address = walletClient.account!.address;
    console.log(`  Wallet: ${address}`);

    const spaceId =
      config.spaceId ?? (await resolvePersonalSpaceId(address, walletClient));
    console.log(`  Space:  ${spaceId}`);

    const publicClient = createPublicClient({ transport: http(TESTNET_RPC_URL) });

    const spaceData = await gql(
      `query($id: UUID!) {
        space(id: $id) {
          type
          address
          membersList { memberSpaceId }
          editorsList { memberSpaceId }
        }
      }`,
      { id: spaceId }
    );

    if (!spaceData.space) throw new Error(`Space ${spaceId} not found`);

    const { type: spaceType, address: daoAddress } = spaceData.space;

    let cid: string;
    let editId: string;
    let to: `0x${string}`;
    let calldata: `0x${string}`;

    if (spaceType === "PERSONAL") {
      const result = await personalSpace.publishEdit({
        name: editName,
        spaceId,
        ops,
        author: spaceId,
        network: "TESTNET",
      });
      ({ cid, editId, to, calldata } = result);
    } else {
      const callerPersonalSpaceId = await resolvePersonalSpaceId(address, walletClient);
      console.log(`  Caller personal space: ${callerPersonalSpaceId}`);

      const members: any[] = spaceData.space.membersList ?? [];
      const editors: any[] = spaceData.space.editorsList ?? [];
      const isMemberOrEditor = [...members, ...editors].some(
        (m: any) => m.memberSpaceId === callerPersonalSpaceId
      );
      if (!isMemberOrEditor) {
        throw new Error(
          `Your personal space (${callerPersonalSpaceId}) is not a member or editor of DAO space ${spaceId}`
        );
      }

      const result = await daoSpace.proposeEdit({
        name: editName,
        ops,
        author: callerPersonalSpaceId,
        network: "TESTNET",
        callerSpaceId: `0x${callerPersonalSpaceId}` as `0x${string}`,
        daoSpaceId: `0x${spaceId}` as `0x${string}`,
        daoSpaceAddress: daoAddress as `0x${string}`,
      });
      ({ cid, editId, to, calldata } = result);
    }

    const txHash = await walletClient.sendTransaction({ to, data: calldata });
    await publicClient.waitForTransactionReceipt({ hash: txHash });

    return { success: true, spaceId, editId, cid, transactionHash: txHash };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function isUuidByteArray(obj: any): boolean {
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return false;
  const keys = Object.keys(obj);
  if (keys.length !== 16) return false;
  for (let i = 0; i < 16; i++) {
    if (!(String(i) in obj) || typeof obj[String(i)] !== "number") return false;
  }
  return true;
}

function convertUuidBytes(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== "object") return obj;
  if (isUuidByteArray(obj)) {
    let hex = "";
    for (let i = 0; i < 16; i++) hex += obj[String(i)].toString(16).padStart(2, "0");
    return hex;
  }
  if (Array.isArray(obj)) return obj.map(convertUuidBytes);
  const result: any = {};
  for (const key of Object.keys(obj)) result[key] = convertUuidBytes(obj[key]);
  return result;
}

export function saveOps(ops: Op[], outputDir: string, filename: string) {
  if (ops.length === 0) return;
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
  const filePath = join(outputDir, filename);
  writeFileSync(filePath, JSON.stringify(convertUuidBytes(ops), null, 2));
  console.log(`  Ops saved to ${filePath}`);
}

export function printOpsSummary(ops: Op[]) {
  const counts: Record<string, number> = {};
  for (const op of ops) counts[op.type] = (counts[op.type] || 0) + 1;
  console.log(`  Total ops: ${ops.length}`);
  for (const [type, count] of Object.entries(counts)) {
    console.log(`    ${type}: ${count}`);
  }
}
