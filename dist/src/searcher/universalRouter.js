"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TOKENS = exports.Commands = void 0;
exports.defaultArbWethFee = defaultArbWethFee;
exports.getUniversalRouter = getUniversalRouter;
exports.encodeV3Path = encodeV3Path;
exports.buildArbToWethPath = buildArbToWethPath;
exports.encodeV3ExactIn = encodeV3ExactIn;
exports.bytesConcat = bytesConcat;
exports.deadlineFromNow = deadlineFromNow;
// src/searcher/universalRouter.ts
require("dotenv/config");
const ethers_1 = require("ethers");
const config_1 = require("./config");
const univ3_1 = require("./univ3");
// Pull ONLY the ABI array (InterfaceAbi for ethers v6)
const { abi: UNIVERSAL_ROUTER_ABI } = require("./abi/UniversalRouter.json");
// 0x00 = V3_SWAP_EXACT_IN
exports.Commands = { V3_SWAP_EXACT_IN: 0x00 };
exports.TOKENS = {
    ARB: (0, univ3_1.tokenAddress)("ARB"),
    WETH: (0, univ3_1.tokenAddress)("WETH"),
};
function defaultArbWethFee() {
    const cfg = Number(config_1.CONFIG?.uni?.priceFee);
    return Number.isFinite(cfg) && cfg > 0 ? cfg : 500;
}
/** Get Universal Router (or fallback to SwapRouter02 address if your config lacks UR). */
function getUniversalRouter(providerOrSigner) {
    const raw = config_1.ROUTERS.universalRouter ||
        config_1.ROUTERS.swapRouter02; // <-- fallback
    if (!raw || !ethers_1.ethers.isAddress(raw)) {
        throw new Error("Router address not set or invalid in config (universalRouter/swapRouter02)");
    }
    const addr = ethers_1.ethers.getAddress(raw);
    return new ethers_1.ethers.Contract(addr, UNIVERSAL_ROUTER_ABI, providerOrSigner);
}
/** Encode Uniswap V3 multi-hop path. */
function encodeV3Path(tokens, fees) {
    if (!Array.isArray(tokens) || !Array.isArray(fees))
        throw new Error("Invalid path args");
    if (tokens.length !== fees.length + 1)
        throw new Error("Invalid path: tokens.length must equal fees.length + 1");
    let pathHex = "0x";
    for (let i = 0; i < fees.length; i++) {
        const t = tokens[i];
        if (!ethers_1.ethers.isAddress(t))
            throw new Error(`Invalid token address at index ${i}: ${t}`);
        const fee = fees[i];
        if (!Number.isFinite(fee) || fee < 0 || fee > 1_000_000) {
            throw new Error(`Invalid fee at index ${i}: ${fee}`);
        }
        const feeHex = fee.toString(16).padStart(6, "0");
        pathHex += t.slice(2);
        pathHex += feeHex;
    }
    const last = tokens[tokens.length - 1];
    if (!ethers_1.ethers.isAddress(last))
        throw new Error(`Invalid token address at tail: ${last}`);
    pathHex += last.slice(2);
    return pathHex.toLowerCase();
}
function buildArbToWethPath(fee = defaultArbWethFee()) {
    return encodeV3Path([exports.TOKENS.ARB, exports.TOKENS.WETH], [fee]);
}
function encodeV3ExactIn(path, recipient, amountIn, amountOutMinimum) {
    const rcpt = ethers_1.ethers.getAddress(recipient);
    const types = ["bytes", "address", "uint256", "uint256"];
    const values = [path, rcpt, amountIn, amountOutMinimum];
    return ethers_1.ethers.AbiCoder.defaultAbiCoder().encode(types, values);
}
function bytesConcat(arr) {
    const u8 = new Uint8Array(arr);
    return ethers_1.ethers.hexlify(u8);
}
function deadlineFromNow(seconds) {
    const now = Math.floor(Date.now() / 1000);
    return BigInt(now + Math.max(0, Math.floor(seconds)));
}
