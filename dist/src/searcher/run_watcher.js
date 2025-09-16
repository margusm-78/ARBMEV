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
// src/searcher/run_watcher.ts
require("dotenv/config");
const ethers_1 = require("ethers");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const watcher_1 = require("./watcher");
const liquidation_1 = require("./liquidation");
const config_1 = require("./config");
const metrics_1 = require("./metrics");
function loadConfig() {
    const p = path.join(process.cwd(), "watcher.config.json");
    if (!fs.existsSync(p))
        throw new Error(`watcher.config.json not found at ${p}`);
    const raw = fs.readFileSync(p, "utf-8");
    return JSON.parse(raw);
}
function getRpcUrl() {
    const env = (process.env.ARB_RPC_URL || "").trim();
    if (env)
        return env;
    const cfg = config_1.CONFIG?.rpcUrl;
    if (typeof cfg === "string" && cfg.trim())
        return cfg.trim();
    throw new Error("Missing RPC URL (ARB_RPC_URL / CONFIG.rpcUrl).");
}
function parseWethEnvAmount(name, fallback) {
    const raw = (process.env[name] || fallback).toString().trim();
    return ethers_1.ethers.parseUnits(raw, 18);
}
async function main() {
    const cfg = loadConfig();
    const provider = new ethers_1.ethers.JsonRpcProvider(getRpcUrl(), { name: "arbitrum", chainId: 42161 });
    const pk = (process.env.PRIVATE_KEY || "").trim();
    if (!pk)
        throw new Error("Missing PRIVATE_KEY");
    const wallet = new ethers_1.ethers.Wallet(pk.startsWith("0x") ? pk : `0x${pk}`, provider);
    const me = await wallet.getAddress();
    const users = Array.isArray(cfg.users) ? cfg.users : [];
    const poll = Math.max(5, Number(cfg.pollSeconds ?? 15));
    const dryRun = (process.env.DRY_RUN ?? "true").toString().toLowerCase() === "true";
    const WETH = config_1.CONFIG?.tokens?.WETH;
    if (!WETH || !ethers_1.ethers.isAddress(WETH)) {
        throw new Error("CONFIG.tokens.WETH missing/invalid for Arbitrum.");
    }
    const watcher = new watcher_1.Watcher(provider, {
        aaveData: cfg.aaveData,
        radiantData: cfg.radiantData,
        users,
    });
    console.log(`Watcher running. Poll=${poll}s | Users=${users.length} | DRY_RUN=${dryRun} | EOA=${me}`);
    // Validate path
    if (!cfg.defaultPath || !Array.isArray(cfg.defaultPath.tokens) || !Array.isArray(cfg.defaultPath.fees)) {
        console.warn("⚠️ defaultPath missing; liquidations will be skipped.");
    }
    else if (cfg.defaultPath.tokens.length !== cfg.defaultPath.fees.length + 1) {
        console.warn("⚠️ defaultPath length mismatch; liquidations will be skipped.");
    }
    else {
        const tail = cfg.defaultPath.tokens[cfg.defaultPath.tokens.length - 1];
        if (ethers_1.ethers.getAddress(tail) !== ethers_1.ethers.getAddress(WETH)) {
            console.warn("⚠️ defaultPath should end with WETH.");
        }
    }
    const debtToCoverWETH = parseWethEnvAmount("DEBT_TO_COVER_WETH", "0.1");
    const minOutWETH = (debtToCoverWETH * 99n) / 100n;
    while (true) {
        try {
            const candidates = await watcher.tick();
            if (Array.isArray(candidates) && candidates.length) {
                const summary = candidates.map((c) => {
                    const hf = typeof c.healthFactorRay === "bigint"
                        ? Number(c.healthFactorRay) / 1e27
                        : typeof c.healthFactorRay === "number"
                            ? c.healthFactorRay
                            : typeof c.healthFactorRay === "string"
                                ? Number(c.healthFactorRay)
                                : NaN;
                    const hfStr = isFinite(hf) ? hf.toFixed(6) : "n/a";
                    return `${c.protocol}:${c.user} hf≈${hfStr}`;
                });
                console.log("candidates:", summary.join(" | "));
            }
            for (const c of candidates || []) {
                const pathCfg = cfg.defaultPath;
                if (!pathCfg ||
                    !Array.isArray(pathCfg.tokens) ||
                    !Array.isArray(pathCfg.fees) ||
                    pathCfg.tokens.length !== pathCfg.fees.length + 1) {
                    console.warn("Skip: invalid/missing defaultPath");
                    continue;
                }
                const tail = pathCfg.tokens[pathCfg.tokens.length - 1];
                if (!tail || ethers_1.ethers.getAddress(tail) !== ethers_1.ethers.getAddress(WETH)) {
                    console.warn("Skip: defaultPath must end with WETH.");
                    continue;
                }
                const collateral = pathCfg.tokens[0];
                const debtAsset = WETH;
                if (dryRun) {
                    console.log(`[DRY_RUN] Would liquidate user=${c.user} protocol=${c.protocol} covering ${ethers_1.ethers.formatUnits(debtToCoverWETH, 18)} WETH`);
                    // Cast to any to avoid Metric type field restrictions
                    (0, metrics_1.recordMetric)({
                        ts: Date.now(),
                        block: 0,
                        route: "LIQ",
                        executed: false,
                        user: c.user,
                        protocol: c.protocol,
                        notionalWETH: Number(ethers_1.ethers.formatUnits(debtToCoverWETH, 18)),
                        grossWETH: Number(ethers_1.ethers.formatUnits(minOutWETH, 18)),
                        evWETH: Number(ethers_1.ethers.formatUnits(minOutWETH - debtToCoverWETH, 18)),
                        gasWETH: 0,
                    });
                    continue;
                }
                const txReq = await (0, liquidation_1.execLiquidation)({
                    signer: wallet,
                    protocol: c.protocol,
                    collateral,
                    debtAsset,
                    user: c.user,
                    debtToCover: debtToCoverWETH,
                    v3PathTokens: pathCfg.tokens,
                    v3PathFees: pathCfg.fees,
                    minOutWETH,
                });
                const resp = await wallet.sendTransaction(txReq);
                console.log(`[liq] sent ${resp.hash}`);
                const rc = await resp.wait();
                console.log(`[liq] confirmed in block ${rc?.blockNumber}`);
                (0, metrics_1.recordMetric)({
                    ts: Date.now(),
                    block: Number(rc?.blockNumber ?? 0),
                    route: "LIQ",
                    executed: true,
                    txHash: resp.hash,
                    success: true,
                    user: c.user,
                    protocol: c.protocol,
                    notionalWETH: Number(ethers_1.ethers.formatUnits(debtToCoverWETH, 18)),
                    grossWETH: Number(ethers_1.ethers.formatUnits(minOutWETH, 18)),
                    evWETH: Number(ethers_1.ethers.formatUnits(minOutWETH - debtToCoverWETH, 18)),
                    gasWETH: 0,
                });
            }
        }
        catch (e) {
            console.error("watcher loop error:", e?.message || e);
        }
        await new Promise((r) => setTimeout(r, poll * 1000));
    }
}
main().catch((e) => {
    console.error(e);
    process.exit(1);
});
