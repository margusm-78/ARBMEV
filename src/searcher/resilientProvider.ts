// src/searcher/resilientProvider.ts
import "dotenv/config";
import { ethers } from "ethers";

// --- Types
type ProviderTag = "alchemy" | "quicknode" | "llama" | "infura" | "other";

type RpcCandidate = {
  tag: ProviderTag;
  kind: "http" | "ws";
  url: string;
};

// Simple sliding window counter
class WindowCounter {
  private buf: ProviderTag[] = [];
  constructor(private size = 300) {}
  push(tag: ProviderTag) {
    this.buf.push(tag);
    if (this.buf.length > this.size) this.buf.shift();
  }
  ratio(tag: ProviderTag) {
    if (this.buf.length === 0) return 0;
    const n = this.buf.filter(t => t === tag).length;
    return n / this.buf.length;
  }
  counts() {
    const m = new Map<ProviderTag, number>();
    for (const t of this.buf) m.set(t, (m.get(t) || 0) + 1);
    return m;
  }
}

type ProviderState = {
  tag: ProviderTag;
  http?: ethers.JsonRpcProvider;
  ws?: ethers.WebSocketProvider;
  failedUntil?: number; // ms epoch when circuit opens
  lastLatencyMs?: number;
  ok: boolean;
};

// ---- Env helpers
function val(name: string) { return (process.env[name] || "").trim(); }
function asBool(v?: string, def = false) {
  if (!v) return def;
  const s = v.toLowerCase().trim();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}
const DRY_RUN = asBool(process.env.DRY_RUN, asBool(process.env.NO_BROADCAST, false));

// Percent caps (rough) for how much traffic each provider may see in the sliding window.
// We keep Infura very low by default so it acts as 3rd+ backup.
const CAP: Record<ProviderTag, number> = {
  alchemy: Number(process.env.CAP_ALCHEMY ?? 1.0),
  quicknode: Number(process.env.CAP_QUICKNODE ?? 0.8),
  llama: Number(process.env.CAP_LLAMA ?? 0.8),
  infura: Number(process.env.CAP_INFURA ?? 0.15),
  other: Number(process.env.CAP_OTHER ?? 0.5),
};

// Priority order: lower index = higher priority.
// You can override via RPC_PRIORITY='alchemy,quicknode,llama,infura'
const PRIORITY: ProviderTag[] = (process.env.RPC_PRIORITY || "alchemy,quicknode,llama,infura")
  .split(",")
  .map(s => s.trim().toLowerCase() as ProviderTag)
  .filter(Boolean);

// Gather candidates from env
function collectCandidates(): RpcCandidate[] {
  const out: RpcCandidate[] = [];
  const add = (tag: ProviderTag, kind: "http" | "ws", name: string) => {
    const v = val(name);
    if (v) out.push({ tag, kind, url: v });
  };

  // Preferred names from earlier chats
  add("alchemy", "http", "ALCH_ARB_HTTP"); add("alchemy","ws","ALCH_ARB_WSS");
  add("quicknode","http","QNODE_ARB_HTTP"); add("quicknode","ws","QNODE_ARB_WSS");
  add("quicknode","http","QUICKNODE_ARB_HTTP"); add("quicknode","ws","QUICKNODE_ARB_WSS");
  add("llama","http","LLAMA_ARB_HTTP"); add("llama","ws","LLAMA_ARB_WSS");
  add("infura","http","INFURA_ARB_HTTP"); add("infura","ws","INFURA_ARB_WSS");

  // Generic fallbacks (keep infura last if user sets ARB_RPC_URL)
  const genericHttp = val("ARB_RPC_URL");
  if (genericHttp) out.push({ tag: detectTag(genericHttp), kind: "http", url: genericHttp });
  const genericWs = val("ARB_WS_URL") || val("ARB_WSS_URL");
  if (genericWs) out.push({ tag: detectTag(genericWs), kind: "ws", url: genericWs });

  // Old names
  const b = val("ARB_RPC_URL_BACKUP");
  if (b) out.push({ tag: detectTag(b), kind: "http", url: b });

  return out;
}

function detectTag(url: string): ProviderTag {
  const u = url.toLowerCase();
  if (u.includes("alchemy.com")) return "alchemy";
  if (u.includes("quicknode") || u.includes("quiknode")) return "quicknode";
  if (u.includes("llamanodes") || u.includes("llama")) return "llama";
  if (u.includes("infura")) return "infura";
  return "other";
}

function byPriority(a: RpcCandidate, b: RpcCandidate) {
  return PRIORITY.indexOf(a.tag) - PRIORITY.indexOf(b.tag);
}

