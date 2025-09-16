"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// scripts/print-config.ts
require("dotenv/config");
const ethers_1 = require("ethers");
const config_1 = require("../src/searcher/config");
function fmtWei(bi) {
    if (typeof bi !== "bigint")
        return "(unset)";
    return `${bi.toString()} wei (${ethers_1.ethers.formatEther(bi)} ETH)`;
}
console.log("=== CONFIG.uni ===");
console.log("factory           =", config_1.CONFIG.uni.factory);
console.log("quoter            =", config_1.CONFIG.uni.quoter);
console.log("priceFee          =", config_1.CONFIG.uni.priceFee);
console.log("minProfitARBWei   =", fmtWei(config_1.CONFIG.uni.minProfitARBWei));
console.log("minProfitWETHWei  =", fmtWei(config_1.CONFIG.uni.minProfitWETHWei));
console.log("pools (n)         =", config_1.CONFIG.uni.pools?.length ?? 0);
config_1.CONFIG.uni.pools?.forEach((p, i) => {
    console.log(`  [${i}] ${p.name} fee=${p.fee} pool=${p.address} token0=${p.token0} token1=${p.token1}`);
});
console.log("\n=== ROUTERS ===");
console.log("swapRouter02      =", config_1.ROUTERS.swapRouter02);
// If your config ever adds a Universal Router, log it too:
console.log("universalRouter   =", config_1.ROUTERS.universalRouter ?? "(not set)");
console.log("\n=== ENV (key items) ===");
console.log("ARB_RPC_URL set   =", !!process.env.ARB_RPC_URL);
console.log("ARB_WS_URL_PRIMARY=", process.env.ARB_WS_URL_PRIMARY ?? "(unset)");
console.log("ROUTER_ADDRESS    =", process.env.ROUTER_ADDRESS ?? "(unset)");
console.log("PRIVATE_KEY set   =", !!process.env.PRIVATE_KEY);
