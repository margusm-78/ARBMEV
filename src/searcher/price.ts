// src/searcher/price.ts
import "dotenv/config";
import { ethers } from "ethers";
import { CONFIG } from "./config";
import { tokenAddress } from "./univ3";
import { getCUProvider } from "./cuWrappedProvider";

/**
 * Correct QuoterV2 ABI with struct order:
 * tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96
 */
const QUOTER_V2_ABI = [
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "quoteExactInputSingle",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn",           type: "address" },
          { name: "tokenOut",          type: "address" },
          { name: "amountIn",          type: "uint256" },
          { name: "fee",               type: "uint24"  },
          { name: "sqrtPriceLimitX96", type: "uint160" }
        ],
        internalType: "struct IQuoterV2.QuoteExactInputSingleParams"
      }
    ],
    outputs: [
      { name: "amountOut",               type: "uint256" },
      { name: "sqrtPriceX96After",       type: "uint160" },
      { name: "initializedTicksCrossed", type: "uint32"  },
      { name: "gasEstimate",             type: "uint256" }
    ]
  }
] as const;

// Use CONFIG first; fall back to env; then hard default
const QUOTER_ADDRESS =
  (CONFIG as any)?.uni?.quoter ||
  process.env.UNISWAP_V3_QUOTER_V2 ||
  "0x61fFE014bA17989E743c5F6cB21bF9697530B21e";

function feesToTry(): number[] {
  const cfg = Number((CONFIG as any)?.uni?.priceFee);
  // ensure unique, valid set; include 100 for stables
  const list = [
    Number.isFinite(cfg) && cfg > 0 ? cfg : 500,
    100, 500, 3000, 10000
  ];
  return list.filter((v, i, a) => typeof v === "number" && v > 0 && a.indexOf(v) === i);
}

function decodeErr(err: any): string {
  const short = err?.shortMessage || err?.message;
  const data = err?.info?.error?.data || err?.error?.data;
  const code = err?.code || err?.info?.code;
  if (short) return String(short);
  if (data) return `reverted (data len=${String(data).length})`;
  if (code) return `error code ${code}`;
  return String(err ?? "unknown error");
}

type QuoteParams = {
  tokenIn: string;
  tokenOut: string;
  fee: number;
  amountIn: bigint;
  sqrtPriceLimitX96?: bigint;
};

async function staticQuote(
  provider: ethers.JsonRpcProvider,
  params: QuoteParams
): Promise<bigint> {
  const quoter = new ethers.Contract(
    QUOTER_ADDRESS,
    QUOTER_V2_ABI,
    provider
  );

  try {
    const res = await quoter.quoteExactInputSingle.staticCall({
      tokenIn: params.tokenIn,
      tokenOut: params.tokenOut,
      amountIn: params.amountIn,
      fee: params.fee,
      sqrtPriceLimitX96: params.sqrtPriceLimitX96 ?? 0n,
    });
    const out = (res as any)?.amountOut ?? (res as bigint);
    return BigInt(out);
  } catch (e: any) {
    throw new Error(
      `QuoterV2 revert (fee ${params.fee}) ${params.tokenIn}->${params.tokenOut}: ${decodeErr(e)}`
    );
  }
}

export async function quoteExactInputBestFee(
  tokenIn: string,
  tokenOut: string,
  amountIn: bigint
): Promise<{ amountOut: bigint; feeUsed: number }> {
  const provider = await getCUProvider(); // CU-tracked + cached provider
  let lastErr: unknown = null;
  let bestOut = 0n;
  let bestFee = 0;

  for (const fee of feesToTry()) {
    try {
      const out = await staticQuote(provider, { tokenIn, tokenOut, fee, amountIn });
      if (out > bestOut) { bestOut = out; bestFee = fee; }
    } catch (e) {
      lastErr = e;
      // small stagger between fee attempts
      await new Promise((r) => setTimeout(r, 80));
    }
  }

  if (bestOut > 0n) return { amountOut: bestOut, feeUsed: bestFee };

  throw new Error(
    `Quoter failed ${tokenIn}->${tokenOut}. Last error: ${(lastErr as any)?.message ?? String(lastErr)}`
  );
}

/** Primary: ARB -> WETH quote */
export async function quoteArbToWeth(amountInArb: bigint) {
  const ARB = tokenAddress("ARB");
  const WETH = tokenAddress("WETH");
  return quoteExactInputBestFee(ARB, WETH, amountInArb);
}
