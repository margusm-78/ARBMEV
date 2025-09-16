"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// scripts/mempool-shadow.ts
require("dotenv/config");
const ethers_1 = require("ethers");
const ws_1 = __importDefault(require("ws"));
const anvil_1 = require("../src/utils/anvil");
/* ----------------------- Safe optional ADDR import ---------------------- */
let ADDR_IMPORTED = null;
try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const maybe = require('../src/sim/price');
    ADDR_IMPORTED = (maybe && typeof maybe === 'object') ? maybe.ADDR ?? null : null;
}
catch { /* not present — OK */ }
/* ----------------------- ABIs ----------------------- */
const ERC20_ABI = [
    'function balanceOf(address) view returns (uint256)',
    'function decimals() view returns (uint8)',
    'function approve(address,uint256) returns (bool)',
    'function allowance(address,address) view returns (uint256)',
];
const WETH9_ABI = [
    'function deposit() payable',
    'function approve(address,uint256) returns (bool)',
    'function balanceOf(address) view returns (uint256)',
];
// Ethers v6 compatible signatures (tuple arg must be passed as array)
const V3_ROUTER_ABI = [
    'function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)',
    'function exactInput((bytes path,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum)) payable returns (uint256 amountOut)',
];
const QUOTER_V2_ABI = [
    'function quoteExactInputSingle(address tokenIn,address tokenOut,uint24 fee,uint256 amountIn,uint160 sqrtPriceLimitX96) returns (uint256 amountOut,uint160,uint32,uint256)'
];
const V3_FACTORY_ABI = [
    'function getPool(address tokenA,address tokenB,uint24 fee) external view returns (address pool)'
];
const V3_POOL_ABI = [
    'function liquidity() view returns (uint128)',
    'function slot0() view returns (uint160 sqrtPriceX96,int24 tick,uint16,uint16,uint16,uint8,bool)'
];
const CHAINLINK_FEED_ABI = [
    'function latestRoundData() view returns (uint80 roundId,int256 answer,uint256 startedAt,uint256 updatedAt,uint80 answeredInRound)',
    'function decimals() view returns (uint8)',
];
/* ------------------- Selectors ------------------- */
const SIG_V3_SINGLE = '0x04e45aaf';
const SIG_V3_MULTI = '0x5023b4df';
const SIG_V2_SWAP_EXACT_TOKENS_FOR_TOKENS = '0x38ed1739';
const SIG_V2_MULTICALL = '0x5ae401dc';
const INTERESTING_SIGHASHES = new Set([SIG_V3_SINGLE, SIG_V3_MULTI, SIG_V2_SWAP_EXACT_TOKENS_FOR_TOKENS, SIG_V2_MULTICALL]);
function must(x, msg) { if (x == null)
    throw new Error(msg); return x; }
