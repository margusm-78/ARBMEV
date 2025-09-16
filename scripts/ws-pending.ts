import "dotenv/config";
import { ethers } from "ethers";
import WebSocket from "ws";

/**
 * Robust Arbitrum pending-tx watcher.
 * - Start with native 'newPendingTransactions' (provider dependent).
 * - If silent, switch to Alchemy 'alchemy_pendingTransactions' (toAddress filtered).
 * - If still silent, try native again on QuickNode WSS (if present).
 *
 * Set DEBUG_WS=1 in .env to log raw WS frames from Alchemy.
 * This script NEVER broadcasts; it's safe for DRY_RUN or live.
 */

const DEBUG = /^(1|true|yes|on)$/i.test((process.env.DEBUG_WS || "").trim());

// Routers/aggregators we care about
const WATCHED_ROUTERS = [
  // Uniswap V3
  (process.env.UNISWAP_V3_ROUTER || "0xE592427A0AEce92De3Edee1F18E0157C05861564"),
  // Sushi V2
  (process.env.SUSHI_ROUTER      || "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506"),
  // Camelot V2
  (process.env.CAMELOT_ROUTER    || "0xc873fEcbd354f5A56E00E710B90EF4201db2448d"),
  // 1inch + Paraswap
  (process.env.ONEINCH_ROUTER    || "0x1111111254EEB25477B68fb85Ed929f73A960582"),
  (process.env.PARASWAP_ROUTER   || "0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57"),
].map(a => a.toLowerCase());

// Common router method sighashes
const SIGS = new Set<string>([
  "0x04e45aaf", // exactInputSingle (UniV3)
  "0x5023b4df", // exactInput (UniV3)
  "0x38ed1739", // swapExactTokensForTokens (V2)
  "0x5ae401dc", // multicall
]);

// WSS pickers by provider type
function envWss(name: string) { return (process.env[name] || "").trim(); }
function haveAlchemy() { return !!envWss("ALCH_ARB_WSS"); }
function haveQuickNode() { return !!(envWss("QUICKNODE_ARB_WSS") || envWss("QNODE_ARB_WSS")); }

function pickNativeWss(): string | null {
  // Prefer Alchemy → QuickNode → Llama → Infura for native (eth_subscribe)
  const order = ["ALCH_ARB_WSS", "QUICKNODE_ARB_WSS", "QNODE_ARB_WSS", "LLAMA_ARB_WSS", "INFURA_ARB_WSS"];
  for (const k of order) {
    const v = envWss(k);
    if (v) return v;
  }
  return null;
}
function pickQuickNodeWss(): string | null {
  return envWss("QUICKNODE_ARB_WSS") || envWss("QNODE_ARB_WSS") || null;
}

// Helpers
const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));
function formatEth(v?: bigint) { try { return ethers.formatEther(v || 0n); } catch { return "0"; } }
function lower(s?: string | null) { return (s || "").toLowerCase(); }

type CloseFn = () => void;

// ---------- Native pending (eth_subscribe:newPendingTransactions) ----------
async function startNativePending(tag: string, wssUrl: string, onHit: (txHash: string) => void, onHead?: (bn: number) => void): Promise<CloseFn> {
  const provider = new ethers.WebSocketProvider(wssUrl, 42161);
  let closed = false;

  const pendingHandler = (hash: string) => { onHit(hash); };
  provider.on("pending", pendingHandler);

  let headCount = 0;
  const headHandler = (bn: number) => {
    headCount++;
    // print every head (or throttle if needed)
    console.log(`[WS ${tag}] head=${bn}`);
    onHead?.(bn);
  };
  provider.on("block", headHandler);

  const close = () => {
    if (closed) return;
    closed = true;
    try { provider.off("pending", pendingHandler); } catch {}
    try { provider.off("block", headHandler); } catch {}
    try { provider.destroy(); } catch {}
  };
  return close;
}

// ---------- Alchemy filtered pending (alchemy_pendingTransactions) ----------
function startAlchemyFiltered(
  alchUrl: string,
  toAddresses: string[],
  onHit: (hashOrObj: any) => void
): CloseFn {
  const ws = new WebSocket(alchUrl, { perMessageDeflate: false });
  let closed = false;
  let subId: string | null = null;
  let id = 0; const nextId = () => ++id;

  ws.on("open", () => {
    const payload = {
      jsonrpc: "2.0",
      id: nextId(),
      method: "alchemy_subscribe",
      // Try full objects (hashesOnly:false) → if provider ignores, we still handle string hashes.
      params: ["alchemy_pendingTransactions", { toAddress: toAddresses, hashesOnly: false }]
    };
    ws.send(JSON.stringify(payload));
    console.log("Alchemy subscription sent (filtered to routers).");
  });

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(String(data));
      if (DEBUG) console.log("[Alchemy RAW]", msg);

      // Sub confirmed
      if (msg?.result && typeof msg.result === "string" && !subId) {
        subId = msg.result;
        console.log(`Alchemy sub id = ${subId}`);
      }

      // Notifications
      if (msg?.method === "alchemy_subscription" && msg?.params?.subscription === subId) {
        const res = msg?.params?.result;
        // Could be a string (hash) or an object with hash/to/input/… depending on plan
        onHit(res);
      }
    } catch {
      // ignore malformed frames
    }
  });

  ws.on("error", (e) => console.error("Alchemy WS error:", e?.toString?.() || e));
  ws.on("close", (c, r) => console.log(`Alchemy WS closed ${c} ${r}`));

  const close = () => {
    if (closed) return;
    closed = true;
    try { ws.close(); } catch {}
  };
  return close;
}

