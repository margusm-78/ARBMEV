import "dotenv/config";
import { ethers } from "ethers";

/* ---------- helpers ---------- */

function envPick(...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = (process.env[k] || "").trim();
    if (v) return v;
  }
  return undefined;
}
function bool(name: string, def = false): boolean {
  const v = (process.env[name] || "").trim().toLowerCase();
  if (!v) return def;
  return ["1", "true", "yes", "y", "on"].includes(v);
}
function toWei(strOrNum: string | number | undefined, def = "0.00002"): bigint {
  const n = strOrNum === undefined ? Number(def) : Number(strOrNum);
  if (!Number.isFinite(n) || n < 0) return BigInt(Math.round(Number(def) * 1e18));
  return BigInt(Math.round(n * 1e18));
}
function addrOr(defaultAddr: string, ...keys: string[]): string {
  const v = envPick(...keys);
  const out = (v || defaultAddr).trim();
  if (!ethers.isAddress(out)) throw new Error(`Invalid address (${keys.join("|")}): ${out}`);
  return ethers.getAddress(out);
}

/* ---------- token defaults (Arbitrum One) ---------- */
const DFT = {
  ARB:  "0x912CE59144191C1204E64559FE8253a0e49E6548",
  WETH: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
  USDC: "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8",
  USDT: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
  WBTC: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f",
  LINK: "0xf97f4df75117a78c1A5a0DBb814Af92458539FB4",
  DAI:  "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1",
  FRAX: "0x17FC002b466eEc40DaE837Fc4bE5c67993ddBd6F",
};

/* ---------- tokens (accept TOKEN_* or legacy names; fallback to defaults) ---------- */
const TOKENS = {
  ARB:  addrOr(DFT.ARB,  "TOKEN_ARB",  "ARB"),
  WETH: addrOr(DFT.WETH, "TOKEN_WETH", "WETH"),
  USDC: addrOr(DFT.USDC, "TOKEN_USDC", "USDC"),
  USDT: addrOr(DFT.USDT, "TOKEN_USDT", "USDT"),
  WBTC: addrOr(DFT.WBTC, "TOKEN_WBTC", "WBTC"),
  LINK: addrOr(DFT.LINK, "TOKEN_LINK", "LINK"),
  DAI:  addrOr(DFT.DAI,  "TOKEN_DAI",  "DAI"),
  FRAX: addrOr(DFT.FRAX, "TOKEN_FRAX", "FRAX"),
} as const;

/* ---------- uniswap infra (new env names) ---------- */
const UNI = {
  factory: addrOr("0x1F98431c8aD98523631AE4a59f267346ea31F984", "UNI_FACTORY"),
  quoter:  addrOr("0x61fFE014bA17989E743c5F6cB21bF9697530B21e", "UNISWAP_V3_QUOTER_V2", "UNI_QUOTER"),
  priceFee: Number(process.env.UNI_PRICE_FEE ?? "500"), // hint for pricing (default 0.05%)
  // Keep your old “strategy-style” pool hints (no addresses here; resolver will fill):
  pools: [
    { name: "ARB/WETH@500",   token0: "ARB",  token1: "WETH", fee: Number(process.env.FEE_TIER_3 ?? "500") },
    { name: "ARB/WETH@3000",  token0: "ARB",  token1: "WETH", fee: Number(process.env.FEE_TIER_1 ?? "3000") },
    { name: "WETH/USDC@500",  token0: "WETH", token1: "USDC", fee: 500 },
    { name: "WETH/USDC@3000", token0: "WETH", token1: "USDC", fee: 3000 },
    { name: "USDC/USDT@100",  token0: "USDC", token1: "USDT", fee: 100 },
    { name: "DAI/USDC@100",   token0: "DAI",  token1: "USDC", fee: 100 },
  ],
} as const;

