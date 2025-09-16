"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const ethers_1 = require("ethers");
const price_1 = require("./price");
function getProvider() {
    const url = process.env.ANVIL_URL || process.env.ARB_RPC_URL || process.env.ARB_RPC_URL_BACKUP;
    if (!url)
        throw new Error('Set ANVIL_URL or ARB_RPC_URL');
    return new ethers_1.ethers.JsonRpcProvider(url, { name: 'arbitrum', chainId: 42161 });
}
const eq = (a, b) => a.toLowerCase() === b.toLowerCase();
function sym(addr) {
    const a = addr.toLowerCase();
    if (eq(a, price_1.ADDR.WETH))
        return 'WETH';
    if (eq(a, price_1.ADDR.USDT))
        return 'USDT';
    if (eq(a, price_1.ADDR.USDC_NATIVE))
        return 'USDC';
    if (eq(a, price_1.ADDR.USDC_E))
        return 'USDC.e';
    return a.slice(0, 6) + '…' + a.slice(-4);
}
function v2Name(router) {
    const r = router.toLowerCase();
    if (eq(r, price_1.ADDR.SUSHI_V2))
        return 'Sushi V2';
    if (eq(r, price_1.ADDR.CAMELOT_V2))
        return 'Camelot V2';
    return 'V2';
}
function labelFor(best) {
    if (best.dex === 'V2') {
        const name = v2Name(best.router);
        const pathLabel = best.path.map(sym).join('→');
        return `V2 ${name} ${pathLabel}`;
    }
    else {
        const out = sym(best.tokenOut);
        if (best.kind === 'single')
            return `V3 single WETH→${out}`;
        return `V3 multi WETH→USDT→${out}`;
    }
}
function outSymbol(best) {
    const outAddr = best.dex === 'V2' ? best.path[best.path.length - 1] : best.tokenOut;
    return sym(outAddr);
}
async function main() {
    const provider = getProvider();
    const amountIn = ethers_1.ethers.parseEther(process.env.PROBE_NOTIONAL_A || '0.1');
    const best = await (0, price_1.quoteBestWethToStable)(provider, amountIn);
    if (!best)
        throw new Error('No route found');
    const out = best.amountOut;
    console.log(`[SIM:once] ${labelFor(best)}  out≈${(0, price_1.formatUSDC)(out)} ${outSymbol(best)}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
