"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// src/searcher/preflightArb.ts
require("dotenv/config");
const ethers_1 = require("ethers");
const addresses_arb_1 = require("./dex/addresses.arb");
const abis_1 = require("./dex/abis");
const backrunConfig_1 = require("./backrunConfig");
const rpc_1 = require("./rpc");
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
async function quoteV2(v2, amountIn, path) {
    const amounts = await (0, rpc_1.withRetry)("v2.getAmountsOut", () => v2.getAmountsOut(amountIn, path));
    return amounts[amounts.length - 1];
}
// QuoterV2 must be static-called in ethers v6, and retried on 429s
async function quoteV3Single(v3Quoter, tokenIn, tokenOut, fee, amountIn) {
    const params = { tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0 };
    const res = await (0, rpc_1.withRetry)("v3.quoteExactInputSingle", () => v3Quoter.quoteExactInputSingle.staticCall(params));
    return res[0];
}
async function getV3PoolsForPairs(v3Factory) {
    const pools = [];
    for (const p of addresses_arb_1.PAIRS) {
        const A = addresses_arb_1.ADDR[p.a];
        const B = addresses_arb_1.ADDR[p.b];
        const pool = await v3Factory.getPool(A, B, p.v3Fee);
        if (pool && pool !== ethers_1.ethers.ZeroAddress)
            pools.push(ethers_1.ethers.getAddress(pool));
    }
    return pools;
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
    const v2 = new ethers_1.ethers.Contract(addresses_arb_1.ADDR.V2_ROUTER, abis_1.UNIV2_ROUTER_ABI, http);
    const v3Quoter = new ethers_1.ethers.Contract(addresses_arb_1.ADDR.V3_QUOTER, abis_1.UNIV3_QUOTER_V2_ABI, http);
    const v3Factory = new ethers_1.ethers.Contract(addresses_arb_1.ADDR.V3_FACTORY, abis_1.UNIV3_FACTORY_ABI, http);
    const tokens = ["WETH", "USDC", "USDCe"].filter(k => addresses_arb_1.ADDR[k]);
    const infos = {};
    for (const t of tokens) {
        const addr = addresses_arb_1.ADDR[t];
        const info = await ercInfo(addr);
        infos[t] = info;
        console.log(`\nToken ${t} @ ${addr}`);
        console.log(`  name=${info.name} symbol=${info.symbol} decimals=${info.decimals}`);
        console.log(`  balance=${f(info.balance, info.decimals)}`);
    }
    for (const t of tokens) {
        const addr = addresses_arb_1.ADDR[t];
        const alV2 = await allowance(wallet.address, addr, addresses_arb_1.ADDR.V2_ROUTER);
        const alV3 = await allowance(wallet.address, addr, addresses_arb_1.ADDR.V3_ROUTER02);
        console.log(`Allowance ${t}:`);
        console.log(`  V2_ROUTER(${addresses_arb_1.ADDR.V2_ROUTER}) = ${alV2.toString()}`);
        console.log(`  V3_ROUTER02(${addresses_arb_1.ADDR.V3_ROUTER02}) = ${alV3.toString()}`);
    }
    const pools = await getV3PoolsForPairs(v3Factory);
    console.log("\nDiscovered Uniswap V3 pools:", pools.length ? pools : "(none)");
    const probe = backrunConfig_1.CONFIG.PROBE_NOTIONAL_A;
    console.log(`\n--- Dry-run quotes (probe = ${probe} of token A) ---`);
    for (const p of addresses_arb_1.PAIRS) {
        const A = addresses_arb_1.ADDR[p.a];
        const B = addresses_arb_1.ADDR[p.b];
        const decA = infos[p.a].decimals;
        const decB = infos[p.b].decimals;
        const notionalA = ethers_1.ethers.parseUnits(probe.toString(), decA);
        const pathAB = [A, B];
        const pathBA = [B, A];
        try {
            const v3Out = await quoteV3Single(v3Quoter, A, B, p.v3Fee, notionalA);
            const v2Back = await quoteV2(v2, v3Out, pathBA);
            const gross1 = v2Back - notionalA;
            const v2Out = await quoteV2(v2, notionalA, pathAB);
            const v3Back = await quoteV3Single(v3Quoter, B, A, p.v3Fee, v2Out);
            const gross2 = v3Back - notionalA;
            console.log(`\nPair ${p.a}/${p.b} (fee ${p.v3Fee})`);
            console.log(`  A->B (V3): ${p.a} ${probe} -> ${p.b} ${ethers_1.ethers.formatUnits(v3Out, decB)}`);
            console.log(`  B->A (V2): -> ${p.a} ${ethers_1.ethers.formatUnits(v2Back, decA)} | grossΔ=${ethers_1.ethers.formatUnits(gross1, decA)} ${p.a}`);
            console.log(`  A->B (V2): ${p.a} ${probe} -> ${p.b} ${ethers_1.ethers.formatUnits(v2Out, decB)}`);
            console.log(`  B->A (V3): -> ${p.a} ${ethers_1.ethers.formatUnits(v3Back, decA)} | grossΔ=${ethers_1.ethers.formatUnits(gross2, decA)} ${p.a}`);
        }
        catch (e) {
            console.warn(`  [warn] quotes failed for ${p.a}/${p.b}: ${e?.shortMessage || e?.message || e}`);
        }
    }
    console.log("\nPreflight complete.");
}
main().catch(e => {
    console.error(e);
    process.exit(1);
});
