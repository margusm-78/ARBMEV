"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeProvider = makeProvider;
require("dotenv/config");
const ethers_1 = require("ethers");
function val(name) { return (process.env[name] || '').trim(); }
function pickUrl() {
    const order = [
        'ALCH_ARB_HTTP',
        'QNODE_ARB_HTTP', 'QUICKNODE_ARB_HTTP',
        'LLAMA_ARB_HTTP',
        'INFURA_ARB_HTTP',
        'ARB_RPC_URL_BACKUP',
        'ARB_RPC_URL', // keep last: often Infura in old setups
        'ANVIL_URL', // only if explicitly set
    ];
    for (const k of order) {
        const v = val(k);
        if (v)
            return v;
    }
    throw new Error('No RPC url set. Provide ALCH_ARB_HTTP or QUICKNODE_ARB_HTTP or LLAMA_ARB_HTTP (INFURA as last resort).');
}
function makeProvider() {
    const url = pickUrl();
    console.log(`[provider.ts] Using RPC: ${url.replace(/https?:\/\/|wss?:\/\//g, '').slice(0, 48)}…`);
    return new ethers_1.ethers.JsonRpcProvider(url, { name: 'arbitrum', chainId: 42161 });
}
