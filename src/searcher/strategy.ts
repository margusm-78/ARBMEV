// src/searcher/strategy.ts
import "dotenv/config";
import { ethers } from "ethers";
import { CONFIG, ROUTERS } from "./config";
import { resolvePools } from "./pools";
import { quoteExactInputBestAmongFees } from "./price";
import { v2Quote } from "./v2";
import { getCUStatus } from "./cuBudget";
import { getCUProvider } from "./cuWrappedProvider";

type DexId = "UniV3" | "Sushi" | "Camelot";
type Pair = { a: string; b: string; symA: string; symB: string };

const DECIMALS: Record<string, number> = {
  ARB: 18, WETH: 18, WBTC: 8, LINK: 18, USDC: 6, USDT: 6, DAI: 18, FRAX: 18,
};

function format(amount: bigint, sym: string) {
  return ethers.formatUnits(amount, DECIMALS[sym] ?? 18);
}
function parseAmount(sym: string, s: string) {
  return ethers.parseUnits(s, DECIMALS[sym] ?? 18);
}

/** optional helpers for multiple USDC flavors (native + e) */
function pickAddr(name: string): string | undefined {
  const v = (process.env[name] || "").trim();
  return v ? ethers.getAddress(v) : undefined;
}
function dedupAddrs(arr: (string | undefined)[]) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const a of arr) {
    if (!a) continue;
    const k = a.toLowerCase();
    if (!seen.has(k)) { seen.add(k); out.push(a); }
  }
  return out;
}
const STABLE = new Set(["USDC","USDT","DAI","FRAX"]);

/** ---- thresholds (env-tunable) ---- */
const MIN_WETH_RESERVE  = Number(process.env.MIN_WETH_RESERVE  ?? "3");      // WETH units
const MIN_STABLE_RES    = Number(process.env.MIN_STABLE_RESERVE ?? "5000");  // stable units
const MIN_WBTC_RESERVE  = Number(process.env.MIN_WBTC_RESERVE  ?? "0.5");    // WBTC units
const MIN_TOKEN_RESERVE = Number(process.env.MIN_TOKEN_RESERVE ?? "1000");   // generic units

function pairsUniverse(): Pair[] {
  const t = CONFIG.tokens as any;
  if (!t?.ARB || !t?.WETH || !t?.USDC || !t?.USDT || !t?.WBTC || !t?.LINK || !t?.DAI || !t?.FRAX) {
    throw new Error("CONFIG.tokens missing one or more required token addresses");
  }

  const USDC_NATIVE = pickAddr("TOKEN_USDC_NATIVE"); // optional (0xaf88…)
  const USDC_ALT    = pickAddr("TOKEN_USDC_ALT");    // optional
  const usdcList = dedupAddrs([t.USDC, USDC_NATIVE, USDC_ALT]);

  const L: Pair[] = [
    { a: t.ARB,  b: t.WETH, symA: "ARB",  symB: "WETH" },
    { a: t.ARB,  b: t.USDC, symA: "ARB",  symB: "USDC" },
    { a: t.ARB,  b: t.USDT, symA: "ARB",  symB: "USDT" },
    { a: t.WETH, b: t.USDC, symA: "WETH", symB: "USDC" },
    { a: t.WETH, b: t.USDT, symA: "WETH", symB: "USDT" },
    { a: t.WBTC, b: t.WETH, symA: "WBTC", symB: "WETH" },
    { a: t.LINK, b: t.WETH, symA: "LINK", symB: "WETH" },
  ];

  for (const usdc of usdcList) {
    L.push({ a: t.DAI,  b: usdc,    symA: "DAI",  symB: "USDC" });
    L.push({ a: t.FRAX, b: usdc,    symA: "FRAX", symB: "USDC" });
    L.push({ a: usdc,   b: t.USDT,  symA: "USDC", symB: "USDT" });
  }

  // Dedup (directional)
  const seen = new Set<string>();
  const out: Pair[] = [];
  for (const p of L) {
    const k = `${p.a.toLowerCase()}-${p.b.toLowerCase()}`;
    if (!seen.has(k)) { seen.add(k); out.push(p); }
  }
  return out;
}

function baseInFor(sym: string): bigint {
  if (sym === "ARB")  return parseAmount(sym, (process.env.PROBE_NOTIONAL_A || "0.02"));
  if (sym === "WETH") return parseAmount(sym, (process.env.WETH_BASE_AMOUNT || "0.0005"));
  if (sym === "USDC") return parseAmount(sym, (process.env.USDC_BASE_AMOUNT || "0.5"));
  if (sym === "USDT") return parseAmount(sym, (process.env.USDT_BASE_AMOUNT || "0.5"));
  if (sym === "WBTC") return parseAmount(sym, "0.002");
  if (sym === "LINK") return parseAmount(sym, "0.5");
  if (sym === "DAI")  return parseAmount(sym, "1");
  if (sym === "FRAX") return parseAmount(sym, "1");
  return parseAmount(sym, "0.01");
}

type QuoteRes = { dex: DexId; amountOut: bigint; feeUsed?: number };

