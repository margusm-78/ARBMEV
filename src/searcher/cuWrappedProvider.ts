// src/searcher/cuWrappedProvider.ts
import "dotenv/config";
import { ethers } from "ethers";
import { RP } from "./resilientProvider";
import { TTLCache } from "./cache";
import { Priority, PriorityQueue } from "./priorityQueue";
import { chargeCU, CU_WEIGHTS } from "./cuBudget";
import { CONFIG } from "./config";

const enableAggressive = String(process.env.ENABLE_AGGRESSIVE_CACHING || "true").toLowerCase() === "true";
const baseTtl = Number(process.env.CACHE_TTL_SECONDS || 15) * 1000;
const balTtl  = Number(process.env.BALANCE_CACHE_TTL_SECONDS || 30) * 1000;
const txTtl   = Number(process.env.TX_CACHE_TTL_SECONDS || 5) * 1000;
const maxConc = Number(process.env.MAX_CONCURRENT_OPERATIONS || 5);

const queue = new PriorityQueue(maxConc);

// Caches
const cacheCall = new TTLCache<string, any>(baseTtl);
const cacheBal  = new TTLCache<string, any>(balTtl);
const cacheTx   = new TTLCache<string, any>(txTtl);

function cacheKey(method: string, params: any[]) {
  return `${method}:${JSON.stringify(params)}`;
}

const WRAPPED     = Symbol("cuWrapped");
const ORIG_SEND   = Symbol("origSend");
const ALT_HTTP    = Symbol("altHttpProvider");

function isAlchemyUrl(u?: string) {
  if (!u) return false;
  const s = u.toLowerCase();
  return s.includes("alchemy.com");
}

function firstNonAlchemyUrl(): string | null {
  // Prefer explicit lists if present
  const gather = (raw?: string) =>
    (raw || "")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);

  const fromLists = [
    ...gather(process.env.FETCH_HTTP_URLS),
    ...gather(process.env.ARB_RPC_URLS),
  ];

  const fromConfig = [
    CONFIG.rpc?.httpQnode,
    CONFIG.rpc?.httpInfura,
    process.env.ARB_RPC_URL_BACKUP_2,
    process.env.BWARE_ARB_HTTP,
    process.env.ARB_RPC_URL_BACKUP_1,
  ].filter(Boolean) as string[];

  const candidates = [
    ...fromLists,
    ...fromConfig,
  ].filter(Boolean);

  for (const u of candidates) {
    if (!isAlchemyUrl(u)) return u;
  }
  return null;
}

/**
 * Return the resilient provider with CU accounting, caching and
 * concurrency throttling applied by monkey-patching `.send`.
 *
 * IMPORTANT:
 *  - We DO NOT proxy the provider (ethers v6 brand checks would fail).
 *  - We patch the instance’s `send` and route READS to a non-Alchemy HTTP.
 */
export async function getCUProvider(): Promise<ethers.JsonRpcProvider> {
  await RP.ensureReady();
  const p = RP.provider as unknown as any;

  if (!p[WRAPPED]) {
    // Bind original send
    const originalSend: (method: string, params: any[]) => Promise<any> = p.send.bind(p);
    p[ORIG_SEND] = originalSend;

    // Prepare alternate HTTP provider for READS
    if (!p[ALT_HTTP]) {
      const offloadUrl = firstNonAlchemyUrl();
      if (offloadUrl) {
        p[ALT_HTTP] = new ethers.JsonRpcProvider(offloadUrl, { chainId: Number(CONFIG.chainId || 42161), name: "arbitrum" });
        console.log(`[CU] HTTP offload -> ${new URL(offloadUrl).hostname}`);
      } else {
        p[ALT_HTTP] = null;
        console.log("[CU] HTTP offload not configured (no non-Alchemy HTTP found).");
      }
    }
    const alt: ethers.JsonRpcProvider | null = p[ALT_HTTP];

    // Methods we want to offload to HTTP (no WS needed)
    const READISH = new Set([
      "eth_call",
      "eth_estimateGas",
      "eth_getBlockByNumber",
      "eth_getTransactionByHash",
      "eth_getBalance",
      "eth_getCode",
      "eth_getLogs",
      "eth_blockNumber",
      "eth_chainId",
      "eth_getTransactionReceipt",
      "eth_getStorageAt",
    ]);

    p.send = async function(method: string, params: any[]) {
      const priority =
        method === "eth_call"        ? Priority.HIGH   :
        method === "eth_getLogs"     ? Priority.HIGH   :
        method === "eth_blockNumber" ? Priority.LOW    :
        Priority.MEDIUM;

      const targetSend = (alt && READISH.has(method)) ? alt.send.bind(alt) : originalSend;

      // Caching fast paths
      if (enableAggressive) {
        if (method === "eth_getBalance") {
          const key = cacheKey(method, params);
          const hit = cacheBal.get(key);
          if (hit !== undefined) return hit;
          const out = await queue.add(priority, async () => {
            chargeCU(CU_WEIGHTS[method] ?? 2, priority);
            return targetSend(method, params);
          });
          cacheBal.set(key, out);
          return out;
        }
        if (method === "eth_getTransactionByHash") {
          const key = cacheKey(method, params);
          const hit = cacheTx.get(key);
          if (hit !== undefined) return hit;
          const out = await queue.add(priority, async () => {
            chargeCU(CU_WEIGHTS[method] ?? 2, priority);
            return targetSend(method, params);
          });
          cacheTx.set(key, out);
          return out;
        }
        if (method === "eth_call") {
          const key = cacheKey(method, params);
          const hit = cacheCall.get(key);
          if (hit !== undefined) return hit;
          const out = await queue.add(priority, async () => {
            chargeCU(CU_WEIGHTS[method] ?? 25, priority);
            return targetSend(method, params);
          });
          cacheCall.set(key, out);
          return out;
        }
      }

      // Default path
      return queue.add(priority, async () => {
        chargeCU(CU_WEIGHTS[method] ?? 5, priority);
        return targetSend(method, params);
      });
    };

    p[WRAPPED] = true;
    console.log("[CU] Provider wrapped: caching + throttling enabled");
  }

  return p as ethers.JsonRpcProvider;
}
