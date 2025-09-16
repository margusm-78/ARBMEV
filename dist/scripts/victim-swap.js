"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const ethers_1 = require("ethers");
const price_1 = require("../src/sim/price");
const WETH9_ABI = [
    'function deposit() payable',
    'function approve(address,uint256) returns (bool)'
];
const V3_ROUTER_ABI = [
    'function exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160)) payable returns (uint256)'
];
function must(x, m) { if (x === undefined || x === null)
    throw new Error(m); return x; }
async function main() {
    const url = must(process.env.ANVIL_URL || process.env.ARB_RPC_URL, 'Set ANVIL_URL or ARB_RPC_URL');
    const provider = new ethers_1.ethers.JsonRpcProvider(url, { name: 'arbitrum', chainId: 42161 });
    const count = Number(process.env.VICTIM_COUNT || process.argv.includes('--count') ? Number(process.argv.at(-1)) : 3);
    const ethIn = ethers_1.ethers.parseEther(process.env.VICTIM_ETH_IN || process.argv.includes('--eth') ? (process.argv.at(-1) || '3') : '3');
    for (let i = 0; i < count; i++) {
        const v = ethers_1.ethers.Wallet.createRandom().connect(provider);
        await provider.send('anvil_setBalance', [await v.getAddress(), '0x56BC75E2D63100000']);
        let nonce = await provider.getTransactionCount(await v.getAddress(), 'pending');
        const weth = new ethers_1.ethers.Contract(price_1.ADDR.WETH, WETH9_ABI, v);
        await (await weth.deposit({ value: ethIn, nonce: nonce++ })).wait();
        await (await weth.approve(price_1.ADDR.V3_ROUTER, ethers_1.ethers.MaxUint256, { nonce: nonce++ })).wait();
        const r = new ethers_1.ethers.Contract(price_1.ADDR.V3_ROUTER, V3_ROUTER_ABI, v);
        const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
        const p = [price_1.ADDR.WETH, price_1.ADDR.USDC_NATIVE, 500, await v.getAddress(), deadline, ethIn, 0n, 0n];
        await (await r.exactInputSingle(p, { value: 0n, nonce: nonce++ })).wait();
        console.log(`Victim ${i + 1}/${count} sent.`);
    }
    console.log('Done sending victims.');
}
main().catch((e) => { console.error(e); process.exit(1); });
