"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
// scripts/sim-sweep.ts
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
const V2_ROUTER_ABI = [
    'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
];
// Camelot V2 (different signature; includes referrer)
const CAMELOT_V2_ROUTER_ABI = [
    'function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, address referrer, uint deadline) external',
    'function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)',
];
const CAMELOT_V2_ROUTER = '0xc873fEcbD354f5A56E00E710B90Ef4201db2448d';
const ZERO = ethers_1.ethers.ZeroAddress;
function must(x, msg) { if (x == null)
    throw new Error(msg); return x; }
const fmtUnits = (x, dec = 6) => ethers_1.ethers.formatUnits(x, dec);
async function setAutomine(p, on) {
    for (const [m, a] of [
        ['anvil_setAutomine', [on]],
        ['anvil_setAutoMine', [on]],
        ['evm_setAutomine', [on]],
        ['hardhat_setAutomine', [on]],
    ]) {
        try {
            await p.send(m, a);
            return;
        }
        catch { }
    }
    try {
        await p.send('anvil_setBlockTimestampInterval', [on ? 0 : 1]);
        return;
    }
    catch { }
    throw new Error('Cannot toggle automine on this RPC');
}
async function mineOne(p) {
    try {
        await p.send('anvil_mine', [1]);
        return;
    }
    catch { }
    try {
        await p.send('evm_mine', []);
        return;
    }
    catch { }
    throw new Error('Cannot mine a block on this RPC');
}
function cleanAddr(a) { return a.toLowerCase().replace(/^0x/, ''); }
function fee3Bytes(fee) { return fee.toString(16).padStart(6, '0'); }
function encodePath2Hop(a, feeAB, b, feeBC, c) {
    return '0x' + cleanAddr(a) + fee3Bytes(feeAB) + cleanAddr(b) + fee3Bytes(feeBC) + cleanAddr(c);
}
function routeLabel(best, outSym) {
    if (best.dex === 'V2')
        return `V2 ${best.label}`;
    return best.kind === 'single' ? `V3 single WETH→${outSym}` : `V3 multi WETH→USDT→${outSym}`;
}
// Optional per-trial snapshot so every iteration starts from the same state
async function takeSnapshot(p) {
    if (process.env.SIM_SNAPSHOT !== '1')
        return null;
    try {
        return await p.send('evm_snapshot', []);
    }
    catch {
        return null;
    }
}
async function revertSnapshot(p, id) {
    if (!id)
        return;
    try {
        await p.send('evm_revert', [id]);
    }
    catch { }
}
/** Robust gas computation:
 *  1) Sum receipts: Σ(gasUsed * effectiveGasPrice)
 *  2) If Σ == 0 but Σ(gasUsed) > 0 → fallback to provider gas price: Σ(gasUsed) * gasPrice
 */
