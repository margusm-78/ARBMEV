// src/searcher/v2.ts
import "dotenv/config";
import { ethers } from "ethers";
import { getCUProvider } from "./cuWrappedProvider";

const V2_ROUTER_ABI = [
  "function getAmountsOut(uint256 amountIn, address[] calldata path) view returns (uint256[] memory amounts)"
] as const;

export async function v2Quote(router: string, amountIn: bigint, path: string[]): Promise<bigint> {
  const provider = await getCUProvider();
  const r = new ethers.Contract(router, V2_ROUTER_ABI, provider);
  try {
    const amounts = await r.getAmountsOut(amountIn, path);
    const out = (amounts as bigint[])[amounts.length - 1];
    return BigInt(out);
  } catch (e: any) {
    // swallow noisy reverts for illiquid paths; caller decides
    throw new Error(`v2Quote revert at ${router} path[${path.join("->")}]: ${e?.shortMessage || e?.message || e}`);
  }
}
