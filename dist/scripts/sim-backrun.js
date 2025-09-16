"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// scripts/sim-backrun.ts
require("dotenv/config");
const ethers_1 = require("ethers");
const price_1 = require("../src/sim/price");
const ERC20_ABI = [
    'function balanceOf(address) view returns (uint256)',
    'function decimals() view returns (uint8)',
    'function approve(address,uint256) returns (bool)',
];
const WETH9_ABI = [
    'function deposit() payable',
    'function approve(address,uint256) returns (bool)',
    'function balanceOf(address) view returns (uint256)',
];
const V3_ROUTER_ABI = [
    'function exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160)) payable returns (uint256)',
    'function exactInput((bytes,address,uint256,uint256,uint256)) payable returns (uint256)',
];
// Sushi/UniV2
const V2_ROUTER_ABI = [
    'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
];
// Camelot V2 w/ referrer
const CAMELOT_V2_ROUTER_ABI = [
    'function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, address referrer, uint deadline) external',
];
const CAMELOT_V2_ROUTER = '0xc873fEcbD354f5A56E00E710B90Ef4201db2448d';
const ZERO = ethers_1.ethers.ZeroAddress;
function must(x, msg) { if (x == null)
    throw new Error(msg); return x; }
function cleanAddr(a) { return a.toLowerCase().replace(/^0x/, ''); }
function fee3Bytes(fee) { return fee.toString(16).padStart(6, '0'); }
function encodePath2Hop(a, feeAB, b, feeBC, c) {
    return '0x' + cleanAddr(a) + fee3Bytes(feeAB) + cleanAddr(b) + fee3Bytes(feeBC) + cleanAddr(c);
}
async function setAutomine(provider, on) {
    const tries = [
        ['anvil_setAutomine', [on]],
        ['anvil_setAutoMine', [on]],
        ['evm_setAutomine', [on]],
        ['hardhat_setAutomine', [on]],
    ];
    for (const [m, p] of tries) {
        try {
            await provider.send(m, p);
            return m;
        }
        catch { }
    }
    try {
        await provider.send('anvil_setBlockTimestampInterval', [on ? 0 : 1]);
        return 'anvil_setBlockTimestampInterval';
    }
    catch { }
    return null;
}
async function mineOne(provider) {
    try {
        await provider.send('anvil_mine', [1]);
        return 'anvil_mine';
    }
    catch { }
    try {
        await provider.send('evm_mine', []);
        return 'evm_mine';
    }
    catch { }
    return null;
}
async function ensureLocalFork(provider) {
    const v = await provider.send('web3_clientVersion', []);
    const url = provider._url ?? '';
    const ok = /anvil|hardhat|foundry/i.test(v) || /127\.0\.0\.1|localhost/.test(url);
    if (!ok)
        throw new Error(`This script needs a local fork (got "${v}" at "${url}")`);
}
async function main() {
    const url = must(process.env.ANVIL_URL, 'Set ANVIL_URL (e.g. http://127.0.0.1:8545)');
    const provider = new ethers_1.ethers.JsonRpcProvider(url, { name: 'arbitrum', chainId: 42161 });
    await ensureLocalFork(provider);
    const you = new ethers_1.ethers.Wallet(must(process.env.PRIVATE_KEY, 'Set PRIVATE_KEY').trim(), provider);
    const yourAddr = await you.getAddress();
    const VICTIM_ETH_IN = ethers_1.ethers.parseEther(process.env.VICTIM_ETH_IN || '3');
    const BACKRUN_ETH_IN = ethers_1.ethers.parseEther(process.env.BACKRUN_ETH_IN || '1');
    const SLIPPAGE_BPS = Number(process.env.SLIPPAGE_BPS ?? 1000);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
    try {
        await provider.send('anvil_setBalance', [yourAddr, '0x56BC75E2D63100000']);
    }
    catch { }
    const victim = ethers_1.ethers.Wallet.createRandom().connect(provider);
    try {
        await provider.send('anvil_setBalance', [await victim.getAddress(), '0x56BC75E2D63100000']);
    }
    catch { }
    const wethYou = new ethers_1.ethers.Contract(price_1.ADDR.WETH, WETH9_ABI, you);
    const wethVic = new ethers_1.ethers.Contract(price_1.ADDR.WETH, WETH9_ABI, victim);
    const v3Vic = new ethers_1.ethers.Contract(price_1.ADDR.V3_ROUTER, V3_ROUTER_ABI, victim);
    let ny = await provider.getTransactionCount(yourAddr, 'pending');
    let nv = await provider.getTransactionCount(await victim.getAddress(), 'pending');
    let tokenOutAddr = price_1.ADDR.USDC_NATIVE;
    let outDecN = 6;
    let preBal = 0n;
    let automineToggled = false;
    try {
        const toggle = await setAutomine(provider, false);
        if (!toggle)
            throw new Error('Could not disable automine on this RPC.');
        automineToggled = true;
        const startBlock = await provider.getBlockNumber();
        console.log(`Automine disabled via ${toggle} | start block=${startBlock}`);
        // Victim
        const txVictimDeposit = await wethVic.deposit({ value: VICTIM_ETH_IN, nonce: nv++ });
        const txVictimApprove = await wethVic.approve(price_1.ADDR.V3_ROUTER, ethers_1.ethers.MaxUint256, { nonce: nv++ });
        const victimParams = [price_1.ADDR.WETH, price_1.ADDR.USDC_NATIVE, 500, await victim.getAddress(), deadline, VICTIM_ETH_IN, 0n, 0n];
        const txVictimSwap = await v3Vic.exactInputSingle(victimParams, { value: 0n, nonce: nv++ });
        console.log('Queued victim txs:', [txVictimDeposit.hash, txVictimApprove.hash, txVictimSwap.hash]);
        // You
        const txYourDeposit = await wethYou.deposit({ value: BACKRUN_ETH_IN, nonce: ny++ });
        const best = await (0, price_1.quoteBestWethToStable)(provider, BACKRUN_ETH_IN);
        if (!best)
            throw new Error('No route found for backrun notional.');
        tokenOutAddr = best.dex === 'V2' ? best.path[best.path.length - 1] : best.tokenOut;
        const outToken = new ethers_1.ethers.Contract(tokenOutAddr, ERC20_ABI, provider);
        const decRaw = await outToken.decimals();
        outDecN = typeof decRaw === 'bigint' ? Number(decRaw) : Number(decRaw);
        preBal = (await outToken.balanceOf(yourAddr));
        const amountOut = best.amountOut;
        const minOut = (amountOut * BigInt(10000 - SLIPPAGE_BPS)) / 10000n;
        if (best.dex === 'V2') {
            const routerAddr = best.router;
            const isCamelot = routerAddr.toLowerCase() === CAMELOT_V2_ROUTER.toLowerCase();
            if (isCamelot) {
                const v2Camelot = new ethers_1.ethers.Contract(routerAddr, CAMELOT_V2_ROUTER_ABI, you);
                const txApprove = await wethYou.approve(routerAddr, ethers_1.ethers.MaxUint256, { nonce: ny++ });
                const txSwap = await v2Camelot.swapExactTokensForTokensSupportingFeeOnTransferTokens(BACKRUN_ETH_IN, minOut, best.path, yourAddr, ZERO, Math.floor(Number(deadline)), { nonce: ny++ });
                console.log(`Backrun route: V2 Camelot | quoted≈${ethers_1.ethers.formatUnits(amountOut, outDecN)} | minOut=${minOut}`);
                console.log('Queued your txs:', [txYourDeposit.hash, txApprove.hash, txSwap.hash]);
            }
            else {
                const v2 = new ethers_1.ethers.Contract(routerAddr, V2_ROUTER_ABI, you);
                const txApprove = await wethYou.approve(routerAddr, ethers_1.ethers.MaxUint256, { nonce: ny++ });
                const txSwap = await v2.swapExactTokensForTokens(BACKRUN_ETH_IN, minOut, best.path, yourAddr, Math.floor(Number(deadline)), { nonce: ny++ });
                console.log(`Backrun route: V2 ${best.label} | quoted≈${ethers_1.ethers.formatUnits(amountOut, outDecN)} | minOut=${minOut}`);
                console.log('Queued your txs:', [txYourDeposit.hash, txApprove.hash, txSwap.hash]);
            }
        }
        else {
            const v3 = new ethers_1.ethers.Contract(price_1.ADDR.V3_ROUTER, V3_ROUTER_ABI, you);
            const txApprove = await wethYou.approve(price_1.ADDR.V3_ROUTER, ethers_1.ethers.MaxUint256, { nonce: ny++ });
            if (best.kind === 'single') {
                const params = [price_1.ADDR.WETH, best.tokenOut, best.fee, yourAddr, deadline, BACKRUN_ETH_IN, minOut, 0n];
                const txSwap = await v3.exactInputSingle(params, { value: 0n, nonce: ny++ });
                console.log(`Backrun route: V3 single fee=${best.fee} | quoted≈${ethers_1.ethers.formatUnits(amountOut, outDecN)} | minOut=${minOut}`);
                console.log('Queued your txs:', [txYourDeposit.hash, txApprove.hash, txSwap.hash]);
            }
            else {
                const path = encodePath2Hop(price_1.ADDR.WETH, best.feeAB, price_1.ADDR.USDT, best.feeBC, best.tokenOut);
                const params = [path, yourAddr, deadline, BACKRUN_ETH_IN, minOut];
                const txSwap = await v3.exactInput(params, { value: 0n, nonce: ny++ });
                console.log(`Backrun route: V3 multi fees=${best.feeAB}/${best.feeBC} | quoted≈${ethers_1.ethers.formatUnits(amountOut, outDecN)} | minOut=${minOut}`);
                console.log('Queued your txs:', [txYourDeposit.hash, txApprove.hash, txSwap.hash]);
            }
        }
        // Mine and compute delta
        const minedWith = await mineOne(provider);
        if (!minedWith)
            throw new Error('Could not mine a block (no anvil_mine/evm_mine).');
        const endBlock = await provider.getBlockNumber();
        console.log(`Block mined via ${minedWith} | end block=${endBlock}`);
        const postBal = (await (new ethers_1.ethers.Contract(tokenOutAddr, ERC20_ABI, provider)).balanceOf(yourAddr));
        const delta = postBal - preBal;
        const sym = tokenOutAddr.toLowerCase() === price_1.ADDR.USDC_E ? 'USDC.e' : 'USDC';
        console.log(`Backrun delta: +${ethers_1.ethers.formatUnits(delta, outDecN)} ${sym} (gross)`);
    }
    finally {
        try {
            const toggled = await setAutomine(provider, true);
            if (toggled)
                console.log(`Automine re-enabled via ${toggled}`);
        }
        catch { }
    }
}
main().catch((e) => { console.error(e); process.exit(1); });
