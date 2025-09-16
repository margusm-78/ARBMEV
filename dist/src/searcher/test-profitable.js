"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// src/searcher/test-profitable.ts
require("dotenv/config");
const ethers_1 = require("ethers");
const cuWrappedProvider_1 = require("./cuWrappedProvider");
const pools_1 = require("./pools");
const price_1 = require("./price");
const cuBudget_1 = require("./cuBudget");
function logCU(tag) {
    const s = (0, cuBudget_1.getCUStatus)();
    console.log(`[CU:${tag}] daily=${s.daily}/${s.dailyLimit} (${s.dailyPct}%) | monthly=${s.monthly}/${s.monthlyLimit} (${s.monthlyPct}%)`);
}
async function runValidate() {
    console.log("=== VALIDATE START ===");
    const provider = await (0, cuWrappedProvider_1.getCUProvider)();
    const chainId = (await provider.getNetwork()).chainId;
    const bn = await provider.getBlockNumber();
    console.log(`[RPC] chainId=${chainId} head=${bn}`);
    logCU("validate-rpc");
    // Resolve pools (UniV3 + Sushi/Camelot V2)
    const { v3, v2 } = await (0, pools_1.resolvePools)();
    console.log(`[POOLS] UniV3=${v3.length}, V2=${v2.length}`);
    logCU("validate-pools");
    // Small quote: ARB -> WETH
    const notionalStr = process.env.PROBE_NOTIONAL_A?.trim() || "0.02";
    const amountInArb = ethers_1.ethers.parseUnits(notionalStr, 18);
    const q = await (0, price_1.quoteArbToWeth)(amountInArb);
    console.log(`[QUOTE] ARB→WETH for ${ethers_1.ethers.formatUnits(amountInArb, 18)} ARB → amountOut=${ethers_1.ethers.formatUnits(q.amountOut, 18)} (feeUsed=${q.feeUsed})`);
    logCU("validate-quote");
    console.log("=== VALIDATE OK ===");
}
async function runTest() {
    console.log("=== TEST MODE ===");
    const provider = await (0, cuWrappedProvider_1.getCUProvider)();
    const bn0 = await provider.getBlockNumber();
    console.log(`[RPC] head=${bn0}`);
    logCU("test-rpc");
    // Do a couple quotes with backoff to exercise caching
    const steps = [0.02, 0.03, 0.02]; // ARB amounts
    for (let i = 0; i < steps.length; i++) {
        const amt = ethers_1.ethers.parseUnits(steps[i].toString(), 18);
        const { amountOut, feeUsed } = await (0, price_1.quoteArbToWeth)(amt);
        console.log(`[TEST#${i + 1}] ARB→WETH ${steps[i]} ARB → ${ethers_1.ethers.formatUnits(amountOut, 18)} WETH (fee=${feeUsed})`);
        logCU(`test-quote-${i + 1}`);
        await new Promise((r) => setTimeout(r, 500));
    }
    const bn1 = await provider.getBlockNumber();
    console.log(`[RPC] head(updated)=${bn1}`);
    logCU("test-final");
    console.log("=== TEST DONE ===");
}
async function runMonitor() {
    console.log("=== MONITOR MODE (CTRL+C to exit) ===");
    const provider = await (0, cuWrappedProvider_1.getCUProvider)();
    let lastLog = Date.now();
    const onBlock = (bn) => {
        const now = Date.now();
        if (now - lastLog > 10_000) {
            const s = (0, cuBudget_1.getCUStatus)();
            console.log(`[WS] head=${bn} | CU daily ${s.dailyPct}% (${s.daily}/${s.dailyLimit})`);
            lastLog = now;
        }
    };
    // ethers v6 polls block numbers on JsonRpcProvider:
    provider.on("block", onBlock);
    const stop = () => {
        try {
            provider.off("block", onBlock);
        }
        catch { }
        console.log("Monitor stopped.");
        process.exit(0);
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    // keep alive
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    await new Promise(() => { });
}
(async () => {
    try {
        const mode = (process.argv[2] || "").trim().toLowerCase();
        if (mode === "test") {
            await runTest();
        }
        else if (mode === "monitor" || mode === "continuous") {
            await runMonitor();
        }
        else {
            // default to validate
            await runValidate();
        }
        // exit cleanly for non-monitor modes
        if (mode !== "monitor" && mode !== "continuous")
            process.exit(0);
    }
    catch (error) {
        console.error("Test script failed:", error?.message || error);
        process.exit(1);
    }
})();
