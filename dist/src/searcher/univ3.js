"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tokenAddress = tokenAddress;
exports.quoteExactInputSingle = quoteExactInputSingle;
exports.resolveTwoArbWethPools = resolveTwoArbWethPools;
exports.applySlippage = applySlippage;
const ethers_1 = require("ethers");
const abi_helpers_1 = require("../abi-helpers");
const config_1 = require("./config");
const resilientProvider_1 = require("./resilientProvider");
/* ---------- Minimal ABIs ---------- */
const QuoterV2Abi = [
    "function quoteExactInputSingle((address tokenIn,address tokenOut,uint24 fee,uint256 amountIn,uint160 sqrtPriceLimitX96)) view returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
];
const FactoryAbi = [
    "function getPool(address tokenA,address tokenB,uint24 fee) view returns (address pool)",
];
const PoolAbi = [
    "function slot0() view returns (uint160 sqrtPriceX96,int24 tick,uint16 observationIndex,uint16 observationCardinality,uint16 observationCardinalityNext,uint8 feeProtocol,bool unlocked)",
    "function liquidity() view returns (uint128)",
];
/* ---------- Helpers ---------- */
function tokenAddress(symbol) {
    // @ts-ignore
    const addr = config_1.CONFIG.tokens[symbol];
    if (!addr || !ethers_1.ethers.isAddress(addr))
        throw new Error(`Bad token addr for ${symbol}: ${addr}`);
    return ethers_1.ethers.getAddress(addr);
}
/** Return [ {fee, pool} ] for fees that have a live pool w/ non-zero liquidity */
async function feesWithLivePools(tokenA, tokenB, fees) {
    const factoryAddr = config_1.CONFIG.uni.factory;
    const out = [];
    for (const fee of fees) {
        try {
            const poolAddr = await resilientProvider_1.RP.withProvider((p) => new ethers_1.ethers.Contract(factoryAddr, (0, abi_helpers_1.asInterfaceAbi)(FactoryAbi), p).getPool(tokenA, tokenB, fee));
            if (!poolAddr || poolAddr === ethers_1.ethers.ZeroAddress)
                continue;
            const [slot0, liq] = await Promise.all([
                resilientProvider_1.RP.withProvider((p) => new ethers_1.ethers.Contract(poolAddr, (0, abi_helpers_1.asInterfaceAbi)(PoolAbi), p).slot0()),
                resilientProvider_1.RP.withProvider((p) => new ethers_1.ethers.Contract(poolAddr, (0, abi_helpers_1.asInterfaceAbi)(PoolAbi), p).liquidity()),
            ]);
            const sqrt = slot0 ? slot0[0] : 0n;
            const liquidity = typeof liq === "bigint" ? liq : 0n;
            if (sqrt !== 0n && liquidity > 0n)
                out.push({ fee, pool: poolAddr });
        }
        catch {
            // ignore fee tier if any call fails
        }
    }
    return out;
}
/** Hardened QuoterV2 exactInputSingle */
async function quoteExactInputSingle(_provider, // kept for signature parity
fee, tokenIn, tokenOut, amountIn) {
    const quoter = config_1.CONFIG.uni.quoter;
    let lastErr = null;
    try {
        const quoted = await resilientProvider_1.RP.withProvider((p) => new ethers_1.ethers.Contract(quoter, (0, abi_helpers_1.asInterfaceAbi)(QuoterV2Abi), p)
            .quoteExactInputSingle
            .staticCall({ tokenIn, tokenOut, fee, amountIn, sqrtPriceLimitX96: 0 }));
        const amountOut = quoted?.amountOut ?? quoted;
        return amountOut;
    }
    catch (e) {
        lastErr = e;
    }
    throw new Error(`Quoter failed inputSingle: tokenIn=${tokenIn}, tokenOut=${tokenOut}, fee=${fee}, amountIn=${amountIn.toString()} :: ${lastErr?.message || lastErr}`);
}
/** Pick two ARB/WETH fees (present & live) for 2-hop (ARB->WETH on feeA, WETH->ARB on feeB) */
async function resolveTwoArbWethPools(preferredFees) {
    const ARB = tokenAddress("ARB");
    const WETH = tokenAddress("WETH");
    // Check both directions share the same live fee set
    const live = await feesWithLivePools(ARB, WETH, preferredFees);
    if (live.length < 2) {
        // if only one available, still return it twice (exec will be skipped unless profitable)
        const f0 = live[0]?.fee ?? preferredFees[0];
        return { feeA: f0, feeB: f0, poolA: live[0]?.pool, poolB: live[0]?.pool };
    }
    // Use top two in the given priority
    const feeA = live[0].fee;
    const feeB = live[1].fee;
    return { feeA, feeB, poolA: live[0].pool, poolB: live[1].pool };
}
/** Basis-point slippage */
function applySlippage(amount, bps, negative = true) {
    const num = amount * BigInt(10000 + (negative ? -bps : bps));
    return num / 10000n;
}