/** -------- per-block quote cache (cut calls) -------- */
const _blockQuoteCache = new Map<string, bigint>();
function quoteCacheKey(block: number, dex: string, a: string, b: string, inAmt: bigint, extra: string) {
  return `${block}:${dex}:${a}:${b}:${inAmt.toString()}:${extra}`;
}

/** -------- reserves gate for V2 pairs (cached 5m) -------- */
const V2PairAbi = [
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)"
] as const;

type PoolsData = Awaited<ReturnType<typeof resolvePools>>;
const _reservesCache = new Map<string, { ts: number; ok: boolean }>();

// Build address->symbol map from CONFIG.tokens (known set)
const ADDR2SYM: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  const t = CONFIG.tokens as any;
  for (const k of Object.keys(t)) {
    const addr = String(t[k]).toLowerCase();
    m[addr] = k;
  }
  return m;
})();

function thresholdForSymbol(sym: string): { present: boolean; minUnits: bigint } {
  const dec = DECIMALS[sym] ?? 18;
  if (sym === "WETH") return { present: true, minUnits: ethers.parseUnits(String(MIN_WETH_RESERVE), dec) };
  if (sym === "USDC" || sym === "USDT" || sym === "DAI" || sym === "FRAX") {
    return { present: true, minUnits: ethers.parseUnits(String(MIN_STABLE_RES), dec) };
  }
  if (sym === "WBTC") return { present: true, minUnits: ethers.parseUnits(String(MIN_WBTC_RESERVE), dec) };
  // generic
  return { present: true, minUnits: ethers.parseUnits(String(MIN_TOKEN_RESERVE), dec) };
}

function sortedKey(a: string, b: string) {
  const [x, y] = [a.toLowerCase(), b.toLowerCase()].sort();
  return `${x}-${y}`;
}

function findV2PairAddr(pools: PoolsData, a: string, b: string, dex: "sushi" | "camelot"): string | null {
  const [x, y] = [a.toLowerCase(), b.toLowerCase()].sort();
  for (const r of pools.v2) {
    const [rx, ry] = [r.spec.a.toLowerCase(), r.spec.b.toLowerCase()].sort();
    if (rx === x && ry === y && r.spec.dex === dex) return r.pair;
  }
  return null;
}

async function v2HasSufficientReserves(
  provider: ethers.Provider,
  pools: PoolsData,
  a: string,
  b: string,
  dex: "sushi" | "camelot"
): Promise<boolean> {
  const pair = findV2PairAddr(pools, a, b, dex);
  if (!pair || pair === ethers.ZeroAddress) return false;

  const cacheKey = `rv:${pair.toLowerCase()}`;
  const hit = _reservesCache.get(cacheKey);
  const now = Date.now();
  if (hit && (now - hit.ts) < 5 * 60 * 1000) return hit.ok;

  let ok = false;
  try {
    const c = new ethers.Contract(pair, V2PairAbi, provider);
    const [r0, r1] = await c.getReserves() as [bigint, bigint, number];

    // Map reserves to tokens (token0 < token1 by address)
    const [x, y] = [a.toLowerCase(), b.toLowerCase()].sort();
    const sym0 = ADDR2SYM[x] || "GEN";
    const sym1 = ADDR2SYM[y] || "GEN";

    const th0 = thresholdForSymbol(sym0).minUnits;
    const th1 = thresholdForSymbol(sym1).minUnits;

    ok = (r0 >= th0) && (r1 >= th1);
  } catch {
    ok = false;
  }

  _reservesCache.set(cacheKey, { ts: now, ok });
  return ok;
}

/** ---------- UniV3 staged quoting ---------- */
async function quoteUniV3Staged(pair: Pair, amountIn: bigint, block: number): Promise<QuoteRes | null> {
  // quick fee: 100 bps for stables, 500 bps for others
  const isStable = STABLE.has(pair.symA) && STABLE.has(pair.symB);
  const quickFee = isStable ? 100 : 500;

  const ckQuick = quoteCacheKey(block, "UniV3", pair.a, pair.b, amountIn, `q${quickFee}`);
  const cachedQuick = _blockQuoteCache.get(ckQuick);
  let quickOut: bigint | null = null;
  if (cachedQuick !== undefined) {
    quickOut = cachedQuick;
  } else {
    try {
      const q = await quoteExactInputBestAmongFees(pair.a, pair.b, amountIn, [quickFee]);
      quickOut = q.amountOut;
      _blockQuoteCache.set(ckQuick, quickOut);
    } catch { quickOut = null; }
  }
  if (quickOut == null) return null;
  return { dex: "UniV3", amountOut: quickOut, feeUsed: quickFee };
}

async function sweepUniV3Fees(pair: Pair, amountIn: bigint, block: number): Promise<QuoteRes | null> {
  const isStable = STABLE.has(pair.symA) && STABLE.has(pair.symB);
  const fees = isStable ? [100, 500] : [500, 3000, 10000];

  const ck = quoteCacheKey(block, "UniV3", pair.a, pair.b, amountIn, `sweep:${fees.join(",")}`);
  const cached = _blockQuoteCache.get(ck);
  if (cached !== undefined) return { dex: "UniV3", amountOut: cached };

  try {
    const q = await quoteExactInputBestAmongFees(pair.a, pair.b, amountIn, fees);
    _blockQuoteCache.set(ck, q.amountOut);
    return { dex: "UniV3", amountOut: q.amountOut, feeUsed: q.feeUsed };
  } catch { return null; }
}