async function computeGasWei(provider, txHashes) {
    let totalWei = 0n;
    let totalUsed = 0n;
    for (const h of txHashes) {
        const rcpt = await provider.getTransactionReceipt(h);
        if (!rcpt)
            continue;
        const used = rcpt.gasUsed ?? 0n;
        const price = rcpt.effectiveGasPrice ?? 0n;
        totalUsed += used;
        if (price > 0n && used > 0n) {
            totalWei += used * price;
        }
    }
    if (totalWei === 0n && totalUsed > 0n) {
        // fallback to provider-reported gas price
        let gp = 0n;
        try {
            const fee = await provider.getFeeData();
            gp = fee.gasPrice ?? fee.maxFeePerGas ?? 0n;
        }
        catch { }
        if (gp === 0n) {
            try {
                const raw = await provider.send('eth_gasPrice', []);
                gp = BigInt(raw);
            }
            catch { }
        }
        if (gp > 0n)
            totalWei = totalUsed * gp;
    }
    return { gasWei: totalWei, used: totalUsed };
}
async function runOneTrial(provider, you, victim, victimEthIn, backrunEthIn, baseSlippageBps, adaptiveMaxExtraBps, adaptiveStepBps) {
    const youAddr = await you.getAddress();
    const vicAddr = await victim.getAddress();
    const wethYou = new ethers_1.ethers.Contract(price_1.ADDR.WETH, WETH9_ABI, you);
    const wethVic = new ethers_1.ethers.Contract(price_1.ADDR.WETH, WETH9_ABI, victim);
    const v3Vic = new ethers_1.ethers.Contract(price_1.ADDR.V3_ROUTER, [
        'function exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160)) payable returns (uint256)'
    ], victim);
    let ny = await provider.getTransactionCount(youAddr, 'pending');
    let nv = await provider.getTransactionCount(vicAddr, 'pending');
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
    const yourTxHashes = [];
    // Victim leg (queue only)
    await wethVic.deposit({ value: victimEthIn, nonce: nv++ });
    await wethVic.approve(price_1.ADDR.V3_ROUTER, ethers_1.ethers.MaxUint256, { nonce: nv++ });
    const victimParams = [price_1.ADDR.WETH, price_1.ADDR.USDC_NATIVE, 500, vicAddr, deadline, victimEthIn, 0n, 0n];
    await v3Vic.exactInputSingle(victimParams, { value: 0n, nonce: nv++ });
    // Your wrap
    const txWrap = await wethYou.deposit({ value: backrunEthIn, nonce: ny++ });
    yourTxHashes.push(txWrap.hash);
    // Quote best route
    const best = await (0, price_1.quoteBestWethToStable)(provider, backrunEthIn);
    if (!best)
        throw new Error('No route for backrun notional');
    const tokenOut = best.dex === 'V2' ? best.path[best.path.length - 1] : best.tokenOut;
    const outToken = new ethers_1.ethers.Contract(tokenOut, ERC20_ABI, provider);
    const outDec = Number(await outToken.decimals());
    const preBal = (await outToken.balanceOf(youAddr));
    const outSym = tokenOut.toLowerCase() === price_1.ADDR.USDC_E ? 'USDC.e' : 'USDC';
    const quotedOut = best.amountOut;
    const minOutOf = (extraBps) => (quotedOut * BigInt(10000 - baseSlippageBps - extraBps)) / 10000n;
    // Approvals + swap with adaptive minOut retries (records YOUR txs only for gas)
    if (best.dex === 'V2') {
        const routerAddr = best.router;
        const isCamelot = routerAddr.toLowerCase() === CAMELOT_V2_ROUTER.toLowerCase();
        if (isCamelot) {
            const v2 = new ethers_1.ethers.Contract(routerAddr, CAMELOT_V2_ROUTER_ABI, you);
            const txApprove = await wethYou.approve(routerAddr, ethers_1.ethers.MaxUint256, { nonce: ny++ });
            yourTxHashes.push(txApprove.hash);
            let sent = false, lastErr = null;
            for (let extra = 0; extra <= adaptiveMaxExtraBps; extra += adaptiveStepBps) {
                try {
                    const tx = await v2.swapExactTokensForTokensSupportingFeeOnTransferTokens(backrunEthIn, minOutOf(extra), best.path, youAddr, ZERO, Number(deadline), { nonce: ny++ });
                    yourTxHashes.push(tx.hash);
                    sent = true;
                    break;
                }
                catch (e) {
                    lastErr = e;
                }
            }
            if (!sent)
                throw lastErr ?? new Error('Camelot V2 swap could not be sent (adaptive slippage)');
        }
        else {
            const v2 = new ethers_1.ethers.Contract(routerAddr, V2_ROUTER_ABI, you);
            const txApprove = await wethYou.approve(routerAddr, ethers_1.ethers.MaxUint256, { nonce: ny++ });
            yourTxHashes.push(txApprove.hash);
            let sent = false, lastErr = null;
            for (let extra = 0; extra <= adaptiveMaxExtraBps; extra += adaptiveStepBps) {
                try {
                    const tx = await v2.swapExactTokensForTokens(backrunEthIn, minOutOf(extra), best.path, youAddr, Number(deadline), { nonce: ny++ });
                    yourTxHashes.push(tx.hash);
                    sent = true;
                    break;
                }
                catch (e) {
                    lastErr = e;
                }
            }
            if (!sent)
                throw lastErr ?? new Error('V2 swap could not be sent (adaptive slippage)');
        }
    }
    else {
        const v3 = new ethers_1.ethers.Contract(price_1.ADDR.V3_ROUTER, V3_ROUTER_ABI, you);
        const txApprove = await wethYou.approve(price_1.ADDR.V3_ROUTER, ethers_1.ethers.MaxUint256, { nonce: ny++ });
        yourTxHashes.push(txApprove.hash);
        let sent = false, lastErr = null;
        for (let extra = 0; extra <= adaptiveMaxExtraBps; extra += adaptiveStepBps) {
            try {
                if (best.kind === 'single') {
                    const params = [price_1.ADDR.WETH, best.tokenOut, best.fee, youAddr, deadline, backrunEthIn, minOutOf(extra), 0n];
                    const tx = await v3.exactInputSingle(params, { value: 0n, nonce: ny++ });
                    yourTxHashes.push(tx.hash);
                }
                else {
                    const path = encodePath2Hop(price_1.ADDR.WETH, best.feeAB, price_1.ADDR.USDT, best.feeBC, best.tokenOut);
                    const params = [path, youAddr, deadline, backrunEthIn, minOutOf(extra)];
                    const tx = await v3.exactInput(params, { value: 0n, nonce: ny++ });
                    yourTxHashes.push(tx.hash);
                }
                sent = true;
                break;
            }
            catch (e) {
                lastErr = e;
            }
        }
        if (!sent)
            throw lastErr ?? new Error('V3 swap could not be sent (adaptive slippage)');
    }
    await mineOne(provider);
    // Gross stable delta
    const postBal = (await outToken.balanceOf(youAddr));
    const gross = postBal - preBal;
    // Gas (robust): receipts first; if zero => fallback to provider gas price
    const { gasWei, used } = await computeGasWei(provider, yourTxHashes);
    // Convert gas ETH → USDC (6 decimals). If amount is tiny, quoteEthToUsdc handles scaling.
    const gasStable = await (0, price_1.quoteEthToUsdc)(provider, gasWei);
    const net = gross - gasStable;
    return {
        i: 0,
        victimEthIn,
        backrunEthIn,
        outSym,
        outDec,
        route: routeLabel(best, outSym),
        gross,
        gasWei,
        gasStable,
        net,
    };
}
async function main() {
    const url = must(process.env.ANVIL_URL, 'Set ANVIL_URL=http://127.0.0.1:8545');
    const provider = new ethers_1.ethers.JsonRpcProvider(url, { name: 'arbitrum', chainId: 42161 });
    const you = new ethers_1.ethers.Wallet(must(process.env.PRIVATE_KEY, 'Set PRIVATE_KEY').trim(), provider);
    const victim = ethers_1.ethers.Wallet.createRandom().connect(provider);
    try {
        await provider.send('anvil_setBalance', [await you.getAddress(), '0x56BC75E2D63100000']);
    }
    catch { }
    try {
        await provider.send('anvil_setBalance', [await victim.getAddress(), '0x56BC75E2D63100000']);
    }
    catch { }
    const ITERS = Number(process.env.SIM_ITERS ?? 25);
    const VICTIM_MIN = ethers_1.ethers.parseEther(process.env.VICTIM_MIN_ETH ?? '1');
    const VICTIM_MAX = ethers_1.ethers.parseEther(process.env.VICTIM_MAX_ETH ?? '6');
    const BACKRUN_ETH = ethers_1.ethers.parseEther(process.env.BACKRUN_ETH ?? '1');
    const BASE_SLIPPAGE_BPS = Number(process.env.SLIPPAGE_BPS ?? 1000); // 10% base
    const ADAPTIVE_MAX_BPS = Number(process.env.ADAPTIVE_MAX_BPS ?? 2000); // up to +20% extra
    const ADAPTIVE_STEP_BPS = Number(process.env.ADAPTIVE_STEP_BPS ?? 250); // try in 2.5% steps
    await setAutomine(provider, false);
    console.log(`Sweep start: iters=${ITERS} victim=[${ethers_1.ethers.formatEther(VICTIM_MIN)}..${ethers_1.ethers.formatEther(VICTIM_MAX)}] backrun=${ethers_1.ethers.formatEther(BACKRUN_ETH)} baseSlip=${BASE_SLIPPAGE_BPS}bps adapt<=${ADAPTIVE_MAX_BPS}bps step=${ADAPTIVE_STEP_BPS}bps | netPnL=ON`);
    const results = [];
    for (let i = 0; i < ITERS; i++) {
        const snapId = await takeSnapshot(provider);
        const victimIn = VICTIM_MIN + (BigInt(Math.floor(Math.random() * 10_000)) * (VICTIM_MAX - VICTIM_MIN)) / 10000n;
        try {
            const t = await runOneTrial(provider, you, victim, victimIn, BACKRUN_ETH, BASE_SLIPPAGE_BPS, ADAPTIVE_MAX_BPS, ADAPTIVE_STEP_BPS);
            t.i = i + 1;
            results.push(t);
            console.log(`[${t.i}/${ITERS}] ${t.route} | victim=${ethers_1.ethers.formatEther(t.victimEthIn)} | gross=${fmtUnits(t.gross, t.outDec)} ${t.outSym} | gas=${fmtUnits(t.gasStable, 6)} USDC | net=${fmtUnits(t.net, t.outDec)} ${t.outSym}`);
        }
        catch (e) {
            console.error(`[${i + 1}/${ITERS}] ERROR`, e.message || e);
            try {
                await mineOne(provider);
            }
            catch { }
        }
        finally {
            await revertSnapshot(provider, snapId);
        }
    }
    try {
        await setAutomine(provider, true);
    }
    catch { }
    if (results.length === 0)
        return;
    const dec = results[0].outDec;
    const sym = results[0].outSym;
    const wins = results.filter(r => r.net > 0n);
    const losses = results.filter(r => r.net <= 0n);
    const sumGross = results.reduce((a, r) => a + r.gross, 0n);
    const sumGas = results.reduce((a, r) => a + r.gasStable, 0n);
    const sumNet = results.reduce((a, r) => a + r.net, 0n);
    const avgNet = sumNet / BigInt(results.length);
    console.log('—'.repeat(60));
    console.log(`Trials: ${results.length} | Wins: ${wins.length} | Losses: ${losses.length} | Win% (net): ${(wins.length * 100 / results.length).toFixed(1)}%`);
    console.log(`ΣGross: ${fmtUnits(sumGross, dec)} ${sym} | ΣGas≈ ${fmtUnits(sumGas, 6)} USDC | ΣNet: ${fmtUnits(sumNet, dec)} ${sym} | AvgNet: ${fmtUnits(avgNet, dec)} ${sym}`);
    try {
        const fs = await Promise.resolve().then(() => __importStar(require('node:fs/promises')));
        await fs.mkdir('out', { recursive: true });
        const lines = ['i,victim_eth,backrun_eth,route,gross_stable,gas_usdc,net_stable,token'];
        for (const r of results) {
            lines.push([
                r.i,
                ethers_1.ethers.formatEther(r.victimEthIn),
                ethers_1.ethers.formatEther(r.backrunEthIn),
                `"${r.route}"`,
                fmtUnits(r.gross, r.outDec),
                fmtUnits(r.gasStable, 6),
                fmtUnits(r.net, r.outDec),
                r.outSym,
            ].join(','));
        }
        await fs.writeFile('out/sim-sweep.csv', lines.join('\n'));
        console.log('Saved: out/sim-sweep.csv');
    }
    catch { }
}
main().catch((e) => { console.error(e); process.exit(1); });
