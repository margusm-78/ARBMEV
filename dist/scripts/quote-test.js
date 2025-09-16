"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// scripts/quote-test.ts
require("dotenv/config");
const ethers_1 = require("ethers");
const config_1 = require("../src/searcher/config");
const utils_1 = require("./utils");
// Correct QuoterV2 ABI (struct order: amountIn before fee)
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
    }
];
function parseArgs(argv = process.argv.slice(2)) {
    const out = {};
    for (let i = 0; i < argv.length; i++) {
        const t = argv[i];
        if (!t.startsWith("--"))
            continue;
        const eq = t.indexOf("=");
        if (eq > -1)
            out[t.slice(2, eq)] = t.slice(eq + 1);
        else if (argv[i + 1] && !argv[i + 1].startsWith("--")) {
            out[t.slice(2)] = argv[i + 1];
            i++;
        }
        else
            out[t.slice(2)] = "true";
    }
    return out;
}
async function main() {
    const args = parseArgs();
    const amountArb = args.amount ?? "0.02"; // default 0.02 ARB
    const fee = Number(args.fee ?? config_1.CONFIG.uni.priceFee ?? 3000);
    const provider = (0, utils_1.makeProvider)();
    const ARB = utils_1.TOKENS_LC["arb"];
    const WETH = utils_1.TOKENS_LC["weth"];
    if (!ARB || !WETH)
        throw new Error("Missing ARB/WETH in TOKENS_LC");
    const quoter = new ethers_1.ethers.Contract(config_1.CONFIG.uni.quoter, QUOTER_V2_ABI, provider);
    const amountIn = ethers_1.ethers.parseUnits(amountArb, 18);
    const res = await quoter.quoteExactInputSingle.staticCall({
        tokenIn: ARB,
        tokenOut: WETH,
        amountIn,
        fee,
        sqrtPriceLimitX96: 0n,
    });
    const out = res?.amountOut ?? res;
    console.log(`Quote ARB->WETH: amountIn=${amountArb} ARB via fee=${fee}`);
    console.log(`amountOut (wei) = ${out.toString()}`);
    console.log(`amountOut (WETH)= ${ethers_1.ethers.formatUnits(out, 18)}`);
}
main().catch((e) => {
    console.error(e);
    process.exit(1);
});