/* ---------- routers (current env names + defaults) ---------- */
export const ROUTERS = {
  univ3:       addrOr("0xE592427A0AEce92De3Edee1F18E0157C05861564", "UNISWAP_V3_ROUTER"),
  // swapRouter02 compatibility (some code imports this)
  swapRouter02: addrOr("0xE592427A0AEce92De3Edee1F18E0157C05861564", "UNISWAP_V3_ROUTER"),
  sushi:       addrOr("0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506", "SUSHI_ROUTER"),
  camelot:     addrOr("0xc873fEcbd354f5A56E00E710B90EF4201db2448d", "CAMELOT_ROUTER"),
  oneInch:     addrOr("0x1111111254EEB25477B68fb85Ed929f73A960582", "ONEINCH_ROUTER"),
  paraswap:    addrOr("0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57", "PARASWAP_ROUTER"),
} as const;

/* ---------- runtime ---------- */
export const CONFIG = {
  chainId: Number(process.env.CHAIN_ID || 42161),

  // single URL for legacy callers (resilientProvider handles priority elsewhere)
  rpcUrl:
    envPick("ARB_RPC_URL") ||
    envPick("ALCH_ARB_HTTP", "ARB_RPC_URL_PRIMARY") ||
    envPick("QUICKNODE_ARB_HTTP", "QNODE_ARB_HTTP", "ARB_RPC_URL_BACKUP_2") ||
    envPick("INFURA_ARB_HTTP", "ARB_RPC_URL_BACKUP_1") ||
    "",

  // searcher/executor router (your ArbiSearcherRouter or similar)
  router: addrOr("0xc8089738a3F2957Cf764a04CED711E83579D8971", "ROUTER_ADDRESS"),

  uni: {
    ...UNI,
    minProfitARBWei:  toWei(process.env.MIN_PROFIT_ARB),          // optional: gate in ARB
    minProfitWETHWei: toWei(process.env.MIN_PROFIT_WETH ?? "0.00002"),
  },

  tokens: TOKENS,
  profitToken: TOKENS.WETH,

  // safety & switches
  dryRun: bool("DRY_RUN", false),

  // if you use bidding / timeboost externally
  timeboost: {
    defaultBidWei: BigInt(process.env.DEFAULT_BID_WEI ?? "0"),
  },

  // CU / throttling knobs (read by cuWrappedProvider/cuBudget)
  cu: {
    dailyLimit: Number(process.env.DAILY_CU_LIMIT || 1_000_000),
    monthlyLimit: Number(process.env.MONTHLY_CU_LIMIT || 30_000_000),
    alertPct: Number(process.env.CU_ALERT_THRESHOLD || 80),
    emergencyPct: Number(process.env.CU_EMERGENCY_THRESHOLD || 95),
    maxConcurrentOps: Number(process.env.MAX_CONCURRENT_OPERATIONS || 5),
    caching: {
      enable: bool("ENABLE_AGGRESSIVE_CACHING", true),
      callTtlMs: Number(process.env.CACHE_TTL_SECONDS || 15) * 1000,
      balTtlMs:  Number(process.env.BALANCE_CACHE_TTL_SECONDS || 30) * 1000,
      txTtlMs:   Number(process.env.TX_CACHE_TTL_SECONDS || 5) * 1000,
    },
  },

  // expose ws/http endpoints for modules that want to display them
  rpc: {
    httpPrimary: envPick("ALCH_ARB_HTTP", "ARB_RPC_URL_PRIMARY", "ARB_RPC_URL") || "",
    httpQnode:   envPick("QUICKNODE_ARB_HTTP", "QNODE_ARB_HTTP", "ARB_RPC_URL_BACKUP_2"),
    httpInfura:  envPick("INFURA_ARB_HTTP", "ARB_RPC_URL_BACKUP_1"),
    wssPrimary:  envPick("ALCH_ARB_WSS", "ARB_WS_URL_PRIMARY"),
    wssQnode:    envPick("QUICKNODE_ARB_WSS", "QNODE_ARB_WSS", "ARB_WS_URL_BACKUP_1"),
  },
} as const;

/* ---------- strategy feature flags (optional read from env) ---------- */
export type BackrunConfig = { enableArb?: boolean };
export const BackrunConfig: BackrunConfig = { enableArb: false };