/* ----------------------- Addresses (Arbitrum One) ------------------------ */
const FALLBACK = {
    WETH: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    USDC: '0xaf88d065e77c8cc2239327c5edb3a432268e5831',
    USDCe: '0xff970a61a04b1ca14834a43f5de4533ebddb5cc8',
    USDT: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
    DAI: '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1',
    WBTC: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f',
    ARB: '0x912CE59144191C1204E64559FE8253a0e49E6548',
    V3: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
    QUOTER: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
    V3_FACTORY: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
    // Routers / Aggs (watch list)
    SUSHI_V2: '0x1b02da8cb0d097eb8d57a175b88c7d8b47997506',
    CAMELOT_V2: '0xc873fEcbD354f5A56E00E710B90Ef4201db2448d',
    UNI_UR: '0x4c60051384Bd2d3c01BfC845cF5f4b44BCBe9dE5',
    ONEINCH: '0x111111125421cA6dC452d289314280a0f8842A65',
    ZEROX: '0xaD75De69cefC8403Df1860D5803868e6E58C9570',
    PARASWAP: '0xDEF171FE48CF0115B1d80B88dc8eAB59176FEe57',
    ODOS: '0xDD94018F54e565dbfc939F7C44a16e163FaAb331',
};
const ADDR_SAFE = {
    WETH: ADDR_IMPORTED?.WETH ?? FALLBACK.WETH,
    USDC: ADDR_IMPORTED?.USDC ?? FALLBACK.USDC,
    USDCe: ADDR_IMPORTED?.USDCe ?? FALLBACK.USDCe,
    USDT: ADDR_IMPORTED?.USDT ?? FALLBACK.USDT,
    DAI: ADDR_IMPORTED?.DAI ?? FALLBACK.DAI,
    WBTC: ADDR_IMPORTED?.WBTC ?? FALLBACK.WBTC,
    ARB: ADDR_IMPORTED?.ARB ?? FALLBACK.ARB,
    V3: ADDR_IMPORTED?.V3_ROUTER ?? FALLBACK.V3,
    QUOTER: (process.env.UNI_QUOTER?.trim() || ADDR_IMPORTED?.UNI_QUOTER) ?? FALLBACK.QUOTER,
    V3_FACTORY: ADDR_IMPORTED?.V3_FACTORY ?? FALLBACK.V3_FACTORY,
    // watch list
    SUSHI_V2: FALLBACK.SUSHI_V2,
    CAMELOT_V2: FALLBACK.CAMELOT_V2,
    UNI_UR: FALLBACK.UNI_UR,
    ONEINCH: FALLBACK.ONEINCH,
    ZEROX: FALLBACK.ZEROX,
    PARASWAP: FALLBACK.PARASWAP,
    ODOS: FALLBACK.ODOS,
};
/* -------- candidate output tokens (besides victim hints) -------- */
function parseExtraTokensEnv() {
    const raw = (process.env.EXTRA_TOKENS || '').trim();
    if (!raw)
        return [];
    const out = [];
    for (const s of raw.split(',').map((t) => t.trim()).filter(Boolean)) {
        try {
            out.push(ethers_1.ethers.getAddress(s));
        }
        catch { /* skip invalid */ }
    }
    return out;
}
const CANDIDATE_OUT_TOKENS = Array.from(new Set([
    ADDR_SAFE.USDC, ADDR_SAFE.USDCe, ADDR_SAFE.USDT, ADDR_SAFE.DAI, ADDR_SAFE.WBTC, ADDR_SAFE.ARB,
    ...parseExtraTokensEnv(),
]));
/* Routers (parse by sighash) + aggregators (accept any) */
const ROUTERS_CHECKSUM = [ADDR_SAFE.V3, ADDR_SAFE.SUSHI_V2, ADDR_SAFE.CAMELOT_V2];
const AGGREGATORS_CHECKSUM = [ADDR_SAFE.UNI_UR, ADDR_SAFE.ONEINCH, ADDR_SAFE.ZEROX, ADDR_SAFE.PARASWAP, ADDR_SAFE.ODOS];
const ALL_TARGETS_CHECKSUM = ROUTERS_CHECKSUM.concat(AGGREGATORS_CHECKSUM);
const ALL_TARGETS_LC = ALL_TARGETS_CHECKSUM.map(a => a.toLowerCase());
const AGGREGATORS_LC = new Set(AGGREGATORS_CHECKSUM.map(a => a.toLowerCase()));
/* --------------------- Filtering ---------------------- */
function isInteresting(pt, routersLc) {
    if (!pt.to)
        return false;
    const toLc = pt.to.toLowerCase();
    if (!routersLc.includes(toLc))
        return false;
    if (AGGREGATORS_LC.has(toLc))
        return true; // aggs allowed regardless of sighash
    const sig = (pt.data ?? '').slice(0, 10);
    return INTERESTING_SIGHASHES.has(sig);
}
/* ------------------ Hex helpers -------------------- */
function asHex(x) {
    if (x == null)
        return undefined;
    if (x < 0n)
        return undefined;
    return '0x' + x.toString(16);
}
/* --------- Build sanitized tx for anvil (no mixed fee styles) --------- */
function buildTxLegacy(pt) {
    const req = {
        from: ethers_1.ethers.getAddress(pt.from),
        to: pt.to ? ethers_1.ethers.getAddress(pt.to) : undefined,
        data: pt.data ?? '0x',
        value: asHex(pt.value) ?? '0x0',
        gas: asHex(pt.gas),
        gasPrice: asHex(pt.gasPrice),
        nonce: pt.nonce,
    };
    Object.keys(req).forEach((k) => (req[k] === undefined) && delete req[k]);
    return req;
}
function buildTx1559(pt) {
    const maxFee = pt.maxFeePerGas ?? pt.gasPrice ?? 0n;
    const maxPriority = pt.maxPriorityFeePerGas ?? 0n;
    const req = {
        from: ethers_1.ethers.getAddress(pt.from),
        to: pt.to ? ethers_1.ethers.getAddress(pt.to) : undefined,
        data: pt.data ?? '0x',
        value: asHex(pt.value) ?? '0x0',
        gas: asHex(pt.gas),
        maxFeePerGas: asHex(maxFee),
        maxPriorityFeePerGas: asHex(maxPriority),
        nonce: pt.nonce,
        type: '0x2',
    };
    Object.keys(req).forEach((k) => (req[k] === undefined) && delete req[k]);
    return req;
}
/* ----------------------- WS JSON-RPC (events only) -------------------- */
class WsRpc {
    ws;
    nextId = 1;
    inflight = new Map();
    onSub;
    constructor(url, onSub) {
        this.ws = new ws_1.default(url, { perMessageDeflate: false });
        this.onSub = onSub;
        const connectTimeoutMs = Number(process.env.WS_CONNECT_TIMEOUT_MS || '12000');
        const connTimer = setTimeout(() => {
            if (this.ws.readyState !== ws_1.default.OPEN) {
                try {
                    this.ws.terminate();
                }
                catch { }
            }
        }, Math.max(3000, connectTimeoutMs));
        this.ws.on('open', () => { clearTimeout(connTimer); console.log('[WS] connected:', url); });
        this.ws.on('error', (err) => console.error('[WS] error', url, err));
        this.ws.on('close', () => clearTimeout(connTimer));
        this.ws.on('message', (raw) => {
            let msg;
            try {
                msg = JSON.parse(raw.toString());
            }
            catch {
                return;
            }
            if (msg && msg.method && msg.params) {
                try {
                    this.onSub(msg.method, msg.params, this);
                }
                catch { /* ignore */ }
                return;
            }
            if (msg && typeof msg.id === 'number') {
                const h = this.inflight.get(msg.id);
                if (!h)
                    return;
                this.inflight.delete(msg.id);
                if ('result' in msg)
                    h.resolve(msg.result);
                else if ('error' in msg)
                    h.reject(msg.error);
            }
        });
        const interval = setInterval(() => {
            if (this.ws.readyState === ws_1.default.OPEN) {
                this.ws.ping();
                if (process.env.DEBUG_MEMPOOL === '1')
                    console.log('[WS] heartbeat');
            }
        }, 30_000);
        this.ws.on('close', () => clearInterval(interval));
    }
    async send(method, params = []) {
        if (this.ws.readyState !== ws_1.default.OPEN) {
            await new Promise((resolve, reject) => {
                const onOpen = () => { this.ws.off('error', onErr); resolve(); };
                const onErr = (e) => { this.ws.off('open', onOpen); reject(e); };
                this.ws.once('open', onOpen);
                this.ws.once('error', onErr);
            });
        }
        const id = this.nextId++;
        this.ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
        return await new Promise((resolve, reject) => {
            this.inflight.set(id, { resolve, reject });
            const t = setTimeout(() => {
                if (this.inflight.delete(id))
                    reject(new Error(`RPC timeout for ${method}`));
            }, 20_000);
            const settle = (ok, v) => { try {
                clearTimeout(t);
            }
            catch { } ok ? resolve(v) : reject(v); };
            this.inflight.set(id, {
                resolve: (v) => { this.inflight.delete(id); settle(true, v); },
                reject: (e) => { this.inflight.delete(id); settle(false, e); },
            });
        });
    }
}
/* --------------------- Normalizer ---------------------------- */
function normalizeTxLike(obj) {
    try {
        return {
            hash: obj.hash,
            from: obj.from,
            to: obj.to ?? null,
            nonce: Number(obj.nonce),
            value: obj.value ? BigInt(obj.value) : 0n,
            data: obj.input ?? obj.data ?? '0x',
            gas: obj.gas ? BigInt(obj.gas) : null,
            gasPrice: obj.gasPrice ? BigInt(obj.gasPrice) : null,
            maxFeePerGas: obj.maxFeePerGas ? BigInt(obj.maxFeePerGas) : null,
            maxPriorityFeePerGas: obj.maxPriorityFeePerGas ? BigInt(obj.maxPriorityFeePerGas) : null,
        };
    }
    catch {
        return null;
    }
}
/* ------------------- Endpoint helpers ---------------- */
function isAlchemy(u) { return /alchemy\.com/i.test(u); }
function isQuickNode(u) { return /quiknode|quicknode/i.test(u); }
function isBlast(u) { return /blastapi\.io/i.test(u); }
function isInfura(u) { return /infura\.io/i.test(u); }
function isAlchemyHost(label) { return isAlchemy(label); }
function isQuickNodeHost(label) { return isQuickNode(label); }
function cleanList(raw) { return raw.split(',').map(s => s.trim()).filter(Boolean); }
function dedup(urls) { const set = new Set(); const out = []; for (const u of urls)
    if (!set.has(u)) {
        set.add(u);
        out.push(u);
    } return out; }
