"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeProvider = makeProvider;
require("dotenv/config");
const ethers_1 = require("ethers");
function makeProvider() {
    const url = process.env.ANVIL_URL ||
        process.env.ARB_RPC_URL ||
        process.env.ARB_RPC_URL_BACKUP;
    if (!url)
        throw new Error('Set ANVIL_URL or ARB_RPC_URL');
    // Force Arbitrum One chain id in dev
    return new ethers_1.ethers.JsonRpcProvider(url, { name: 'arbitrum', chainId: 42161 });
}
