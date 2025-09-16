"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.execLiquidation = execLiquidation;
// src/searcher/liquidation.ts
require("dotenv/config");
const ethers_1 = require("ethers");
const config_1 = require("./config");
const aave_1 = require("./aave");
const radiant_1 = require("./radiant");
const universalRouter_1 = require("./universalRouter");
// Pull ONLY the ABI array for ethers v6
const { abi: ArbiRouterAbi } = require("./abi/ArbiSearcherRouter.json");
function reqAddr(label, v) {
    const s = (v || "").trim();
    if (!ethers_1.ethers.isAddress(s))
        throw new Error(`Invalid ${label}: ${v}`);
    return ethers_1.ethers.getAddress(s);
}
function toBigIntSafe(v, fallback = 0n) {
    try {
        if (typeof v === "bigint")
            return v;
        if (typeof v === "number")
            return BigInt(Math.trunc(v));
        if (typeof v === "string") {
            const t = v.trim();
            return t.startsWith("0x") ? BigInt(t) : BigInt(t);
        }
        return fallback;
    }
    catch {
        return fallback;
    }
}
/**
 * Execute liquidation and swap seized collateral -> ... -> WETH via Universal Router V3.
 * Assumptions:
 * - debtAsset is WETH (repay in WETH).
 * - v3PathTokens MUST end with WETH (same addr as debtAsset).
 * - amountIn for UR V3 swap is set to 0 (spend balance pattern), minOut enforced via minOutWETH.
 */
async function execLiquidation({ signer, protocol, collateral, debtAsset, user, debtToCover, v3PathTokens, v3PathFees, minOutWETH, }) {
    if (!signer.provider)
        throw new Error("Signer must be connected to a provider");
    const routerAddr = (process.env.ROUTER_ADDRESS && reqAddr("ROUTER_ADDRESS", process.env.ROUTER_ADDRESS)) ||
        reqAddr("CONFIG.router", config_1.CONFIG?.router);
    const collateralAddr = reqAddr("collateral", collateral);
    const debtAssetAddr = reqAddr("debtAsset (WETH)", debtAsset);
    const userAddr = reqAddr("user", user);
    if (!Array.isArray(v3PathTokens) || v3PathTokens.length < 2) {
        throw new Error("v3PathTokens must have at least 2 addresses");
    }
    if (v3PathFees.length !== v3PathTokens.length - 1) {
        throw new Error("v3PathFees length must equal v3PathTokens.length - 1");
    }
    const pathTokens = v3PathTokens.map((t, i) => reqAddr(`v3PathTokens[${i}]`, t));
    const pathTail = pathTokens[pathTokens.length - 1];
    if (ethers_1.ethers.getAddress(pathTail) !== ethers_1.ethers.getAddress(debtAssetAddr)) {
        throw new Error(`defaultPath must end with WETH (debtAsset). Tail=${pathTail}, debtAsset=${debtAssetAddr}`);
    }
    // Protocol pool & Universal Router
    const pool = protocol === "aave" ? (0, aave_1.getAavePool)(signer) : (0, radiant_1.getRadiantPool)(signer);
    const ur = (0, universalRouter_1.getUniversalRouter)(signer);
    // Your custom searcher router
    const router = new ethers_1.ethers.Contract(routerAddr, ArbiRouterAbi, signer);
    // (1) Encode liquidation (repay in WETH)
    const liqData = pool.interface.encodeFunctionData("liquidationCall", [
        collateralAddr,
        debtAssetAddr,
        userAddr,
        toBigIntSafe(debtToCover, 0n),
        false, // receiveAToken=false
    ]);
    // (2) Encode UniversalRouter V3 exact-in swap from liquidation proceeds -> WETH
    const path = (0, universalRouter_1.encodeV3Path)(pathTokens, v3PathFees);
    const deadline = Math.floor(Date.now() / 1000) + 60;
    const commands = (0, universalRouter_1.bytesConcat)([universalRouter_1.Commands.V3_SWAP_EXACT_IN]);
    // UR receives from router (so proceeds land there), amountIn=0 (spend balance), enforce minOutWETH
    const urInput = (0, universalRouter_1.encodeV3ExactIn)(path, routerAddr, 0n, minOutWETH);
    const urData = ur.interface.encodeFunctionData("execute", [commands, [urInput], deadline]);
    const steps = [
        { target: pool.target, data: liqData, value: 0n },
        { target: ur.target, data: urData, value: 0n },
    ];
    // Try exec(tokenOut, minOut, steps) first; fall back to exec(steps)
    let data;
    try {
        data = router.interface.encodeFunctionData("exec", [
            debtAssetAddr, // tokenOut = WETH
            toBigIntSafe(minOutWETH, 0n),
            steps,
        ]);
    }
    catch {
        data = router.interface.encodeFunctionData("exec", [steps]);
    }
    return signer.populateTransaction({
        to: router.target,
        data,
        value: 0n,
    });
}
