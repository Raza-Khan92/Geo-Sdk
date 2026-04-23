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
import { TESTNET_API_URL } from "./constants.js";

// Minimal interface covering the sendTransaction capability shared by both
// getSmartAccountWalletClient and getWalletClient return types.
interface WalletSender {
  account: { address: `0x${string}` } | null | undefined;
  sendTransaction(args: { to: `0x${string}`; data: `0x${string}` }): Promise<`0x${string}`>;
}

export async function gql(query: string, variables?: Record<string, unknown>): Promise<any> {
  const res = await fetch(TESTNET_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Geo API ${res.status}: ${res.statusText}`);
  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0].message);
  return json.data;
}

// Search for an entity by name, optionally scoped to a specific space.
// Without a spaceId, the search spans all of Geo — common names like "Ethereum"
// may match entities in other spaces and cause the record to be silently skipped.
export async function searchEntityByName(
  name: string,
  spaceId?: string
): Promise<string | null> {
  try {
    let data: any;
    if (spaceId) {
      data = await gql(
        `query($q: String!, $spaceId: String!) {
          search(query: $q, first: 10, filter: { spaceId: { is: $spaceId } }) {
            id
            name
          }
        }`,
        { q: name, spaceId }
      );
    } else {
      data = await gql(
        `query($q: String!) {
          search(query: $q, first: 10) {
            id
            name
          }
        }`,
        { q: name }
      );
    }
    const hit = (data?.search ?? []).find(
      (e: { id: string; name: string }) =>
        e.name?.toLowerCase() === name.toLowerCase()
    );
    return hit?.id ?? null;
  } catch (err) {
    console.warn(`Search failed for "${name}": ${err}`);
    return null;
  }
}

/**
 * Search for an entity by name, scoped to a specific Geo type ID and optionally to a space.
 * Prevents false matches when multiple entities share the same name
 * but have different types. Falls back to generic search on API error.
 */
export async function searchEntityByNameAndType(
  name: string,
  typeId: string,
  spaceId?: string
): Promise<string | null> {
  try {
    let query: string;
    let variables: any = { name, typeId };
    
    if (spaceId) {
      query = `
        query($name: String!, $typeId: String!, $spaceId: String!) {
          entities(filter: {
            types: { some: { typeId: { is: $typeId } } }
            name: { is: $name }
            spaces: { some: { id: { is: $spaceId } } }
          }) {
            id
            name
          }
        }`;
      variables.spaceId = spaceId;
    } else {
      query = `
        query($name: String!, $typeId: String!) {
          entities(filter: {
            types: { some: { typeId: { is: $typeId } } }
            name: { is: $name }
          }) {
            id
            name
          }
        }`;
    }
    
    const data = await gql(query, variables);
    const entities: { id: string; name: string }[] = data?.entities ?? [];
    const hit = entities.find(
      (e) => e.name?.toLowerCase() === name.toLowerCase()
    );
    return hit?.id ?? null;
  } catch (err) {
    // Fall back to generic search if the API doesn't support the filter
    return searchEntityByName(name, spaceId);
  }
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

  // Takes the first 32 hex characters after the "0x" prefix from the bytes32 return value.
  // This assumes the contract stores the space ID left-aligned in bytes32.
  // If your personal space ID looks truncated, verify alignment against a known space ID.
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

    // Use GraphQL variables instead of string interpolation to avoid injection issues.
    const spaceData = await gql(
      `query($id: String!) {
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
        author: address as `0x${string}`,
        network: "TESTNET",
      });
      ({ cid, editId, to, calldata } = result);
    } else {
      const personalSpaceData = await gql(
        `query($addr: String!) {
          spaces(filter: { address: { is: $addr } }) { id type }
        }`,
        { addr: address }
      );
      const callerSpace = (personalSpaceData.spaces ?? []).find(
        (s: any) => s.type === "PERSONAL"
      );
      if (!callerSpace) {
        throw new Error(`No personal space found for wallet ${address}`);
      }
      const callerSpaceId: string = callerSpace.id;

      const members: any[] = spaceData.space.membersList ?? [];
      const editors: any[] = spaceData.space.editorsList ?? [];
      const isMember = [...members, ...editors].some(
        (m) => m.memberSpaceId === callerSpaceId
      );
      if (!isMember) {
        throw new Error(
          `Your personal space (${callerSpaceId}) is not a member/editor of DAO space ${spaceId}`
        );
      }

      const result = await daoSpace.proposeEdit({
        name: editName,
        ops,
        author: address as `0x${string}`,
        network: "TESTNET",
        callerSpaceId: `0x${callerSpaceId}` as `0x${string}`,
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
