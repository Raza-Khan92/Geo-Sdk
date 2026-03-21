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

    const publicClient = createPublicClient({ transport: http(TESTNET_RPC_URL) });

    const spaceData = await gql(`{
      space(id: "${spaceId}") {
        type
        address
        membersList { memberSpaceId }
        editorsList { memberSpaceId }
      }
    }`);

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
        author: spaceId as `0x${string}`,
        network: "TESTNET",
      });
      ({ cid, editId, to, calldata } = result);
    } else {
      const personalSpaceData = await gql(`{
        spaces(filter: { address: { is: "${address}" } }) { id type }
      }`);
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
        author: callerSpaceId as `0x${string}`,
        network: "TESTNET",
        callerSpaceId: `0x${callerSpaceId}` as `0x${string}`,
        daoSpaceId: `0x${spaceId}` as `0x${string}`,
        daoSpaceAddress: daoAddress as `0x${string}`,
      });
      ({ cid, editId, to, calldata } = result);
    }

    const txHash = await (walletClient as any).sendTransaction({ to, data: calldata }) as `0x${string}`;
    await publicClient.waitForTransactionReceipt({ hash: txHash });

    return { success: true, spaceId, editId, cid, transactionHash: txHash };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
