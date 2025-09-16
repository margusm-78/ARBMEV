"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.candidateV3Specs = candidateV3Specs;
exports.candidateV2Specs = candidateV2Specs;
exports.resolvePools = resolvePools;
// src/searcher/pools.ts
require("dotenv/config");
const ethers_1 = require("ethers");
const cuWrappedProvider_1 = require("./cuWrappedProvider");
const UNI_V3_FACTORY = (process.env.UNI_FACTORY || "0x1F98431c8aD98523631AE4a59f267346ea31F984");
const SUSHI_FACTORY = (process.env.SUSHI_FACTORY || "0xc35DADB65012eC5796536bD9864eD8773aBc74C4");
const CAMELOT_FACTORY = (process.env.CAMELOT_FACTORY || "0x6EcCab422D763aC031210895C81787E87B91678B");
const UniV3FactoryAbi = [
    "function getPool(address tokenA, address tokenB, uint24 fee) view returns (address)"
];
const V2FactoryAbi = [
    "function getPair(address tokenA, address tokenB) view returns (address)"
];
// Pull tokens from env
function req(name) {
    const v = (process.env[name] || "").trim();
    if (!v)
        throw new Error(`Missing env ${name}`);
    return v;
}
function candidateV3Specs() {
    const ARB = req("TOKEN_ARB");
    const WETH = req("TOKEN_WETH");
    const USDC = req("TOKEN_USDC");
    const USDT = req("TOKEN_USDT");
    const WBTC = req("TOKEN_WBTC");
    const LINK = req("TOKEN_LINK");
    const DAI = req("TOKEN_DAI");
    const FRAX = req("TOKEN_FRAX");
    const stables100 = [100, 500]; // stable pairs likely at 0.01% or 0.05%
    const volatile = [500, 3000]; // typical volatile tiers on Arb
    const out = [];
    // Volatile
    for (const fee of volatile) {
        out.push({ a: ARB, b: WETH, fee });
        out.push({ a: ARB, b: USDC, fee });
        out.push({ a: WETH, b: USDC, fee });
        out.push({ a: WETH, b: USDT, fee });
        out.push({ a: WBTC, b: WETH, fee: 3000 });
        out.push({ a: LINK, b: WETH, fee: 3000 });
    }
    // Stables
    for (const fee of stables100) {
        out.push({ a: USDC, b: USDT, fee });
        out.push({ a: DAI, b: USDC, fee });
        out.push({ a: FRAX, b: USDC, fee });
    }
    // Dedup
    const key = (s) => [s.a.toLowerCase(), s.b.toLowerCase()].sort().join("-") + `:${s.fee}`;
    const uniq = new Map();
    for (const s of out)
        uniq.set(key(s), s);
    return Array.from(uniq.values());
}
function candidateV2Specs() {
    const ARB = req("TOKEN_ARB");
    const WETH = req("TOKEN_WETH");
    const USDC = req("TOKEN_USDC");
    const USDT = req("TOKEN_USDT");
    const WBTC = req("TOKEN_WBTC");
    const LINK = req("TOKEN_LINK");
    const base = [
        [ARB, WETH], [ARB, USDC], [ARB, USDT],
        [WETH, USDC], [WETH, USDT],
        [WBTC, WETH], [LINK, WETH],
    ];
    const v2 = [];
    for (const [a, b] of base) {
        v2.push({ a, b, dex: "sushi" });
        v2.push({ a, b, dex: "camelot" });
    }
    return v2;
}
async function resolvePools() {
    const provider = await (0, cuWrappedProvider_1.getCUProvider)();
    const v3Factory = new ethers_1.ethers.Contract(UNI_V3_FACTORY, UniV3FactoryAbi, provider);
    const v2S = new ethers_1.ethers.Contract(SUSHI_FACTORY, V2FactoryAbi, provider);
    const v2C = new ethers_1.ethers.Contract(CAMELOT_FACTORY, V2FactoryAbi, provider);
    const v3Specs = candidateV3Specs();
    const v2Specs = candidateV2Specs();
    // Resolve V3
    const v3 = [];
    for (const s of v3Specs) {
        const [a, b] = [s.a.toLowerCase(), s.b.toLowerCase()].sort();
        const pool = await v3Factory.getPool(a, b, s.fee);
        if (pool && pool !== ethers_1.ethers.ZeroAddress)
            v3.push({ spec: s, pool });
    }
    // Resolve V2
    const v2 = [];
    for (const s of v2Specs) {
        const [a, b] = [s.a.toLowerCase(), s.b.toLowerCase()].sort();
        const pair = await (s.dex === "sushi" ? v2S : v2C).getPair(a, b);
        if (pair && pair !== ethers_1.ethers.ZeroAddress)
            v2.push({ spec: s, pair });
    }
    console.log(`[POOLS] Resolved: UniV3=${v3.length} pools, V2=${v2.length} pairs.`);
    return { v3, v2 };
}
