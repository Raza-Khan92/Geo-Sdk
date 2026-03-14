import { createPublicClient, type Hex, http } from "viem";
import {
  getSmartAccountWalletClient,
  getWalletClient,
  personalSpace,
  TESTNET_RPC_URL,
} from "@geoprotocol/geo-sdk";
import { SpaceRegistryAbi } from "@geoprotocol/geo-sdk/abis";
import { TESTNET } from "@geoprotocol/geo-sdk/contracts";
import type { Op } from "@geoprotocol/geo-sdk";
import { TESTNET_API_URL } from "./constants.js";

// Run a GraphQL query against the Geo testnet API
export async function gql(query: string): Promise<any> {
  const res = await fetch(TESTNET_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`Geo API ${res.status}: ${res.statusText}`);
  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0].message);
  return json.data;
}

// Search Geo for an entity by exact name. Returns its ID or null.
// Used before every create to avoid duplicates.
export async function searchEntityByName(name: string): Promise<string | null> {
  try {
    const data = await gql(`{
      search(query: ${JSON.stringify(name)}, first: 10) {
        id
        name
      }
    }`);
    const hit = (data?.search ?? []).find(
      (e: { id: string; name: string }) =>
        e.name?.toLowerCase() === name.toLowerCase()
    );
    return hit?.id ?? null;
  } catch {
    return null;
  }
}

export interface PublishConfig {
  ops: Op[];
  editName: string;
  privateKey: `0x${string}`;
  spaceId?: string;       // defaults to personal space
  useSmartAccount?: boolean; // default true (gas-sponsored)
}

export interface PublishResult {
  success: boolean;
  spaceId?: string;
  editId?: string;
  cid?: string;
  transactionHash?: string;
  error?: string;
}

// Resolve the personal space ID for an address, creating it on-chain if needed
async function resolvePersonalSpaceId(
  address: string,
  walletClient: Awaited<ReturnType<typeof getSmartAccountWalletClient>>
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

// Publish a batch of ops as one Geo edit
export async function publishOps(config: PublishConfig): Promise<PublishResult> {
  const { ops, editName, privateKey, useSmartAccount = true } = config;
  try {
    const walletClient = useSmartAccount
      ? await getSmartAccountWalletClient({ privateKey })
      : await getWalletClient({ privateKey });

    const address = walletClient.account!.address;
    console.log(`  Wallet: ${address}`);

    const spaceId =
      config.spaceId ?? (await resolvePersonalSpaceId(address, walletClient as any));
    console.log(`  Space:  ${spaceId}`);

    const { cid, editId, to, calldata } = await personalSpace.publishEdit({
      name: editName,
      spaceId,
      ops,
      author: spaceId as `0x${string}`,
      network: "TESTNET",
    });

    const txHash = await (walletClient as any).sendTransaction({ to, data: calldata }) as `0x${string}`;

    const publicClient = createPublicClient({ transport: http(TESTNET_RPC_URL) });
    await publicClient.waitForTransactionReceipt({ hash: txHash });

    return { success: true, spaceId, editId, cid, transactionHash: txHash };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