function gatherWssUrls() {
    const manual = cleanList(process.env.WSS_URLS || '');
    const single = (process.env.WSS_URL || '').trim();
    const fallbacks = [
        process.env.ARB_WS_URL_PRIMARY || '',
        process.env.ARB_WS_URL_BACKUP_1 || '',
        process.env.ARB_WS_URL_BACKUP_2 || '',
        process.env.ARB_WS_URL_BACKUP_3 || '',
        process.env.BWARE_ARB_WSS || '',
    ].filter(Boolean);
    const mixed = dedup([...manual, single, ...fallbacks]);
    const alchemy = mixed.filter(isAlchemy);
    const qnode = mixed.filter(isQuickNode);
    const blast = mixed.filter(isBlast);
    const infura = mixed.filter(isInfura);
    const other = mixed.filter(u => !alchemy.includes(u) && !qnode.includes(u) && !blast.includes(u) && !infura.includes(u));
    return dedup([...alchemy, ...qnode, ...blast, ...infura, ...other]);
}
function gatherHttpUrls() {
    const fromLists = [
        process.env.FETCH_HTTP_URLS || '',
        process.env.ARB_RPC_URLS || '',
    ].map(cleanList).flat();
    const individuals = [
        process.env.ARB_RPC_URL || '',
        process.env.ALCHEMY_URL || '',
        process.env.ARB_RPC_URL_BACKUP_1 || '',
        process.env.ARB_RPC_URL_BACKUP_2 || '',
        process.env.ARB_RPC_URL_BACKUP_3 || '',
        process.env.BWARE_ARB_HTTP || '',
    ].filter(Boolean);
    let raw = dedup([...fromLists, ...individuals]).filter(u => !/xxx|<|YOUR/i.test(u));
    // If we have ANY Alchemy WSS, drop Alchemy HTTP (unless explicitly allowed)
    const haveAlchemyWss = gatherWssUrls().some(isAlchemy);
    const allowAlchemyHttp = process.env.ALCHEMY_HTTP_ALLOWED === '1';
    if (haveAlchemyWss && !allowAlchemyHttp) {
        raw = raw.filter(u => !isAlchemy(u));
    }
    return raw;
}
const HTTP_URLS = gatherHttpUrls();
const WSS_LIST = gatherWssUrls();
if (!WSS_LIST.length)
    throw new Error('No WSS endpoints found. Provide WSS_URL(S)/ARB_WS_URL_PRIMARY/etc.');
const httpProviders = HTTP_URLS
    .map((u) => ({ url: u, isAlchemy: isAlchemy(u), provider: new ethers_1.ethers.JsonRpcProvider(u, { name: 'arbitrum', chainId: 42161 }) }))
    // Prefer non-Alchemy first for expensive calls
    .sort((a, b) => Number(a.isAlchemy) - Number(b.isAlchemy));
if (!httpProviders.length) {
    console.warn('[HTTP] No HTTP RPCs configured; heavy fetches may hit WS limits.');
}
/* ------------------- Limiters (CU-friendly defaults) ------------------- */
class RpcLimiter {
    q = [];
    tokens;
    lastRefill = Date.now();
    rps;
    burst;
    refillMs;
    timer = null;
    constructor(rps = 2, burst = 4) {
        this.rps = Math.max(1, rps);
        this.burst = Math.max(1, burst);
        this.tokens = this.burst;
        this.refillMs = 1000 / this.rps;
    }
    schedule() {
        if (this.timer)
            return;
        this.timer = setTimeout(() => { this.timer = null; this.refill(); }, 50);
    }
    refill() {
        const now = Date.now(), elapsed = now - this.lastRefill;
        let add = Math.floor(elapsed / this.refillMs);
        if (add > 0) {
            this.tokens = Math.min(this.burst, this.tokens + add);
            this.lastRefill = now;
            while (this.tokens > 0 && this.q.length) {
                this.tokens--;
                const fn = this.q.shift();
                fn();
            }
        }
        if (this.q.length > 0 || this.tokens < this.burst)
            this.schedule();
    }
    async call(fn) {
        return new Promise((resolve, reject) => {
            const runner = () => { fn().then(resolve).catch(reject); };
            if (this.tokens > 0) {
                this.tokens--;
                runner();
            }
            else {
                this.q.push(runner);
                this.schedule();
            }
        });
    }
}
const FETCH_RPS = Number(process.env.FETCH_RPS || '2');
const FETCH_BURST = Number(process.env.FETCH_BURST || '4');
const limiter = new RpcLimiter(FETCH_RPS, FETCH_BURST);
// Per-Alchemy limiter (extra strict)
const ALCHEMY_RPS = Number(process.env.ALCHEMY_RPS || '1');
const ALCHEMY_BURST = Number(process.env.ALCHEMY_BURST || '2');
const alchemyLimiter = new RpcLimiter(ALCHEMY_RPS, ALCHEMY_BURST);
// Extra limiter for hash→tx fetch path
const HASH_FETCH_RPS = Number(process.env.HASH_FETCH_RPS || '1');
const HASH_FETCH_BURST = Number(process.env.HASH_FETCH_BURST || '2');
const hashFetchLimiter = new RpcLimiter(HASH_FETCH_RPS, HASH_FETCH_BURST);
let httpIndex = 0;
let alchemyCallCount = 0;
function isRetryableRpcError(e) {
    const m = (e?.message || '').toString().toLowerCase();
    return (m.includes('limit') || m.includes('-32007') || m.includes('429') ||
        m.includes('timeout') || m.includes('econnreset') || m.includes('socket') ||
        m.includes('temporarily') || m.includes('unavailable'));
}
async function providerSend(p, method, params) {
    const fn = () => p.provider.send(method, params);
    const res = p.isAlchemy ? alchemyLimiter.call(fn) : limiter.call(fn);
    if (p.isAlchemy) {
        alchemyCallCount++;
        if (alchemyCallCount % 10 === 0)
            console.log(`[ALCHEMY] Call count: ${alchemyCallCount}`);
    }
    return res;
}
async function rpcGet(method, params) {
    if (!httpProviders.length)
        throw new Error('[HTTP] No HTTP RPCs configured');
    let lastErr = null;
    const n = httpProviders.length;
    for (let i = 0; i < n; i++) {
        const idx = (httpIndex + i) % n;
        const prov = httpProviders[idx];
        try {
            const res = await providerSend(prov, method, params);
            httpIndex = idx; // stickiness
            return res;
        }
        catch (e) {
            lastErr = e;
            if (isRetryableRpcError(e))
                continue;
            break;
        }
    }
    throw lastErr ?? new Error('rpcGet failed with no providers');
}
/* ---------------------- Logging helpers ------------------------ */
const LOG_LEVEL = (process.env.LOG_LEVEL || 'info').toLowerCase();
const DEBUG_MEMPOOL = process.env.DEBUG_MEMPOOL === '1';
const isDebug = DEBUG_MEMPOOL || LOG_LEVEL === 'debug';
function debug(...a) { if (isDebug)
    console.log(...a); }
