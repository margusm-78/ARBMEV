"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// src/searcher/preflightArb.ts
require("dotenv/config");
const ethers_1 = require("ethers");
const addresses_arb_1 = require("./dex/addresses.arb");
const abis_1 = require("./dex/abis");
const backrunConfig_1 = require("./backrunConfig");
const http = new ethers_1.ethers.JsonRpcProvider(process.env.ARB_RPC_URL, { name: "arbitrum", chainId: 42161 });
const wallet = new ethers_1.ethers.Wallet(process.env.PRIVATE_KEY, http);
function f(x, d) { return ethers_1.ethers.formatUnits(x, d); }
async function ercInfo(token) {
    const erc = new ethers_1.ethers.Contract(token, abis_1.ERC20_ABI, http);
    const [name, symbol, decimals, balance] = await Promise.all([
        erc.name(), erc.symbol(), erc.decimals(), erc.balanceOf(wallet.address)
    ]);
    return { name, symbol, decimals: Number(decimals), balance: balance };
}
async function allowance(owner, token, spender) {
    const erc = new ethers_1.ethers.Contract(token, abis_1.ERC20_ABI, http);
    return (await erc.allowance(owner, spender));
}
async function v2Out(amountIn, path) {
    const v2 = new ethers_1.ethers.Contract(addresses_arb_1.ADDR.V2_ROUTER, abis_1.UNIV2_ROUTER_ABI, http);
    const amounts = await v2.getAmountsOut(amountIn, path);
    return amounts[amounts.length - 1];
}
async function v2Best(amountIn, from, to) {
    const tries = [[from, to]];
    if (addresses_arb_1.ADDR.USDC)
        tries.push([from, addresses_arb_1.ADDR.USDC, to]);
    if (addresses_arb_1.ADDR.USDCe)
        tries.push([from, addresses_arb_1.ADDR.USDCe, to]);
    let best = null;
    for (const p of tries) {
        try {
            const out = await v2Out(amountIn, p);
            if (!best || out > best.out)
                best = { path: p, out };
        }
        catch { /* ignore */ }
    }
    if (!best)
        throw new Error("no v2 path succeeded");
    return best;
}
async function v3Single(tokenIn, tokenOut, fee, amountIn) {
    const v3Quoter = new ethers_1.ethers.Contract(addresses_arb_1.ADDR.V3_QUOTER, abis_1.UNIV3_QUOTER_V2_ABI, http);
    const params = { tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0 };
    // QuoterV2 must be static-called in ethers v6
    const res = await v3Quoter.quoteExactInputSingle.staticCall(params);
    return res[0];
}
async function v3Pool(A, B, fee) {
    const fac = new ethers_1.ethers.Contract(addresses_arb_1.ADDR.V3_FACTORY, abis_1.UNIV3_FACTORY_ABI, http);
    return await fac.getPool(A, B, fee);
}
async function main() {
    console.log("=== ARBITRUM PREFLIGHT ===");
    console.log("RPC:", process.env.ARB_RPC_URL || "(missing)");
    console.log("Account:", wallet.address);
    console.log("MinProfit USDC:", backrunConfig_1.CONFIG.MIN_PROFIT_USDC, "Probe Notional A:", backrunConfig_1.CONFIG.PROBE_NOTIONAL_A);
    const table = (0, addresses_arb_1.debugAddressResolution)();
    console.log("\nAddress resolution:");
    console.log(JSON.stringify(table, null, 2));
    (0, addresses_arb_1.validateAddresses)();
    const tokens = ["ARB", "WETH", "USDC", "USDCe"].filter(k => addresses_arb_1.ADDR[k]);
    const info = {};
    for (const t of tokens) {
        const addr = addresses_arb_1.ADDR[t];
        const i = await ercInfo(addr);
        info[t] = i;
        console.log(`\nToken ${t} @ ${addr}`);
        console.log(`  name=${i.name} symbol=${i.symbol} decimals=${i.decimals}`);
        console.log(`  balance=${f(i.balance, i.decimals)}`);
    }
    for (const t of tokens) {
        const addr = addresses_arb_1.ADDR[t];
        const alV2 = await allowance(wallet.address, addr, addresses_arb_1.ADDR.V2_ROUTER);
        const alV3 = await allowance(wallet.address, addr, addresses_arb_1.ADDR.V3_ROUTER02);
        console.log(`Allowance ${t}:`);
        console.log(`  V2_ROUTER(${addresses_arb_1.ADDR.V2_ROUTER}) = ${alV2.toString()}`);
        console.log(`  V3_ROUTER02(${addresses_arb_1.ADDR.V3_ROUTER02}) = ${alV3.toString()}`);
    }
    // Pool discovery for v3 (should be 0xc6f78049...d6396a for ARB/WETH@500)
    const pools = [];
    for (const p of addresses_arb_1.PAIRS) {
        const A = addresses_arb_1.ADDR[p.a];
        const B = addresses_arb_1.ADDR[p.b];
        const pool = await v3Pool(A, B, p.v3Fee);
        if (pool && pool !== ethers_1.ethers.ZeroAddress)
            pools.push(ethers_1.ethers.getAddress(pool));
    }
    console.log("\nDiscovered Uniswap V3 pools:", pools.length ? pools : "(none)");
    // Quotes
    const probe = backrunConfig_1.CONFIG.PROBE_NOTIONAL_A;
    console.log(`\n--- Dry-run quotes (probe = ${probe} of token A) ---`);
    for (const p of addresses_arb_1.PAIRS) {
        const A = addresses_arb_1.ADDR[p.a];
        const B = addresses_arb_1.ADDR[p.b];
        const decA = info[p.a].decimals;
        const decB = info[p.b].decimals;
        const notionalA = ethers_1.ethers.parseUnits(probe.toString(), decA);
        try {
            const v3Out = await v3Single(A, B, p.v3Fee, notionalA);
            const bestBack = await v2Best(v3Out, B, A); // V3->V2
            const gross1 = bestBack.out - notionalA;
            const bestOut = await v2Best(notionalA, A, B); // V2->V3
            const v3Back = await v3Single(B, A, p.v3Fee, bestOut.out);
            const gross2 = v3Back - notionalA;
            console.log(`\nPair ${p.a}/${p.b} (fee ${p.v3Fee})`);
            console.log(`  A->B (V3): ${p.a} ${probe} -> ${p.b} ${ethers_1.ethers.formatUnits(v3Out, decB)}`);
            console.log(`  B->A (V2): via [${bestBack.path.join(" -> ")}] -> ${p.a} ${ethers_1.ethers.formatUnits(bestBack.out, decA)} | grossΔ=${ethers_1.ethers.formatUnits(gross1, decA)} ${p.a}`);
            console.log(`  A->B (V2): via [${bestOut.path.join(" -> ")}] -> ${p.b} ${ethers_1.ethers.formatUnits(bestOut.out, decB)}`);
            console.log(`  B->A (V3): -> ${p.a} ${ethers_1.ethers.formatUnits(v3Back, decA)} | grossΔ=${ethers_1.ethers.formatUnits(gross2, decA)} ${p.a}`);
        }
        catch (e) {
            console.warn(`  [warn] quotes failed for ${p.a}/${p.b}: ${e?.shortMessage || e?.message || e}`);
        }
    }
    console.log("\nPreflight complete.");
}
main().catch(e => { console.error(e); process.exit(1); });
