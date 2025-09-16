"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getQuoteWithFallback = getQuoteWithFallback;
// src/searcher/quoteStrategy.ts
const ethers_1 = require("ethers");
const resilientProvider_1 = require("./resilientProvider");
/**
 * Uniswap V3 Quoter V2 ABI (correct struct order for QuoteExactInputSingleParams):
 * tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96
 * Both functions are nonpayable on V2; we call with staticCall.
 */
const QUOTER_V2_ABI = [
    {
        "type": "function",
        "stateMutability": "nonpayable",
        "outputs": [
            { "type": "uint256", "name": "amountOut", "internalType": "uint256" },
            { "type": "uint160", "name": "sqrtPriceX96After", "internalType": "uint160" },
            { "type": "uint32", "name": "initializedTicksCrossed", "internalType": "uint32" },
            { "type": "uint256", "name": "gasEstimate", "internalType": "uint256" }
        ],
        "name": "quoteExactInputSingle",
        "inputs": [
            {
                "type": "tuple",
                "name": "params",
                "components": [
                    { "type": "address", "name": "tokenIn", "internalType": "address" },
                    { "type": "address", "name": "tokenOut", "internalType": "address" },
                    { "type": "uint256", "name": "amountIn", "internalType": "uint256" },
                    { "type": "uint24", "name": "fee", "internalType": "uint24" },
                    { "type": "uint160", "name": "sqrtPriceLimitX96", "internalType": "uint160" }
                ],
                "internalType": "struct IQuoterV2.QuoteExactInputSingleParams"
            }
        ]
    },
    {
        "type": "function",
        "stateMutability": "nonpayable",
        "outputs": [
            { "type": "uint256", "name": "amountOut", "internalType": "uint256" },
            { "type": "uint160", "name": "sqrtPriceX96After", "internalType": "uint160" },
            { "type": "uint32", "name": "initializedTicksCrossed", "internalType": "uint32" },
            { "type": "uint256", "name": "gasEstimate", "internalType": "uint256" }
        ],
        "name": "quoteExactInput",
        "inputs": [
            { "type": "bytes", "name": "path", "internalType": "bytes" },
            { "type": "uint256", "name": "amountIn", "internalType": "uint256" }
        ]
    }
];
/** Encode a single-hop V3 path. */
function encodeV3Path(tokens, fees) {
    if (tokens.length !== fees.length + 1)
        throw new Error("encodeV3Path: tokens.length must equal fees.length + 1");
    let hex = "0x";
    for (let i = 0; i < fees.length; i++) {
        const t = tokens[i];
        const fee = fees[i];
        hex += t.slice(2);
        hex += fee.toString(16).padStart(6, "0");
    }
    hex += tokens[tokens.length - 1].slice(2);
    return hex.toLowerCase();
}
/** Try Single; if revert, try Path. Return bigint amountOut + method used. */
async function quoteSingleOrPath(quoterAddr, tokenIn, tokenOut, fee, amountIn) {
    return resilientProvider_1.RP.withProvider(async (p) => {
        const quoter = new ethers_1.ethers.Contract(quoterAddr, QUOTER_V2_ABI, p);
        // 1) exactInputSingle with correct struct order
        try {
            const res1 = await quoter.quoteExactInputSingle.staticCall({
                tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0n,
            });
            const out = res1?.amountOut ?? res1;
            return { amountOut: BigInt(out), method: "single" };
        }
        catch (e1) {
            // 2) exactInput(path)
            try {
                const path = encodeV3Path([tokenIn, tokenOut], [fee]);
                const res2 = await quoter.quoteExactInput.staticCall(path, amountIn);
                const out = res2?.amountOut ?? res2;
                return { amountOut: BigInt(out), method: "path" };
            }
            catch (e2) {
                const m1 = e1?.shortMessage || e1?.message || String(e1);
                const m2 = e2?.shortMessage || e2?.message || String(e2);
                throw new Error(`quoter revert: single='${m1}', path='${m2}'`);
            }
        }
    });
}
/**
 * Liquidity-aware fee fallback:
 *  - 0.3% (3000): full amount
 *  - 0.05% (500): 1/4 amount
 *  - 1.0%  (10000): 1/2 amount
 * Optionally re-quote the chosen fee with the full base amount.
 */
async function getQuoteWithFallback(quoterAddr, tokenIn, tokenOut, baseAmount, opts) {
    const log = opts?.log ?? true;
    const configs = opts?.configs ??
        [
            { fee: 3000, name: "0.3%", num: 1n, den: 1n }, // full
            { fee: 500, name: "0.05%", num: 1n, den: 4n }, // quarter
            { fee: 10000, name: "1.0%", num: 1n, den: 2n }, // half
        ];
    let lastErr = null;
    for (const cfg of configs) {
        const amountInUsed = (baseAmount * cfg.num) / cfg.den;
        if (amountInUsed <= 0n)
            continue;
        try {
            if (log) {
                console.log(`Trying ${cfg.name} pool with ${ethers_1.ethers.formatUnits(amountInUsed, 18)} (base=${ethers_1.ethers.formatUnits(baseAmount, 18)})...`);
            }
            const r = await quoteSingleOrPath(quoterAddr, tokenIn, tokenOut, cfg.fee, amountInUsed);
            if (log) {
                console.log(`  ✅ ${cfg.name} quote via ${r.method}: ${ethers_1.ethers.formatUnits(r.amountOut, 18)}`);
            }
            // Optionally confirm full amount on the chosen fee
            if (opts?.confirmFullAmount !== false && amountInUsed !== baseAmount) {
                try {
                    const full = await quoteSingleOrPath(quoterAddr, tokenIn, tokenOut, cfg.fee, baseAmount);
                    if (log) {
                        console.log(`  ↺ re-quoted full on ${cfg.name}: ${ethers_1.ethers.formatUnits(full.amountOut, 18)}`);
                    }
                    return {
                        amountOut: full.amountOut,
                        feeUsed: cfg.fee,
                        amountInUsed: baseAmount,
                        poolName: cfg.name,
                        method: full.method,
                    };
                }
                catch {
                    // keep scaled result if full fails
                    return {
                        amountOut: r.amountOut,
                        feeUsed: cfg.fee,
                        amountInUsed,
                        poolName: cfg.name,
                        method: r.method,
                    };
                }
            }
            return {
                amountOut: r.amountOut,
                feeUsed: cfg.fee,
                amountInUsed,
                poolName: cfg.name,
                method: r.method,
            };
        }
        catch (e) {
            lastErr = e;
            if (log) {
                const msg = e?.shortMessage || e?.message || String(e);
                console.log(`  ❌ ${cfg.name} failed: ${msg}`);
            }
        }
    }
    throw new Error(`All pools failed for ${tokenIn}->${tokenOut}; last error: ${lastErr?.message || String(lastErr)}`);
}
