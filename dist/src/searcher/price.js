"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.quoteExactInputBestFee = quoteExactInputBestFee;
exports.quoteArbToWeth = quoteArbToWeth;
// src/searcher/price.ts
require("dotenv/config");
const ethers_1 = require("ethers");
const config_1 = require("./config");
const univ3_1 = require("./univ3");
const cuWrappedProvider_1 = require("./cuWrappedProvider");
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
                    { name: "tokenIn", type: "address", internalType: "address" },
                    { name: "tokenOut", type: "address", internalType: "address" },
                    { name: "amountIn", type: "uint256", internalType: "uint256" },
                    { name: "fee", type: "uint24", internalType: "uint24" },
                    { name: "sqrtPriceLimitX96", type: "uint160", internalType: "uint160" }
                ],
                internalType: "struct IQuoterV2.QuoteExactInputSingleParams"
            }
        ],
        outputs: [
            { name: "amountOut", type: "uint256", internalType: "uint256" },
            { name: "sqrtPriceX96After", type: "uint160", internalType: "uint160" },
            { name: "initializedTicksCrossed", type: "uint32", internalType: "uint32" },
            { name: "gasEstimate", type: "uint256", internalType: "uint256" }
        ]
    }
];
// Use CONFIG first; fall back to env; then hard default
const QUOTER_ADDRESS = config_1.CONFIG?.uni?.quoter ||
    process.env.UNISWAP_V3_QUOTER_V2 ||
    "0x61fFE014bA17989E743c5F6cB21bF9697530B21e";
function feesToTry() {
    const cfg = Number(config_1.CONFIG?.uni?.priceFee);
    // ensure unique, valid set with a sensible default ordering
    return [Number.isFinite(cfg) && cfg > 0 ? cfg : 500, 500, 3000, 10000].filter((v, i, a) => typeof v === "number" && v > 0 && a.indexOf(v) === i);
}
function decodeErr(err) {
    const short = err?.shortMessage || err?.message;
    const data = err?.info?.error?.data || err?.error?.data;
    const code = err?.code || err?.info?.code;
    if (short)
        return String(short);
    if (data)
        return `reverted (data len=${String(data).length})`;
    if (code)
        return `error code ${code}`;
    return String(err ?? "unknown error");
}
async function staticQuote(provider, params) {
    const quoter = new ethers_1.ethers.Contract(QUOTER_ADDRESS, QUOTER_V2_ABI, provider);
    try {
        const res = await quoter.quoteExactInputSingle.staticCall({
            tokenIn: params.tokenIn,
            tokenOut: params.tokenOut,
            amountIn: params.amountIn,
            fee: params.fee,
            sqrtPriceLimitX96: params.sqrtPriceLimitX96 ?? 0n,
        });
        const out = res?.amountOut ?? res;
        return BigInt(out);
    }
    catch (e) {
        throw new Error(`QuoterV2 revert (fee ${params.fee}) ${params.tokenIn}->${params.tokenOut}: ${decodeErr(e)}`);
    }
}
async function quoteExactInputBestFee(tokenIn, tokenOut, amountIn) {
    const provider = await (0, cuWrappedProvider_1.getCUProvider)(); // CU-tracked + cached provider
    let lastErr = null;
    for (const [i, fee] of feesToTry().entries()) {
        try {
            const amountOut = await staticQuote(provider, { tokenIn, tokenOut, fee, amountIn });
            return { amountOut, feeUsed: fee };
        }
        catch (e) {
            lastErr = e;
            // light backoff between fee tiers
            await new Promise((r) => setTimeout(r, 120 + i * 60));
        }
    }
    throw new Error(`Quoter failed ${tokenIn}->${tokenOut}. Last error: ${lastErr?.message ?? String(lastErr)}`);
}
/** Primary: ARB -> WETH quote */
async function quoteArbToWeth(amountInArb) {
    const ARB = (0, univ3_1.tokenAddress)("ARB");
    const WETH = (0, univ3_1.tokenAddress)("WETH");
    return quoteExactInputBestFee(ARB, WETH, amountInArb);
}