// ---- The resilient RP singleton ----
class ResilientProvider {
  private states: ProviderState[] = [];
  private window = new WindowCounter(300);
  private current?: ProviderState;
  private ready = false;

  // Expose http provider for normal usage
  get provider(): ethers.JsonRpcProvider {
    if (!this.current?.http) throw new Error("RP not ready; call RP.ensureReady()");
    return this.current.http;
  }

  // One-time setup
  async ensureReady() {
    if (this.ready) return;

    const cand = collectCandidates()
      .filter(c => !!c.url)
      .sort(byPriority);

    if (cand.length === 0) {
      throw new Error("No RPC endpoints configured. Set e.g. ALCH_ARB_HTTP, QNODE_ARB_HTTP, LLAMA_ARB_HTTP, INFURA_ARB_HTTP.");
    }

    // Build state per tag; group http/ws by tag
    const tags = Array.from(new Set(cand.map(c => c.tag)));
    this.states = tags.map(tag => {
      const httpUrl = cand.find(c => c.tag === tag && c.kind === "http")?.url;
      const wsUrl = cand.find(c => c.tag === tag && c.kind === "ws")?.url;
      const st: ProviderState = {
        tag,
        http: httpUrl ? new ethers.JsonRpcProvider(httpUrl, { name: "arbitrum", chainId: 42161 }) : undefined,
        ws: wsUrl ? new ethers.WebSocketProvider(wsUrl, 42161) : undefined,
        ok: false,
      };
      return st;
    });

    // Probe fastest within priority order
    for (const tag of PRIORITY) {
      const st = this.states.find(s => s.tag === tag && s.http);
      if (!st) continue;
      try {
        const t0 = Date.now();
        const bn = await st.http!.getBlockNumber();
        st.ok = Number.isFinite(bn);
        st.lastLatencyMs = Date.now() - t0;
        if (st.ok) { this.current = st; break; }
      } catch (_) {
        st.ok = false;
      }
    }
    if (!this.current) {
      // pick any working
      for (const st of this.states) {
        if (!st.http) continue;
        try { await st.http.getBlockNumber(); this.current = st; break; } catch {}
      }
    }
    if (!this.current?.http) throw new Error("No healthy RPCs after probing.");

    this.ready = true;
    this.logStatus("ready");
  }

  // Low-level with fallback + budgets + circuit breaker
  async withProvider<T>(fn: (p: ethers.JsonRpcProvider) => Promise<T>): Promise<T> {
    await this.ensureReady();
    const tried = new Set<ProviderState>();

    // At most N attempts across providers
    for (let attempt = 0; attempt < this.states.length; attempt++) {
      let st = this.pickProvider();
      if (!st || tried.has(st)) st = this.pickNext(tried);
      if (!st) throw new Error("RP: No provider eligible to use right now");

      tried.add(st);

      // Skip if circuit open
      if (st.failedUntil && Date.now() < st.failedUntil) continue;

      try {
        // lightweight budget check (do not exceed CAP ratio)
        const r = this.window.ratio(st.tag);
        const cap = CAP[st.tag] ?? 0.5;
        if (r > cap && this.hasBetterOption(st)) {
          // try others first
          continue;
        }

        const t0 = Date.now();
        const prox = this.wrapForDryRun(st.http!);
        const out = await fn(prox);
        st.lastLatencyMs = Date.now() - t0;
        st.ok = true;

        // record usage
        this.current = st;
        this.window.push(st.tag);
        return out;
      } catch (e: any) {
        st.ok = false;
        st.failedUntil = Date.now() + this.penaltyMs(e);
        this.logStatus(`error on ${st.tag}: ${e?.code || ""} ${e?.shortMessage || e?.message || e}`);
        continue;
      }
    }
    throw new Error("RP: All providers failed");
  }

  // Subscribe to new heads; prefers WS
  onNewHeads(onBlock: (bn: number) => void, onError?: (e: any) => void): () => void {
    const ws = this.bestWs();
    if (ws) {
      const handler = (bn: number) => onBlock(bn);
      ws.on("block", handler);
      const off = () => { try { ws.off("block", handler); } catch {} };
      return off;
    } else {
      // Poll using current http provider
      let stopped = false;
      const poll = async () => {
        let last = -1;
        while (!stopped) {
          try {
            const bn = await this.withProvider(p => p.getBlockNumber());
            if (bn !== last) {
              last = bn; onBlock(bn);
            }
          } catch (e) { onError?.(e); }
          await new Promise(r => setTimeout(r, 3000));
        }
      };
      poll();
      return () => { stopped = true; };
    }
  }

