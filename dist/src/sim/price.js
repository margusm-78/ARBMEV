"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ADDR = void 0;
exports.quoteAlongRoute = quoteAlongRoute;
exports.quoteBestWethToStable = quoteBestWethToStable;
exports.quoteEthToUsdc = quoteEthToUsdc;
// src/sim/price.ts
const ethers_1 = require("ethers");
/* -------------------- Addresses (Arbitrum One) -------------------- */
exports.ADDR = {
    // Tokens
    WETH: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    USDC_NATIVE: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    USDC_E: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8',
    USDT: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
    // Routers / infra
    V2_SUSHI: '0x1b02da8cb0d097eb8d57a175b88c7d8b47997506', // UniswapV2Router02
    V2_CAMELOT: '0xc873fEcbD354f5A56E00E710B90Ef4201db2448d', // Camelot V2 (referrer param)
    V3_ROUTER: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
    V3_QUOTER_V2: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
};
/* -------------------- Minimal ABIs -------------------- */
const QUOTER_V2_ABI = [
    'function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) view returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)',
    'function quoteExactInput(bytes path,uint256 amountIn) view returns (uint256 amountOut,uint160[] sqrtPriceX96AfterList,uint32[] initializedTicksCrossedList,uint256 gasEstimate)',
];
const V2_ROUTER_ABI = [
    'function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)',
    'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
];
const CAMELOT_V2_ROUTER_ABI = [
    'function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)',
    'function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, address referrer, uint deadline) external',
];
function fee3Bytes(fee) { return fee.toString(16).padStart(6, '0'); }
function cleanAddr(a) { return a.toLowerCase().replace(/^0x/, ''); }
function encodeV3Path2Hop(a, feeAB, b, feeBC, c) {
    return '0x' + cleanAddr(a) + fee3Bytes(feeAB) + cleanAddr(b) + fee3Bytes(feeBC) + cleanAddr(c);
}
function asBigInt(x) {
    if (typeof x === 'bigint')
        return x;
    if (typeof x === 'number')
        return BigInt(Math.floor(x));
    return BigInt(x.toString());
}
/* -------------------- V3 quoting -------------------- */
async function quoteV3Single(p, tokenIn, tokenOut, amountIn, fee) {
    const quoter = new ethers_1.ethers.Contract(exports.ADDR.V3_QUOTER_V2, QUOTER_V2_ABI, p);
    try {
        const params = { tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0n };
        const [amountOut] = await quoter.quoteExactInputSingle(params);
        return asBigInt(amountOut);
    }
    catch {
        return null;
    }
}
async function quoteV3Multi(p, a, feeAB, b, feeBC, c, amountIn) {
    const quoter = new ethers_1.ethers.Contract(exports.ADDR.V3_QUOTER_V2, QUOTER_V2_ABI, p);
    const path = encodeV3Path2Hop(a, feeAB, b, feeBC, c);
    try {
        const [amountOut] = await quoter.quoteExactInput(path, amountIn);
        return asBigInt(amountOut);
    }
    catch {
        return null;
    }
}
/* -------------------- V2 quoting -------------------- */
async function quoteV2(p, router, path, amountIn) {
    const abi = router.toLowerCase() === exports.ADDR.V2_CAMELOT.toLowerCase() ? CAMELOT_V2_ROUTER_ABI : V2_ROUTER_ABI;
    const v2 = new ethers_1.ethers.Contract(router, abi, p);
    try {
        const amounts = await v2.getAmountsOut(amountIn, path);
        return asBigInt(amounts[amounts.length - 1]);
    }
    catch {
        return null;
    }
}
/* -------------------- Public: quote along a chosen route -------------------- */
async function quoteAlongRoute(p, route, amountInWei) {
    if (route.dex === 'V2') {
        const out = await quoteV2(p, route.router, route.path, amountInWei);
        return out ?? 0n;
    }
    if (route.kind === 'single') {
        const out = await quoteV3Single(p, exports.ADDR.WETH, route.tokenOut, amountInWei, route.fee);
        return out ?? 0n;
    }
    // multi
    const out = await quoteV3Multi(p, exports.ADDR.WETH, route.feeAB, exports.ADDR.USDT, route.feeBC, route.tokenOut, amountInWei);
    return out ?? 0n;
}
/* -------------------- Public: Best route for a given notional -------------------- */
async function quoteBestWethToStable(p, amountInWei) {
    let best = null;
    const consider = (cand) => {
        if (!best || cand.amountOut > best.amountOut)
            best = cand;
    };
    // V3 single: WETH -> native USDC
    for (const fee of [500, 3000]) {
        const out = await quoteV3Single(p, exports.ADDR.WETH, exports.ADDR.USDC_NATIVE, amountInWei, fee);
        if (out && out > 0n)
            consider({ dex: 'V3', kind: 'single', tokenOut: exports.ADDR.USDC_NATIVE, fee, amountOut: out });
    }
    // V3 multi: WETH -> USDT -> native USDC
    for (const [feeAB, feeBC] of [[500, 500], [500, 3000], [3000, 500], [3000, 3000]]) {
        const out = await quoteV3Multi(p, exports.ADDR.WETH, feeAB, exports.ADDR.USDT, feeBC, exports.ADDR.USDC_NATIVE, amountInWei);
        if (out && out > 0n)
            consider({ dex: 'V3', kind: 'multi', tokenOut: exports.ADDR.USDC_NATIVE, feeAB, feeBC, amountOut: out });
    }
    // V2 Sushi: WETH -> USDC.e
    {
        const out = await quoteV2(p, exports.ADDR.V2_SUSHI, [exports.ADDR.WETH, exports.ADDR.USDC_E], amountInWei);
        if (out && out > 0n)
            consider({ dex: 'V2', label: 'Sushi V2 WETH→USDC', router: exports.ADDR.V2_SUSHI, path: [exports.ADDR.WETH, exports.ADDR.USDC_E], amountOut: out });
    }
    // V2 Camelot: WETH -> USDC.e
    {
        const out = await quoteV2(p, exports.ADDR.V2_CAMELOT, [exports.ADDR.WETH, exports.ADDR.USDC_E], amountInWei);
        if (out && out > 0n)
            consider({ dex: 'V2', label: 'Camelot V2 WETH→USDC', router: exports.ADDR.V2_CAMELOT, path: [exports.ADDR.WETH, exports.ADDR.USDC_E], amountOut: out });
    }
    return best;
}
/* ------------------------------------------------------------------
   Public: quoteEthToUsdc — convert gas (ETH, wei) → stable (USDC/USDC.e)
   Robust to tiny inputs: returns 0 for 0 wei; otherwise tries direct.
   If direct quotes are 0 or unavailable, compute price at 1 ETH and scale.
-------------------------------------------------------------------*/
async function quoteEthToUsdc(p, amountInWei) {
    if (amountInWei === 0n)
        return 0n;
    // 1) Try direct quotes (USDC then USDC.e; V3 single/multi then V2)
    for (const tokenOut of [exports.ADDR.USDC_NATIVE, exports.ADDR.USDC_E]) {
        for (const fee of [500, 3000]) {
            const out = await quoteV3Single(p, exports.ADDR.WETH, tokenOut, amountInWei, fee);
            if (out && out > 0n)
                return out;
        }
        for (const [feeAB, feeBC] of [[500, 500], [500, 3000], [3000, 500], [3000, 3000]]) {
            const out = await quoteV3Multi(p, exports.ADDR.WETH, feeAB, exports.ADDR.USDT, feeBC, tokenOut, amountInWei);
            if (out && out > 0n)
                return out;
        }
        for (const r of [exports.ADDR.V2_SUSHI, exports.ADDR.V2_CAMELOT]) {
            const out = await quoteV2(p, r, [exports.ADDR.WETH, tokenOut], amountInWei);
            if (out && out > 0n)
                return out;
        }
    }
    // 2) Scale from a robust reference notional to avoid rounding-to-zero
    const ONE_ETH = 10n ** 18n;
    const bestRef = await quoteBestWethToStable(p, ONE_ETH);
    if (!bestRef)
        throw new Error('quoteEthToUsdc: no route found on this fork');
    const outRef = await quoteAlongRoute(p, bestRef, ONE_ETH);
    if (outRef <= 0n)
        throw new Error('quoteEthToUsdc: no route found on this fork');
    // Linear scaling (sufficient for tiny amounts)
    // out ≈ amountInWei * (outRef / 1e18)
    return (amountInWei * outRef) / ONE_ETH;
}