/* ---------------------- Helpers ------------------------ */
function applySlippageBps(amount, bps) {
    return (amount * (10000n - BigInt(bps))) / 10000n;
}
function asExactInputSingleTuple(p) {
    return [p.tokenIn, p.tokenOut, p.fee, p.recipient, p.deadline, p.amountIn, p.amountOutMinimum, p.sqrtPriceLimitX96];
}
async function ensureWethAndAllowance(you, weth, spender, wantWeth) {
    const youAddr = await you.getAddress();
    const bal = await weth.balanceOf(youAddr);
    if (bal < wantWeth) {
        const need = wantWeth - bal;
        console.log(`  [warmup] wrapping ETH→WETH amount=${ethers_1.ethers.formatEther(need)} WETH`);
        await (await weth.connect(you).deposit({ value: need })).wait();
    }
    const erc20 = new ethers_1.ethers.Contract(ADDR_SAFE.WETH, ERC20_ABI, you);
    const current = await erc20.allowance(youAddr, spender);
    if (current < wantWeth) {
        console.log(`  [warmup] approving router ${spender} for WETH`);
        await (await erc20.approve(spender, ethers_1.ethers.MaxUint256)).wait();
    }
}
/* ---------------------- Victim decoding ------------------------ */
const IFACE_V3_SINGLE = new ethers_1.ethers.Interface([
    'function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96))'
]);
const IFACE_V3_MULTI = new ethers_1.ethers.Interface([
    'function exactInput((bytes path,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum))'
]);
const IFACE_V2 = new ethers_1.ethers.Interface([
    'function swapExactTokensForTokens(uint256 amountIn,uint256 amountOutMin,address[] path,address to,uint256 deadline)',
    'function multicall(uint256 deadline, bytes[] data)'
]);
function parseV3Path(pathHex) {
    const buf = Buffer.from(pathHex.replace(/^0x/, '') || '', 'hex');
    const tokens = [];
    const fees = [];
    let i = 0;
    if (buf.length < 20)
        return { tokens, fees };
    tokens.push(ethers_1.ethers.getAddress('0x' + buf.slice(i, i + 20).toString('hex')));
    i += 20;
    while (i + 23 <= buf.length) {
        const fee = buf.readUIntBE(i, 3);
        i += 3;
        const t = ethers_1.ethers.getAddress('0x' + buf.slice(i, i + 20).toString('hex'));
        i += 20;
        fees.push(fee);
        tokens.push(t);
    }
    return { tokens, fees };
}
function victimHint(pt) {
    if (!pt.to || !pt.data || pt.data.length < 10)
        return null;
    const sig = pt.data.slice(0, 10);
    try {
        if (pt.to.toLowerCase() === ADDR_SAFE.V3.toLowerCase()) {
            if (sig === SIG_V3_SINGLE) {
                const { args } = IFACE_V3_SINGLE.parseTransaction({ data: pt.data });
                const p = args[0];
                return { tokenIn: ethers_1.ethers.getAddress(p.tokenIn), tokenOut: ethers_1.ethers.getAddress(p.tokenOut), feeCandidates: [Number(p.fee)] };
            }
            if (sig === SIG_V3_MULTI) {
                const { args } = IFACE_V3_MULTI.parseTransaction({ data: pt.data });
                const { tokens, fees } = parseV3Path(args[0]);
                if (tokens.length >= 2) {
                    return { tokenIn: tokens[0], tokenOut: tokens[tokens.length - 1], feeCandidates: fees.length ? [fees[0]] : undefined };
                }
            }
        }
        else if (sig === SIG_V2_SWAP_EXACT_TOKENS_FOR_TOKENS || sig === SIG_V2_MULTICALL) {
            try {
                const { args } = IFACE_V2.parseTransaction({ data: pt.data });
                const path = Array.isArray(args?.[2]) ? args[2] : undefined;
                if (path && path.length >= 2) {
                    return { tokenIn: ethers_1.ethers.getAddress(path[0]), tokenOut: ethers_1.ethers.getAddress(path[path.length - 1]) };
                }
            }
            catch { }
        }
    }
    catch { /* ignore */ }
    return null;
}
/* ---------------------- Fee tiers (configurable) ------------------------ */
function parseFeeTiers() {
    const raw = (process.env.UNI_FEE_TIERS || '').trim();
    if (!raw)
        return [100, 500, 3000, 10000];
    return raw.split(',').map(s => Number(s.trim())).filter(n => Number.isFinite(n) && n > 0);
}
const FEE_ORDER_DEFAULT = parseFeeTiers();
/* ---------------------- V3 pool probe + quoting ------------------------ */
function sortTokens(a, b) {
    return a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
}
async function probeV3Pool(provider, tokenIn, tokenOut, fee) {
    const factory = new ethers_1.ethers.Contract(ADDR_SAFE.V3_FACTORY, V3_FACTORY_ABI, provider);
    const [t0, t1] = sortTokens(ethers_1.ethers.getAddress(tokenIn), ethers_1.ethers.getAddress(tokenOut));
    const pool = await factory.getPool(t0, t1, fee);
    if (!pool || pool === ethers_1.ethers.ZeroAddress)
        return { pool: ethers_1.ethers.ZeroAddress, liquidity: 0n };
    const poolC = new ethers_1.ethers.Contract(pool, V3_POOL_ABI, provider);
    try {
        const liq = await poolC.liquidity();
        if (liq === 0n)
            return { pool, liquidity: 0n };
        const [sqrtP] = await poolC.slot0();
        return { pool, liquidity: liq, sqrtPriceX96: BigInt(sqrtP) };
    }
    catch {
        return { pool, liquidity: 0n };
    }
}
/** Only QuoterV2 for quotes — don't staticCall the router (causes STF). */
async function quoteViaQuoter(provider, tokenIn, tokenOut, fee, amountIn) {
    const quoter = new ethers_1.ethers.Contract(ADDR_SAFE.QUOTER, QUOTER_V2_ABI, provider);
    try {
        const [amountOut] = await quoter.quoteExactInputSingle.staticCall(tokenIn, tokenOut, fee, amountIn, 0n);
        return amountOut;
    }
    catch (e) {
        debug('  [quote] quoter v2 failed:', e?.message || e);
        return 0n;
    }
}
/* --------- Build candidates (victim hints + expanded list) --------- */
function buildQuoteCandidates(pt, weth) {
    const hints = victimHint(pt);
    const out = [];
    if (hints) {
        const fees = hints.feeCandidates?.length ? hints.feeCandidates : FEE_ORDER_DEFAULT;
        if (hints.tokenIn.toLowerCase() === weth.toLowerCase()) {
            out.push({ tokenIn: hints.tokenIn, tokenOut: hints.tokenOut, fees });
        }
        else if (hints.tokenOut.toLowerCase() === weth.toLowerCase()) {
            out.push({ tokenIn: weth, tokenOut: hints.tokenIn, fees });
        }
    }
    for (const tok of CANDIDATE_OUT_TOKENS) {
        if (tok.toLowerCase() === weth.toLowerCase())
            continue;
        out.push({ tokenIn: ADDR_SAFE.WETH, tokenOut: tok, fees: FEE_ORDER_DEFAULT });
    }
    const seen = new Set();
    return out.filter(c => { const key = `${c.tokenIn}-${c.tokenOut}-${c.fees.join(',')}`.toLowerCase(); if (seen.has(key))
        return false; seen.add(key); return true; });
}
/* -------------------- Probe+Quote (concurrent, cached) ------------------ */
const PROBE_CONCURRENCY = Math.max(1, Number(process.env.PROBE_CONCURRENCY || '2'));
const PROBE_CACHE_TTL_MS = Math.max(60_000, Number(process.env.PROBE_CACHE_TTL_MS || '600000'));
const probeCache = new Map();
function probeCacheGet(key) { const e = probeCache.get(key); if (!e)
    return null; if (Date.now() - e.ts > PROBE_CACHE_TTL_MS) {
    probeCache.delete(key);
    return null;
} return e; }
function probeCacheSet(key, pool, liquidity) { probeCache.set(key, { ts: Date.now(), pool, liquidity }); }
async function bestQuoteWithProbe(you, provider, amountIn, candidates) {
    let winner = null;
    const tasks = [];
    for (const c of candidates) {
        for (const f of c.fees) {
            tasks.push(async () => {
                if (winner)
                    return;
                const key = `${c.tokenIn}-${c.tokenOut}-${f}`.toLowerCase();
                const cached = probeCacheGet(key);
                let useProbe = null;
                if (cached)
                    useProbe = { pool: cached.pool, liquidity: cached.liquidity };
                else {
                    const probe = await probeV3Pool(provider, c.tokenIn, c.tokenOut, f);
                    probeCacheSet(key, probe.pool, probe.liquidity);
                    useProbe = probe;
                }
                if (!useProbe || useProbe.pool === ethers_1.ethers.ZeroAddress || useProbe.liquidity === 0n) {
                    debug(`  [probe] skip (no pool/liquidity) ${short(c.tokenIn)}↔${short(c.tokenOut)} fee=${f}`);
                    return;
                }
                if (isDebug)
                    console.log(`  [probe] pool fee=${f} addr=${useProbe.pool} L=${useProbe.liquidity.toString()} sqrtP=${useProbe.sqrtPriceX96?.toString() ?? 'n/a'}`);
                const viaQuoter = await quoteViaQuoter(provider, c.tokenIn, c.tokenOut, f, amountIn);
                if (viaQuoter > 0n && !winner) {
                    winner = { amountOut: viaQuoter, fee: f, tokenIn: c.tokenIn, tokenOut: c.tokenOut, source: 'quoter' };
                    return;
                }
            });
        }
    }
    let idx = 0;
    async function worker() { while (idx < tasks.length && !winner) {
        const i = idx++;
        try {
            await tasks[i]();
        }
        catch (e) {
            debug('  [probe] worker error:', e?.message || e);
        }
    } }
    const workers = Array.from({ length: Math.min(PROBE_CONCURRENCY, tasks.length) }, () => worker());
    await Promise.all(workers);
    return winner ?? { amountOut: 0n, fee: null, tokenIn: '', tokenOut: '', source: 'none' };
}
/* ---------------------- Profit Estimation Helpers ---------------------- */
/** Quoter-only reverse leg (tokenOut -> WETH) */
async function bestQuoteTokenToWeth(provider, tokenOut, amountTokenOut) {
    if (tokenOut.toLowerCase() === ADDR_SAFE.WETH.toLowerCase()) {
        return { backWeth: amountTokenOut, fee: null };
    }
    let best = { backWeth: 0n, fee: null };
    for (const fee of FEE_ORDER_DEFAULT) {
        const probe = await probeV3Pool(provider, tokenOut, ADDR_SAFE.WETH, fee);
        if (!probe || probe.pool === ethers_1.ethers.ZeroAddress || probe.liquidity === 0n)
            continue;
        const viaQuoter = await quoteViaQuoter(provider, tokenOut, ADDR_SAFE.WETH, fee, amountTokenOut);
        if (viaQuoter > best.backWeth)
            best = { backWeth: viaQuoter, fee };
    }
    return best;
}
async function fetchEthUsdPrice(provider) {
    const feedAddr = (process.env.CHAINLINK_ETH_USD || '').trim();
    if (!feedAddr)
        return null;
    const feed = new ethers_1.ethers.Contract(feedAddr, CHAINLINK_FEED_ABI, provider);
    try {
        const [, answer] = await feed.latestRoundData.staticCall();
        const dec = await feed.decimals();
        if (typeof answer !== 'bigint')
            return null;
        if (answer <= 0n)
            return null;
        return { price: answer, decimals: dec };
    }
    catch {
        return null;
    }
}
function formatUsdFromWethDelta(deltaWeth, ethUsd) {
    if (!ethUsd)
        return 'n/a';
    const usd = Number(ethers_1.ethers.formatUnits(deltaWeth, 18)) * Number(ethers_1.ethers.formatUnits(ethUsd.price, ethUsd.decimals));
    const s = usd.toLocaleString(undefined, { maximumFractionDigits: 2 });
    return `$${s}`;
}
/* ---------------------- CU-friendly polling controls ---------------- */
const QUIET_FAILOVER_SEC = Math.max(10, Number(process.env.QUIET_FAILOVER_SEC || '300'));
const PENDING_POLL_MS = Math.max(500, Number(process.env.PENDING_POLL_MS || '10000'));
const EARLY_TTL_MS = Math.max(30_000, Number(process.env.EARLY_TTL_MS || '300000'));
/* ---------------------- Aggressive pending poll (off until quiet) ------ */
async function scanPendingBlock(onPendingTx) {
    try {
        const block = await rpcGet('eth_getBlockByNumber', ['pending', true]);
        if (block && Array.isArray(block.transactions)) {
            let matched = 0;
            for (const tx of block.transactions) {
                const pt = normalizeTxLike(tx);
                if (!pt || !isInteresting(pt, ALL_TARGETS_LC))
                    continue;
                matched++;
                await onPendingTx(pt);
            }
            if (isDebug)
                console.log(`[PENDING] scanned=${block.transactions.length} matched=${matched}`);
        }
    }
    catch (e) {
        debug('[PENDING] poll error:', e?.message || e);
    }
}
/* ---------------------- Early hash dedupe ----------------- */
const earlySeen = new Map();
function rememberHash(h) {
    const now = Date.now();
    if (earlySeen.size > 5000)
        for (const [k, t] of earlySeen)
            if (now - t > EARLY_TTL_MS)
                earlySeen.delete(k);
    const last = earlySeen.get(h);
    if (last && now - last < EARLY_TTL_MS)
        return false;
    earlySeen.set(h, now);
    return true;
}
/* ---------------------- Subscriptions + Poll Fallback ----------------- */
let gotFullPendingOnce = false;
function shouldSkipBlockProcessing() {
    // Skip heavy block scans for first 5m if we already saw 20+ pending matches (healthy flow).
    return totalHits > 20 && (Date.now() - startedAt) < 300_000;
}
async function attachSubscriptions(ws, label, onPendingTx, routersChecksum, onBlockSeen) {
    const isAl = isAlchemyHost(label);
    const isQn = isQuickNodeHost(label);
    console.log(`[WS] Setting up subscriptions for ${label}`);
    // Alchemy (best-effort)
    if (isAl) {
        try {
            const id = await ws.send('eth_subscribe', [
                'alchemy_newFullPendingTransactions',
                { toAddress: routersChecksum }
            ]);
            console.log('[WS] alchemy_newFullPendingTransactions:', id, label);
            gotFullPendingOnce = true; // full objects
        }
        catch {
            try {
                const id2 = await ws.send('eth_subscribe', [
                    'alchemy_pendingTransactions',
                    { toAddress: routersChecksum, hashesOnly: true }
                ]);
                console.log('[WS] alchemy_pendingTransactions (hashes):', id2, label);
            }
            catch { }
        }
    }
    // QuickNode: some deployments accept the fullTransactions hint
    if (isQn) {
        try {
            const qnId = await ws.send('eth_subscribe', [
                'newPendingTransactions',
                { fullTransactions: true, toAddress: routersChecksum }
            ]);
            console.log('[WS] QuickNode full pending transactions:', qnId, label);
            gotFullPendingOnce = true;
        }
        catch { }
    }
    // Universal fallback
    try {
        const subId = await ws.send('eth_subscribe', ['newPendingTransactions']);
        console.log('[WS] Generic pending tx hashes:', subId, label);
    }
    catch (e) {
        console.warn('[WS] Even generic pending tx failed:', e?.message, label);
    }
    // Block headers (widely supported)
    try {
        const subId = await ws.send('eth_subscribe', ['newHeads']);
        console.log('[WS] New block headers:', subId, label);
    }
    catch (e) {
        console.warn('[WS] Block headers failed:', e?.message, label);
    }
    ws.onSub = async (_method, params) => {
        if (!params || !('result' in params))
            return;
        const res = params.result;
        try {
            // Full pending object
            if (res && typeof res === 'object' && 'to' in res && 'hash' in res) {
                const pt = normalizeTxLike(res);
                if (!pt || !isInteresting(pt, ALL_TARGETS_LC))
                    return;
                if (isDebug)
                    console.log(`[WS] Processing full pending tx: ${pt.hash.slice(0, 10)}…`);
                await onPendingTx(pt);
                return;
            }
            // Pending hash (fetch body only if we never got full objects)
            if (typeof res === 'string' && res.length === 66) {
                if (!rememberHash(res))
                    return;
                if (gotFullPendingOnce)
                    return;
                try {
                    await hashFetchLimiter.call(async () => {
                        const full = await rpcGet('eth_getTransactionByHash', [res]);
                        if (!full || !full.to)
                            return;
                        const pt = normalizeTxLike(full);
                        if (!pt || !isInteresting(pt, ALL_TARGETS_LC))
                            return;
                        if (isDebug)
                            console.log(`[WS] Processing fetched tx: ${pt.hash.slice(0, 10)}…`);
                        await onPendingTx(pt);
                    });
                }
                catch (e) {
                    if (isDebug)
                        console.warn(`[WS] Hash fetch failed for ${res.slice(0, 10)}:`, e?.message);
                }
                return;
            }
            // Block headers
            if (res && typeof res === 'object' && 'hash' in res && 'number' in res && !('to' in res)) {
                const bn = parseInt(res.number, 16);
                onBlockSeen?.(bn);
                if (shouldSkipBlockProcessing())
                    return;
                try {
                    const block = await rpcGet('eth_getBlockByHash', [res.hash, true]);
                    if (block && Array.isArray(block.transactions)) {
                        let blockMatches = 0;
                        for (const tx of block.transactions) {
                            const pt = normalizeTxLike(tx);
                            if (!pt || !isInteresting(pt, ALL_TARGETS_LC))
                                continue;
                            blockMatches++;
                            await onPendingTx(pt);
                        }
                        if (blockMatches > 0)
                            console.log(`[WS] Block ${bn} had ${blockMatches} interesting transactions`);
                    }
                }
                catch (e) {
                    if (isDebug)
                        console.warn(`[WS] Block fetch failed:`, e?.message);
                }
                return;
            }
        }
        catch (e) {
            if (isDebug)
                console.error('[WS] Handler error:', e);
        }
    };
}
/* ------------------------------ Main ---------------------------------- */
const startedAt = Date.now();
let totalHits = 0; // visible to shouldSkipBlockProcessing()
// Profit stats (cumulative)
let cumulativeProfitWeth = 0n;
let tradeCount = 0;
async function main() {
    const ANVIL_URL = must(process.env.ANVIL_URL, 'Set ANVIL_URL=http://127.0.0.1:8545');
    const PRIV_KEY = must(process.env.PRIVATE_KEY, 'Set PRIVATE_KEY');
    const SLIPPAGE_BPS = Number(process.env.SLIPPAGE_BPS ?? 30);
    const BACKRUN_ETH_IN = ethers_1.ethers.parseEther(process.env.BACKRUN_ETH_IN ?? '1');
    const BACKFILL_BLOCKS = Number(process.env.BACKFILL_BLOCKS ?? '0');
    const BLOCK_POLL_FALLBACK_SEC = Number(process.env.BLOCK_POLL_FALLBACK_SEC ?? '15');
    const fork = new ethers_1.ethers.JsonRpcProvider(ANVIL_URL, { name: 'arbitrum', chainId: 42161 });
    await (0, anvil_1.ensureLocalFork)(fork);
    // Warmup with automine ON
    await (0, anvil_1.setAutomine)(fork, true);
    const you = new ethers_1.ethers.Wallet(PRIV_KEY.trim(), fork);
    const youAddr = await you.getAddress();
    const weth = new ethers_1.ethers.Contract(ADDR_SAFE.WETH, WETH9_ABI, you);
    try {
        await (0, anvil_1.setBalance)(fork, youAddr, '0x56BC75E2D63100000');
    }
    catch { }
    const alchemyW = WSS_LIST.filter(isAlchemy);
    const qnodeW = WSS_LIST.filter(isQuickNode);
    const blastW = WSS_LIST.filter(isBlast);
    const infuraW = WSS_LIST.filter(isInfura);
    const othersW = WSS_LIST.filter(u => !alchemyW.includes(u) && !qnodeW.includes(u) && !blastW.includes(u) && !infuraW.includes(u));
    console.log('Shadow mempool sim starting… (pending tx → local replay + backrun in one block)');
    console.log(`Primaries (WSS): Alchemy=${alchemyW[0] ?? '—'}, QuickNode=${qnodeW[0] ?? '—'}`);
    const backupsW = [...blastW, ...infuraW, ...othersW].filter(Boolean);
    console.log(`Backups  (WSS): ${backupsW.length ? backupsW.join(', ') : '—'}`);
    console.log(`[HTTP] Providers (${HTTP_URLS.length}): ${HTTP_URLS.join(', ')}`);
    console.log(`Backrun notional: ${ethers_1.ethers.formatEther(BACKRUN_ETH_IN)} WETH | slippage=${SLIPPAGE_BPS} bps`);
    console.log(`Routers watched: V3=${ADDR_SAFE.V3}, SushiV2=${ADDR_SAFE.SUSHI_V2}, CamelotV2=${ADDR_SAFE.CAMELOT_V2}`);
    console.log(`Aggregators : UR=${ADDR_SAFE.UNI_UR}, 1inch=${ADDR_SAFE.ONEINCH}, 0x=${ADDR_SAFE.ZEROX}, ParaSwap=${ADDR_SAFE.PARASWAP}, Odos=${ADDR_SAFE.ODOS}`);
    console.log(`Tokens: WETH=${ADDR_SAFE.WETH}`);
    console.log(`Candidates: ${CANDIDATE_OUT_TOKENS.join(', ')}`);
    // Global warmup (wrap+approve) before we switch off automine
    await ensureWethAndAllowance(you, weth, ADDR_SAFE.V3, BACKRUN_ETH_IN);
    const warmBal = await weth.balanceOf(youAddr);
    console.log(`Warmup complete: WETH balance=${ethers_1.ethers.formatEther(warmBal)} approved for router ${ADDR_SAFE.V3}`);
    // Bundle victim + backrun in the same block
    await (0, anvil_1.setAutomine)(fork, false);
    const seen = new Set();
    let hitsSinceLastReport = 0;
    const onPendingTx = async (pt) => {
        if (seen.has(pt.hash))
            return;
        seen.add(pt.hash);
        hitsSinceLastReport++;
        totalHits++;
        const snap = await (0, anvil_1.snapshot)(fork);
        try {
            await handleVictimTx(fork, you, weth, pt, BACKRUN_ETH_IN, SLIPPAGE_BPS);
        }
        catch (e) {
            if (isDebug)
                console.error('[handler] error', e);
        }
        finally {
            try {
                await (0, anvil_1.revertTo)(fork, snap);
            }
            catch { }
        }
    };
    const sockets = [];
    let lastSeenBlock = -1;
    for (const url of WSS_LIST) {
        const ws = new WsRpc(url, async (_m, _p, _self) => { });
        await attachSubscriptions(ws, url, onPendingTx, ALL_TARGETS_CHECKSUM, (bn) => { lastSeenBlock = Math.max(lastSeenBlock, bn); });
        sockets.push(ws);
    }
    // Startup backfill (default off)
    try {
        if (BACKFILL_BLOCKS > 0) {
            const latestHex = await rpcGet('eth_blockNumber', []);
            const latest = parseInt(latestHex, 16);
            lastSeenBlock = Math.max(lastSeenBlock, latest);
            const from = Math.max(0, latest - Math.max(0, BACKFILL_BLOCKS));
            for (let n = from; n <= latest; n++) {
                const hex = '0x' + n.toString(16);
                const block = await rpcGet('eth_getBlockByNumber', [hex, true]);
                if (block && Array.isArray(block.transactions)) {
                    for (const tx of block.transactions) {
                        const pt = normalizeTxLike(tx);
                        if (!pt || !isInteresting(pt, ALL_TARGETS_LC))
                            continue;
                        await onPendingTx(pt);
                    }
                }
            }
        }
    }
    catch (e) {
        if (isDebug)
            console.warn('[backfill] failed (ok to ignore):', e);
    }
    // Generic latest-block poll fallback (slow)
    setInterval(async () => {
        try {
            const latestHex = await rpcGet('eth_blockNumber', []);
            const latest = parseInt(latestHex, 16);
            if (lastSeenBlock < 0)
                lastSeenBlock = latest - 1;
            if (latest > lastSeenBlock) {
                if (shouldSkipBlockProcessing()) {
                    lastSeenBlock = latest;
                    return;
                }
                for (let n = lastSeenBlock + 1; n <= latest; n++) {
                    const hex = '0x' + n.toString(16);
                    const block = await rpcGet('eth_getBlockByNumber', [hex, true]);
                    if (block && Array.isArray(block.transactions)) {
                        for (const tx of block.transactions) {
                            const pt = normalizeTxLike(tx);
                            if (!pt || !isInteresting(pt, ALL_TARGETS_LC))
                                continue;
                            await onPendingTx(pt);
                        }
                    }
                }
                lastSeenBlock = latest;
            }
        }
        catch (e) {
            const msg = String(e?.message || e);
            if (msg.includes('limit') || msg.includes('-32007')) {
                console.warn('[HTTP] rate limited during polling; increase BLOCK_POLL_FALLBACK_SEC, lower FETCH_RPS/BURST, or add more FETCH_HTTP_URLS.');
            }
        }
    }, Math.max(3, Number(process.env.BLOCK_POLL_FALLBACK_SEC || '15')) * 1000);
    // Aggressive pending poll only after a long quiet window
    let aggressivePendingPoll = false;
    setInterval(async () => {
        const quietSec = (Date.now() - startedAt) / 1000;
        if (!aggressivePendingPoll && totalHits === 0 && quietSec >= QUIET_FAILOVER_SEC) {
            aggressivePendingPoll = true;
            console.warn(`[PENDING] No hits for ${QUIET_FAILOVER_SEC}s — enabling slow pending-block polling every ${PENDING_POLL_MS}ms.`);
        }
        if (aggressivePendingPoll) {
            await scanPendingBlock(onPendingTx);
        }
    }, PENDING_POLL_MS);
    // Heartbeat / report
    setInterval(() => {
        console.log('[WS] listening… inflight=', 0, 'hits(last 20s)=', hitsSinceLastReport, 'totalHits=', totalHits);
        if (hitsSinceLastReport === 0) {
            console.warn('[WS] Quiet window. Poller + limiter active. Add more WS via WSS_URLS or tune FETCH_RPS/BURST.');
        }
        hitsSinceLastReport = 0;
    }, 20_000);
}
async function handleVictimTx(fork, you, _weth, pt, BACKRUN_ETH_IN, SLIPPAGE_BPS) {
    const from = ethers_1.ethers.getAddress(pt.from);
    // 1) Replay victim on the fork
    await (0, anvil_1.impersonate)(fork, from);
    let victimHash;
    try {
        await (0, anvil_1.setBalance)(fork, from, '0x56BC75E2D63100000'); // 100 ETH
        await (0, anvil_1.setNonce)(fork, from, '0x' + pt.nonce.toString(16));
        const prefer1559 = (pt.maxFeePerGas != null) || (pt.maxPriorityFeePerGas != null);
        const first = prefer1559 ? buildTx1559(pt) : buildTxLegacy(pt);
        const second = prefer1559 ? buildTxLegacy(pt) : buildTx1559(pt);
        try {
            victimHash = await fork.send('eth_sendTransaction', [first]);
        }
        catch {
            victimHash = await fork.send('eth_sendTransaction', [second]);
        }
        console.log(`  ↳ Victim replayed on Anvil: ${victimHash}`);
    }
    finally {
        await (0, anvil_1.stopImpersonate)(fork, from);
    }
    // 2) Quote forward on Quoter only
    const candidates = buildQuoteCandidates(pt, ADDR_SAFE.WETH);
    const picked = await bestQuoteWithProbe(you, fork, BACKRUN_ETH_IN, candidates);
    // Must start with WETH — skip any USDC→WETH, etc.
    if (picked.amountOut === 0n || picked.fee == null || picked.tokenIn.toLowerCase() !== ADDR_SAFE.WETH.toLowerCase()) {
        console.warn('  [backrun] No viable forward WETH→X quote. Skipping.');
        await (0, anvil_1.mineOne)(fork);
        return;
    }
    // Reverse (mark-to-market back to WETH)
    const reverse = await bestQuoteTokenToWeth(fork, picked.tokenOut, picked.amountOut);
    const estProfitWeth = reverse.backWeth - BACKRUN_ETH_IN;
    const ethUsd = await fetchEthUsdPrice(fork);
    const estProfitUsdStr = formatUsdFromWethDelta(estProfitWeth, ethUsd);
    console.log(`[PROFIT] Est. back-to-WETH=${ethers_1.ethers.formatEther(reverse.backWeth)} WETH | Est. Profit=${ethers_1.ethers.formatEther(estProfitWeth)} WETH ~ ${estProfitUsdStr}`);
    // If we can’t unwind ≥ input, don’t send
    if (reverse.backWeth <= BACKRUN_ETH_IN) {
        console.warn('  [backrun] Reverse leg not profitable / unavailable. Skipping send.');
        await (0, anvil_1.mineOne)(fork);
        return;
    }
    // 3) Build tx
    const routerV3 = new ethers_1.ethers.Contract(ADDR_SAFE.V3, V3_ROUTER_ABI, you);
    const youAddr = await you.getAddress();
    const minOut = applySlippageBps(picked.amountOut, SLIPPAGE_BPS);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 120);
    const params = {
        tokenIn: picked.tokenIn,
        tokenOut: picked.tokenOut,
        fee: picked.fee,
        recipient: youAddr,
        deadline,
        amountIn: BACKRUN_ETH_IN,
        amountOutMinimum: minOut,
        sqrtPriceLimitX96: 0n,
    };
    let brHash = null;
    try {
        const br = await routerV3.exactInputSingle(asExactInputSingleTuple(params), { gasLimit: 700000n, value: 0n });
        brHash = br.hash;
        console.log(`  ↳ Backrun (UniV3 ${short(picked.tokenIn)}→${short(picked.tokenOut)}, fee=${picked.fee}) submitted: ${br.hash} | minOut=${minOut.toString()}`);
    }
    catch (e) {
        console.warn('  [backrun] UniV3 exactInputSingle send failed:', e?.message || e);
    }
    // 4) Mine together
    await (0, anvil_1.mineOne)(fork);
    // 5) Count trade & profit only if tx succeeded
    if (brHash) {
        try {
            const rcpt = await fork.getTransactionReceipt(brHash);
            if (rcpt && rcpt.status === 1) {
                tradeCount++;
                cumulativeProfitWeth += estProfitWeth;
                console.log(`[STATS] trades=${tradeCount} | cumulative=${ethers_1.ethers.formatEther(cumulativeProfitWeth)} WETH ${ethUsd ? `(~ ${formatUsdFromWethDelta(cumulativeProfitWeth, ethUsd)})` : ''}`);
            }
            else {
                console.warn('  [backrun] Tx reverted; not counting toward STATS.');
            }
        }
        catch {
            console.warn('  [backrun] No receipt; not counting toward STATS.');
        }
    }
}
function short(a) { return a.slice(0, 6) + '…' + a.slice(-4); }
main().catch((e) => {
    console.error('Shadow mempool sim failed:', e);
    process.exit(1);
});