  // Subscribe to filtered logs (WS if possible, else polling)
  subscribeLogs(filter: ethers.Filter | { address?: string | string[], topics?: (string | string[] | null)[], fromBlock?: number, toBlock?: number },
                onLog: (log: ethers.Log) => void,
                onError?: (e: any) => void): () => void {
    const ws = this.bestWs();
    if (ws) {
      const handler = (log: ethers.Log) => onLog(log);
      ws.on(filter as any, handler);
      const off = () => { try { ws.off(filter as any, handler); } catch {} };
      return off;
    } else {
      // simple polling fallback
      let stopped = false;
      let from = (filter as any)?.fromBlock ?? "latest";
      const poll = async () => {
        while (!stopped) {
          try {
            const logs = await this.withProvider(p => p.getLogs({ ...(filter as any), fromBlock: from, toBlock: "latest" as any }));
            for (const log of logs) onLog(log);
            // advance window
            const head = await this.withProvider(p => p.getBlockNumber());
            from = head;
          } catch (e) { onError?.(e); }
          await new Promise(r => setTimeout(r, 5000));
        }
      };
      poll();
      return () => { stopped = true; };
    }
  }

  // --- helpers

  private pickProvider(): ProviderState | undefined {
    // prefer current if healthy + under cap
    if (this.current?.http) {
      const c = this.current;
      const r = this.window.ratio(c.tag);
      if ((!c.failedUntil || Date.now() >= c.failedUntil) && (r <= (CAP[c.tag] ?? 0.5))) {
        return c;
      }
    }
    // else choose first healthy by priority
    return this.states
      .filter(s => !!s.http)
      .sort((a, b) => PRIORITY.indexOf(a.tag) - PRIORITY.indexOf(b.tag))
      .find(s => !s.failedUntil || Date.now() >= s.failedUntil);
  }

  private pickNext(exclude: Set<ProviderState>): ProviderState | undefined {
    return this.states
      .filter(s => !!s.http && !exclude.has(s))
      .sort((a, b) => PRIORITY.indexOf(a.tag) - PRIORITY.indexOf(b.tag))
      .find(s => !s.failedUntil || Date.now() >= s.failedUntil);
  }

  private hasBetterOption(current: ProviderState): boolean {
    const idx = PRIORITY.indexOf(current.tag);
    for (let i = 0; i < idx; i++) {
      const s = this.states.find(st => st.tag === PRIORITY[i] && !!st.http);
      if (s && (!s.failedUntil || Date.now() >= s.failedUntil)) return true;
    }
    return false;
  }

  private penaltyMs(e: any): number {
    const code = (e?.code || "").toString();
    if (code === "SERVER_ERROR" && /rate limit|429/i.test(e?.message || "")) return 60_000;
    if (/timeout|ETIMEDOUT|ECONNRESET/i.test(e?.message || "")) return 20_000;
    return 5_000;
  }

  private bestWs(): ethers.WebSocketProvider | undefined {
    // Prefer WS aligned to the current tag, else highest priority available
    if (this.current?.ws) return this.current.ws;
    for (const tag of PRIORITY) {
      const s = this.states.find(st => st.tag === tag && !!st.ws);
      if (s?.ws) return s.ws;
    }
    return undefined;
  }

  private wrapForDryRun(p: ethers.JsonRpcProvider): ethers.JsonRpcProvider {
    if (!DRY_RUN) return p;
    // Trap 'eth_sendRawTransaction' while leaving the rest untouched
    const proxy = new Proxy(p, {
      get(target, prop, receiver) {
        if (prop === "send") {
          return async (method: string, params: any[]) => {
            if (method === "eth_sendRawTransaction" || method === "eth_sendTransaction") {
              const hashLike = "0x" + "de".repeat(32);
              console.log(`[DRY_RUN] Suppressed ${method}. Bytes=${(params?.[0] || "").toString().slice(0,18)}… -> ${hashLike}`);
              return hashLike;
            }
            // @ts-ignore
            return target.send(method, params);
          };
        }
        // @ts-ignore
        return Reflect.get(target, prop, receiver);
      }
    });
    // Type cast for convenience; proxy quacks like a provider
    return proxy as unknown as ethers.JsonRpcProvider;
  }

  private logStatus(msg: string) {
    const counts = Array.from(this.window.counts()).map(([tag, n]) => `${tag}:${n}`).join(" ");
    const cur = this.current ? `${this.current.tag}${this.current.lastLatencyMs ? ` ${this.current.lastLatencyMs}ms` : ""}` : "none";
    console.log(`[RP] ${msg} | current=${cur} | window=[${counts}] | priority=${PRIORITY.join(" > ")}`);
  }
}

export const RP = new ResilientProvider();
