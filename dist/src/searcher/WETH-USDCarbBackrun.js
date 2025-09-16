"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// src/searcher/arbBackrun.ts
require("dotenv/config");
const ethers_1 = require("ethers");
const addresses_arb_1 = require("./dex/addresses.arb");
const abis_1 = require("./dex/abis");
const backrunConfig_1 = require("./backrunConfig");
const hotTxLimiter_1 = require("./limit/hotTxLimiter");
const rpc_1 = require("./rpc");
const provider = new ethers_1.ethers.JsonRpcProvider(process.env.ARB_RPC_URL, { name: "arbitrum", chainId: 42161 });
const wallet = new ethers_1.ethers.Wallet(process.env.PRIVATE_KEY, provider);
const v2 = new ethers_1.ethers.Contract(addresses_arb_1.ADDR.V2_ROUTER, abis_1.UNIV2_ROUTER_ABI, provider);
const v3Quoter = new ethers_1.ethers.Contract(addresses_arb_1.ADDR.V3_QUOTER, abis_1.UNIV3_QUOTER_V2_ABI, provider);
const TOK = {};
let dryRun = backrunConfig_1.CONFIG.DRY_RUN;
async function loadToken(addr) {
    const erc = new ethers_1.ethers.Contract(addr, abis_1.ERC20_ABI, provider);
    const [dec, sym] = await Promise.all([erc.decimals(), erc.symbol()]);
    return { decimals: Number(dec), symbol: String(sym) };
}
async function init() {
    (0, addresses_arb_1.validateAddresses)();
    (0, hotTxLimiter_1.initHotTxLimiter)();
    for (const k of ["WETH", "USDC", "USDCe"]) {
        const addr = addresses_arb_1.ADDR[k];
        if (addr)
            TOK[k] = await loadToken(addr);
    }
    console.log("Backrunner init OK. Account:", wallet.address);
    console.log("Routers:", { v2: addresses_arb_1.ADDR.V2_ROUTER, v3Quoter: addresses_arb_1.ADDR.V3_QUOTER, v3Router02: addresses_arb_1.ADDR.V3_ROUTER02 });
    console.log("Pairs:", addresses_arb_1.PAIRS);
    console.log("Config:", { ...backrunConfig_1.CONFIG, DRY_RUN: dryRun });
    console.log("Hot TX limiter:", (0, hotTxLimiter_1.describeLimiter)());
}
function f(x, d) { return ethers_1.ethers.formatUnits(x, d); }
async function quoteV2(amountIn, path) {
    const amounts = await (0, rpc_1.withRetry)("v2.getAmountsOut", () => v2.getAmountsOut(amountIn, path));
    return amounts[amounts.length - 1];
}
async function quoteV3Single(tokenIn, tokenOut, fee, amountIn) {
    const params = { tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0 };
    const res = await (0, rpc_1.withRetry)("v3.quoteExactInputSingle", () => v3Quoter.quoteExactInputSingle.staticCall(params));
    return res[0];
}
async function scanBlock(blockNumber) {
    const now = new Date().toISOString();
    const opps = [];
    for (const p of addresses_arb_1.PAIRS) {
        const A = addresses_arb_1.ADDR[p.a];
        const B = addresses_arb_1.ADDR[p.b];
        const decA = TOK[p.a].decimals;
        const notionalA = ethers_1.ethers.parseUnits(backrunConfig_1.CONFIG.PROBE_NOTIONAL_A.toString(), decA);
        const pathAB = [A, B];
        const pathBA = [B, A];
        try {
            const v3Out = await quoteV3Single(A, B, p.v3Fee, notionalA);
            const v2Back = await quoteV2(v3Out, pathBA);
            const gross1 = v2Back - notionalA;
            const v2Out = await quoteV2(notionalA, pathAB);
            const v3Back = await quoteV3Single(B, A, p.v3Fee, v2Out);
            const gross2 = v3Back - notionalA;
            if (gross1 > 0n)
                opps.push({ pair: p, dir: "V3->V2", grossA: gross1, notionalA, block: blockNumber });
            if (gross2 > 0n)
                opps.push({ pair: p, dir: "V2->V3", grossA: gross2, notionalA, block: blockNumber });
        }
        catch (e) {
            console.warn(`[warn] quotes failed for ${p.a}/${p.b} @ block ${blockNumber}: ${e?.shortMessage || e?.message || e}`);
        }
    }
    if (!opps.length) {
        console.log(`[${now}] #${blockNumber} no opps`);
        return;
    }
    // Best opp for this block
    opps.sort((a, b) => (a.grossA > b.grossA ? -1 : 1));
    const best = opps[0];
    const decA = TOK[best.pair.a].decimals;
    console.log(`[${now}] #${blockNumber} BEST ${best.dir} ${best.pair.a}/${best.pair.b} fee=${best.pair.v3Fee} grossΔ=${f(best.grossA, decA)} ${best.pair.a}`);
    if (dryRun)
        return;
    if (!(0, hotTxLimiter_1.canSend)()) {
        console.log(`[limit] TX cap reached. Policy=${backrunConfig_1.CONFIG.ON_TX_LIMIT}.`);
        if (backrunConfig_1.CONFIG.ON_TX_LIMIT === "dry_run") {
            dryRun = true;
            console.log(`[limit] Switching to DRY_RUN.`);
            return;
        }
        process.exit(0);
    }
    // === EXECUTION HOOK (wire your router call here) ===
    // await executeWithRouter(best);
    // On success:
    // recordSend();
    console.log(`[send] (sim) would execute ${best.dir} notional=${f(best.notionalA, TOK[best.pair.a].decimals)} ${best.pair.a}`);
    (0, hotTxLimiter_1.recordSend)();
    console.log(`[limit] TX recorded. Remaining=${(0, hotTxLimiter_1.remaining)() === Infinity ? "∞" : (0, hotTxLimiter_1.remaining)()}.`);
    if (!(0, hotTxLimiter_1.canSend)()) {
        if (backrunConfig_1.CONFIG.ON_TX_LIMIT === "dry_run") {
            dryRun = true;
            console.log(`[limit] Cap reached; switching to DRY_RUN.`);
        }
        else {
            process.exit(0);
        }
    }
}
async function main() {
    await init();
    let last = await provider.getBlockNumber();
    console.log("Start polling from block", last);
    setInterval(async () => {
        try {
            const cur = await provider.getBlockNumber();
            if (cur !== last) {
                // reduce RPC load: scan latest only (optional toggle)
                if (backrunConfig_1.CONFIG.SCAN_LATEST_ONLY) {
                    await scanBlock(cur);
                }
                else {
                    for (let b = last + 1; b <= cur; b++)
                        await scanBlock(b);
                }
                last = cur;
            }
        }
        catch (e) {
            console.error("poll err", e);
        }
    }, backrunConfig_1.CONFIG.POLL_INTERVAL_MS);
}
main().catch(e => { console.error(e); process.exit(1); });
