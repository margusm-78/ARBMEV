"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRadiantPool = getRadiantPool;
require("dotenv/config");
const ethers_1 = require("ethers");
const config_1 = require("./config");
const RADIANT_POOL_ABI = [
    // Many Radiant deployments mirror Aave's liquidation signature
    "function liquidationCall(address,address,address,uint256,bool)"
];
function requireAddr(label, v) {
    const s = (v || "").trim();
    if (!ethers_1.ethers.isAddress(s))
        throw new Error(`Missing/invalid ${label}: ${v}`);
    return ethers_1.ethers.getAddress(s);
}
/** Returns a Radiant pool contract with the minimal ABI for liquidationCall */
function getRadiantPool(signerOrProvider) {
    const addr = process.env.RADIANT_POOL ||
        config_1.CONFIG?.lending?.radiant?.pool ||
        config_1.CONFIG?.radiant?.pool;
    const poolAddr = requireAddr("RADIANT_POOL", addr);
    return new ethers_1.ethers.Contract(poolAddr, RADIANT_POOL_ABI, signerOrProvider);
}