async function quoteAllDexesStaged(pair: Pair, block: number, pools: PoolsData): Promise<QuoteRes[]> {
  const amountIn = baseInFor(pair.symA);
  const out: QuoteRes[] = [];

  // Stage 1: quick UniV3
  const uniQuick = await quoteUniV3Staged(pair, amountIn, block);
  if (uniQuick) out.push(uniQuick);

  // V2 quotes guarded by reserves
  const provider = await getCUProvider();

  // Sushi
  try {
    const ok = await v2HasSufficientReserves(provider, pools, pair.a, pair.b, "sushi");
    if (ok) {
      const a = await v2Quote(ROUTERS.sushi, amountIn, [pair.a, pair.b]);
      out.push({ dex: "Sushi", amountOut: a });
    }
  } catch {}

  // Camelot
  try {
    const ok = await v2HasSufficientReserves(provider, pools, pair.a, pair.b, "camelot");
    if (ok) {
      const a = await v2Quote(ROUTERS.camelot, amountIn, [pair.a, pair.b]);
      out.push({ dex: "Camelot", amountOut: a });
    }
  } catch {}

  // Decide if we need UniV3 sweep:
  const sorted = [...out].sort((x, y) => (y.amountOut > x.amountOut ? 1 : -1));
  const best = sorted[0];
  const second = sorted[1];
  const needSweep =
    !best || !second ||
    best.dex !== "UniV3" ||
    (Number(best.amountOut - second.amountOut) / Number(second.amountOut || 1n) * 100) < 0.3;

  if (needSweep) {
    const uniSweep = await sweepUniV3Fees(pair, amountIn, block);
    if (uniSweep) {
      const i = out.findIndex(x => x.dex === "UniV3");
      if (i >= 0) {
        if (uniSweep.amountOut > out[i].amountOut) out[i] = uniSweep;
      } else {
        out.push(uniSweep);
      }
    }
  }

  return out;
}

function best2(quotes: QuoteRes[]) {
  const s = [...quotes].sort((x, y) => (y.amountOut > x.amountOut ? 1 : -1));
  return { best: s[0], second: s[1] };
}

/** cache pool resolution for 10 minutes to save CU */
let _poolsCache: { ts: number; data: Awaited<ReturnType<typeof resolvePools>> } | null = null;
async function resolvePoolsCached() {
  const now = Date.now();
  if (_poolsCache && now - _poolsCache.ts < 10 * 60 * 1000) return _poolsCache.data;
  const data = await resolvePools();
  _poolsCache = { ts: now, data };
  return data;
}

/** rotate pairs per loop to cut CU */
let _rot = 0;
export async function runStrategyScanOnce(): Promise<void> {
  const provider = await getCUProvider();
  const head = await provider.getBlockNumber();
  console.log(`[STRAT] head=${head}`);

  const pools = await resolvePoolsCached();
  console.log(`[STRAT] Resolved pools: UniV3=${pools.v3.length}, V2=${pools.v2.length}`);

  let all: Pair[];
  try {
    all = pairsUniverse();
  } catch (e: any) {
    console.log(`[STRAT] warn: ${e?.message || e}`);
    return;
  }

  const maxPerLoop = Math.max(1, Number(process.env.MAX_PAIRS_PER_LOOP || 3));
  const start = (_rot * maxPerLoop) % all.length;
  const batch = all.slice(start, start + maxPerLoop);
  _rot++;

  // Clear per-block quote cache when block changes
  _blockQuoteCache.clear();

  for (const p of batch) {
    const quotes = await quoteAllDexesStaged(p, head, pools);
    if (quotes.length < 2) continue;

    const { best, second } = best2(quotes);
    if (!best || !second || second.amountOut === 0n) continue;

    const pct = Number(best.amountOut - second.amountOut) / Number(second.amountOut) * 100;

    if (pct > 0.15) {
      console.log(
        `[EDGE] ${p.symA}->${p.symB} best=${best.dex}${best.feeUsed ? `@${best.feeUsed}`:""} ${format(best.amountOut, p.symB)} > ` +
        `second=${second.dex} ${format(second.amountOut, p.symB)} (+${pct.toFixed(3)}%)`
      );
    }
  }

  const s = getCUStatus();
  console.log(`[CU] daily ${s.daily}/${s.dailyLimit} (${s.dailyPct}%)`);
}

export async function runStrategyLoop(): Promise<void> {
  const intervalMs = Number(process.env.SCAN_INTERVAL_MS || 5000); // default slower (CU friendly)
  console.log(`[STRAT] loop every ${intervalMs}ms — CTRL+C to stop`);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try { await runStrategyScanOnce(); }
    catch (e: any) { console.log(`[STRAT] warn: ${e?.message || e}`); }
    await new Promise(r => setTimeout(r, intervalMs));
  }
}
