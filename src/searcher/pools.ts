// src/searcher/pools.ts
import "dotenv/config";
import { ethers } from "ethers";
import { getCUProvider } from "./cuWrappedProvider";

/** ---------- address helpers ---------- */
function pickEnv(...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = (process.env[k] || "").trim();
    if (v) return v;
  }
  return undefined;
}

/** Accept mixed/incorrect case; return proper checksum or throw if invalid bytes */
function safeAddress(raw: string): string {
  const s = (raw || "").trim();
  if (!s) throw new Error("empty address");
  // tolerate 40-hex without 0x
  const hex = s.startsWith("0x") ? s : `0x${s}`;
  // lower first to avoid bogus mixed-case checksum errors
  return ethers.getAddress(hex.toLowerCase());
}

/** env -> checksum(addr) with a sane fallback */
function addrOr(fallback: string, ...keys: string[]): string {
  const val = pickEnv(...keys) || fallback;
  return safeAddress(val);
}

/** ---------- factories (normalized) ---------- */
const UNI_V3_FACTORY = addrOr(
  "0x1f98431c8ad98523631ae4a59f267346ea31f984", // lowercase then checksummed
  "UNI_FACTORY"
);

const SUSHI_FACTORY = addrOr(
  "0xc35dadb65012ec5796536bd9864ed8773abc74c4", // Sushi V2 factory on Arbitrum
  "SUSHI_FACTORY"
);

const CAMELOT_FACTORY = addrOr(
  "0x6eccab422d763ac031210895c81787e87b91678b", // Camelot factory; normalize case safely
  "CAMELOT_FACTORY"
);

/** ---------- ABIs ---------- */
const UniV3FactoryAbi = [
  "function getPool(address tokenA, address tokenB, uint24 fee) view returns (address)"
] as const;

const V2FactoryAbi = [
  "function getPair(address tokenA, address tokenB) view returns (address)"
] as const;

/** ---------- token pull (from env) ---------- */
function req(name: string): string {
  const v = (process.env[name] || "").trim();
  if (!v) throw new Error(`Missing env ${name}`);
  return safeAddress(v);
}

export type V3Spec = { a: string; b: string; fee: number };
export type V2Spec = { a: string; b: string; dex: "sushi" | "camelot" };

export function candidateV3Specs(): V3Spec[] {
  const ARB  = req("TOKEN_ARB");
  const WETH = req("TOKEN_WETH");
  const USDC = req("TOKEN_USDC");
  const USDT = req("TOKEN_USDT");
  const WBTC = req("TOKEN_WBTC");
  const LINK = req("TOKEN_LINK");
  const DAI  = req("TOKEN_DAI");
  const FRAX = req("TOKEN_FRAX");

  const stables100 = [100, 500];
  const volatile   = [500, 3000];

  const out: V3Spec[] = [];

  for (const fee of volatile) {
    out.push({ a: ARB,  b: WETH, fee });
    out.push({ a: ARB,  b: USDC, fee });
    out.push({ a: WETH, b: USDC, fee });
    out.push({ a: WETH, b: USDT, fee });
    out.push({ a: WBTC, b: WETH, fee: 3000 });
    out.push({ a: LINK, b: WETH, fee: 3000 });
  }

  for (const fee of stables100) {
    out.push({ a: USDC, b: USDT, fee });
    out.push({ a: DAI,  b: USDC, fee });
    out.push({ a: FRAX, b: USDC, fee });
  }

  // unique by unordered pair + fee
  const key = (s: V3Spec) => [s.a.toLowerCase(), s.b.toLowerCase()].sort().join("-") + `:${s.fee}`;
  const uniq = new Map<string, V3Spec>();
  for (const s of out) uniq.set(key(s), s);
  return Array.from(uniq.values());
}

export function candidateV2Specs(): V2Spec[] {
  const ARB  = req("TOKEN_ARB");
  const WETH = req("TOKEN_WETH");
  const USDC = req("TOKEN_USDC");
  const USDT = req("TOKEN_USDT");
  const WBTC = req("TOKEN_WBTC");
  const LINK = req("TOKEN_LINK");

  const base: [string, string][] = [
    [ARB, WETH], [ARB, USDC], [ARB, USDT],
    [WETH, USDC], [WETH, USDT],
    [WBTC, WETH], [LINK, WETH],
  ];

  const v2: V2Spec[] = [];
  for (const [a,b] of base) {
    v2.push({ a, b, dex: "sushi" });
    v2.push({ a, b, dex: "camelot" });
  }
  return v2;
}

export type ResolvedPools = {
  v3: { spec: V3Spec; pool: string }[];
  v2: { spec: V2Spec; pair: string }[];
};

export async function resolvePools(): Promise<ResolvedPools> {
  const provider = await getCUProvider();
  const v3Factory = new ethers.Contract(UNI_V3_FACTORY, UniV3FactoryAbi, provider);
  const v2S = new ethers.Contract(SUSHI_FACTORY, V2FactoryAbi, provider);
  const v2C = new ethers.Contract(CAMELOT_FACTORY, V2FactoryAbi, provider);

  const v3Specs = candidateV3Specs();
  const v2Specs = candidateV2Specs();

  const v3: { spec: V3Spec; pool: string }[] = [];
  for (const s of v3Specs) {
    try {
      const [a, b] = [s.a.toLowerCase(), s.b.toLowerCase()].sort();
      const pool = await v3Factory.getPool(a, b, s.fee);
      if (pool && pool !== ethers.ZeroAddress) v3.push({ spec: s, pool: ethers.getAddress(pool) });
    } catch (e) {
      // ignore factory errors for this spec
    }
  }

  const v2: { spec: V2Spec; pair: string }[] = [];
  for (const s of v2Specs) {
    try {
      const [a, b] = [s.a.toLowerCase(), s.b.toLowerCase()].sort();
      const pair = await (s.dex === "sushi" ? v2S : v2C).getPair(a, b);
      if (pair && pair !== ethers.ZeroAddress) v2.push({ spec: s, pair: ethers.getAddress(pair) });
    } catch (e) {
      // ignore getPair failures
    }
  }

  console.log(`[POOLS] Resolved: UniV3=${v3.length} pools, V2=${v2.length} pairs.`);
  return { v3, v2 };
}
