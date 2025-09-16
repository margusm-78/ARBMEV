"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAavePool = getAavePool;
require("dotenv/config");
const ethers_1 = require("ethers");
const config_1 = require("./config");
const AAVE_POOL_ABI = [
    // liquidationCall(address collateral, address debtAsset, address user, uint256 debtToCover, bool receiveAToken)
    "function liquidationCall(address,address,address,uint256,bool)"
];
function requireAddr(label, v) {
    const s = (v || "").trim();
    if (!ethers_1.ethers.isAddress(s))
        throw new Error(`Missing/invalid ${label}: ${v}`);
    return ethers_1.ethers.getAddress(s);
}
/** Returns an Aave pool contract with the minimal ABI for liquidationCall */
function getAavePool(signerOrProvider) {
    const addr = process.env.AAVE_POOL ||
        config_1.CONFIG?.lending?.aave?.pool ||
        config_1.CONFIG?.aave?.pool;
    const poolAddr = requireAddr("AAVE_POOL", addr);
    return new ethers_1.ethers.Contract(poolAddr, AAVE_POOL_ABI, signerOrProvider);
}