// ---------- Main ----------
(async function main() {
  console.log("Connected to WS. Listening for pending tx to known routers… (DRY_RUN=%s)", process.env.DRY_RUN ? "on" : "off");

  let seen = 0;
  let closeFn: CloseFn | null = null;

  // 1) Try native first (on whatever WSS you have configured)
  const nativeUrl = pickNativeWss();
  if (nativeUrl) {
    console.log("Mode=NATIVE: eth_subscribe(newPendingTransactions). Waiting for events…");
    closeFn = await startNativePending("native", nativeUrl,
      async (hash) => {
        try {
          const http = new ethers.JsonRpcProvider(process.env.ALCH_ARB_HTTP || process.env.QUICKNODE_ARB_HTTP || process.env.LLAMA_ARB_HTTP || process.env.INFURA_ARB_HTTP || "", { name: "arbitrum", chainId: 42161 });
          const tx = await http.getTransaction(hash);
          if (!tx || !tx.to || !tx.data) return;
          const to = lower(tx.to);
          if (!WATCHED_ROUTERS.includes(to)) return;
          const sig = tx.data.slice(0, 10);
          if (!SIGS.has(sig)) return;
          console.log(`[PENDING/native] to=${tx.to} gas=${tx.gasLimit ?? "?"} nonce=${tx.nonce} sig=${sig} val=${formatEth(tx.value)} hash=${hash}`);
          seen++;
        } catch {}
      },
      // Heads (optional)
      (_bn) => {}
    );

    // Wait a bit to see if native yields anything
    await sleep(15000);
    if (seen > 0) {
      // native works, keep running
      return;
    } else {
      // stop native and move on
      closeFn?.();
    }
  } else {
    console.log("No native WSS set; skipping native mode.");
  }

  // 2) Fallback: Alchemy filtered
  if (haveAlchemy()) {
    console.log("Mode=ALCHEMY: alchemy_pendingTransactions with toAddress filter.");
    const alchUrl = envWss("ALCH_ARB_WSS");
    closeFn = startAlchemyFiltered(alchUrl, WATCHED_ROUTERS, async (res: any) => {
      try {
        if (typeof res === "string") {
          // hashesOnly path
          const hash = res;
          const http = new ethers.JsonRpcProvider(process.env.ALCH_ARB_HTTP || "", { name: "arbitrum", chainId: 42161 });
          const tx = await http.getTransaction(hash);
          if (!tx || !tx.to || !tx.data) return;
          const to = lower(tx.to);
          if (!WATCHED_ROUTERS.includes(to)) return;
          const sig = tx.data.slice(0, 10);
          if (!SIGS.has(sig)) return;
          console.log(`[PENDING/alchemy] to=${tx.to} gas=${tx.gasLimit ?? "?"} nonce=${tx.nonce} sig=${sig} val=${formatEth(tx.value)} hash=${hash}`);
          seen++;
          return;
        }
        // object path
        const obj = res || {};
        const to = lower(obj.to);
        const hash = obj.hash || "(no-hash)";
        const sig = (obj.input || obj.data || "").slice(0, 10);
        if (!to || !WATCHED_ROUTERS.includes(to)) return;
        if (sig && !SIGS.has(sig)) return;
        console.log(`[PENDING/alchemy] to=${obj.to} nonce=${obj.nonce ?? "?"} sig=${sig || "?"} val=${obj.value ?? "?"} hash=${hash}`);
        seen++;
      } catch {}
    });

    // Give Alchemy some time
    await sleep(20000);
    if (seen > 0) return;
    // stop and try one more fallback
    closeFn?.();
  } else {
    console.log("No Alchemy WSS configured; skipping Alchemy fallback.");
  }

  // 3) Last fallback: try native AGAIN specifically on QuickNode (some plans stream pending fine)
  const qnUrl = pickQuickNodeWss();
  if (qnUrl) {
    console.log("Mode=NATIVE (QuickNode): retry eth_subscribe(newPendingTransactions)…");
    closeFn = await startNativePending("qn", qnUrl,
      async (hash) => {
        try {
          const http = new ethers.JsonRpcProvider(process.env.QUICKNODE_ARB_HTTP || "", { name: "arbitrum", chainId: 42161 });
          const tx = await http.getTransaction(hash);
          if (!tx || !tx.to || !tx.data) return;
          const to = lower(tx.to);
          if (!WATCHED_ROUTERS.includes(to)) return;
          const sig = tx.data.slice(0, 10);
          if (!SIGS.has(sig)) return;
          console.log(`[PENDING/qn] to=${tx.to} gas=${tx.gasLimit ?? "?"} nonce=${tx.nonce} sig=${sig} val=${formatEth(tx.value)} hash=${hash}`);
          seen++;
        } catch {}
      }
    );
    await sleep(20000);
    if (seen > 0) return;
    closeFn?.();
  } else {
    console.log("No QuickNode WSS configured; skipping QuickNode native retry.");
  }

  console.log("⚠️ Still no pending tx events. Likely causes: (a) plan lacks mempool WS, (b) provider gating, or (c) WSS key/region limits. Enable mempool streaming on your provider or switch to one that supports it.");
  process.stdin.resume();
})();

// Graceful shutdown
process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
