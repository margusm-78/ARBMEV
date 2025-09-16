"use strict";
// scripts/test-profitable.ts
// Root-aware test harness for your MEV bot (ts-node & compiled builds).
// - Resolves bot module from repo root, not the /scripts directory.
// - Loads .ts via require (ts-node), .js/.cjs via require, .mjs via dynamic import.
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
exports.testBot = testBot;
require("dotenv/config");
const ethers_1 = require("ethers");
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const node_url_1 = require("node:url");
/* ------------------------------ Pretty helpers ------------------------------ */
const toBigInt = (v) => {
    if (typeof v === "bigint")
        return v;
    if (typeof v === "number")
        return BigInt(Math.trunc(v));
    if (typeof v === "string") {
        try {
            return BigInt(v);
        }
        catch { }
    }
    throw new Error(`Value is not bigint-compatible: ${String(v)}`);
};
const fmt18 = (v) => {
    try {
        return ethers_1.ethers.formatUnits(toBigInt(v), 18);
    }
    catch {
        return String(v);
    }
};
function header(title) {
    console.log("");
    console.log("=".repeat(title.length));
    console.log(title);
    console.log("=".repeat(title.length));
}
/* ------------------------------ Root-aware module resolver ------------------------------ */
async function importBot() {
    const root = process.cwd(); // repo root if you run "npx ts-node scripts/test-profitable.ts"
    const candidates = [
        { label: "src ts", absPath: path.join(root, "src", "searcher", "profitable.ts") },
        { label: "dist js", absPath: path.join(root, "dist", "searcher", "profitable.js") },
        { label: "dist cjs", absPath: path.join(root, "dist", "searcher", "profitable.cjs") },
        { label: "dist mjs", absPath: path.join(root, "dist", "searcher", "profitable.mjs") },
        // rare layouts / fallbacks
        { label: "root ts", absPath: path.join(root, "searcher", "profitable.ts") },
        { label: "root js", absPath: path.join(root, "searcher", "profitable.js") },
    ];
    const errors = [];
    for (const c of candidates) {
        if (!fs.existsSync(c.absPath)) {
            errors.push(`${relFrom(root, c.absPath)}: (missing)`);
            continue;
        }
        try {
            const ext = path.extname(c.absPath).toLowerCase();
            let mod;
            if (ext === ".mjs") {
                // ESM-only → use dynamic import
                mod = await Promise.resolve(`${(0, node_url_1.pathToFileURL)(c.absPath).href}`).then(s => __importStar(require(s)));
            }
            else {
                // Prefer require so ts-node can hook .ts files (and CJS .js/.cjs)
                // @ts-ignore Node's require is available under ts-node CJS mode
                mod = require(c.absPath);
            }
            // Common transpilers may put exports under .default; normalize
            const resolved = (mod?.default && (mod.runProfitableMEVBot || mod.default.runProfitableMEVBot))
                ? (mod.default.runProfitableMEVBot ? mod.default : mod)
                : mod;
            guardModuleShape(resolved, c.absPath);
            console.log(`Loaded bot module: ${relFrom(root, c.absPath)}`);
            return resolved;
        }
        catch (e) {
            const msg = e?.message || String(e);
            errors.push(`${relFrom(root, c.absPath)}: ${msg}`);
        }
    }
    throw new Error(`Unable to import bot module. Tried:\n` +
        candidates.map(c => `- ${relFrom(root, c.absPath)}`).join("\n") +
        `\n\nErrors:\n${errors.join("\n")}`);
}
function guardModuleShape(m, fromPath) {
    if (!m)
        throw new Error("Empty module");
    if (typeof m.runProfitableMEVBot !== "function") {
        throw new Error(`Missing runProfitableMEVBot() in ${fromPath}`);
    }
    if (typeof m.startContinuousMonitoring !== "function") {
        throw new Error(`Missing startContinuousMonitoring() in ${fromPath}`);
    }
    if (!m.CFG)
        throw new Error(`Missing CFG export in ${fromPath}`);
    if (!m.ADDR)
        throw new Error(`Missing ADDR export in ${fromPath}`);
}
function relFrom(root, absPath) {
    const rel = path.relative(root, absPath);
    return rel || absPath;
}
/* ------------------------------ Main runner ------------------------------ */
async function testBot() {
    header("TESTING PROFITABLE MEV BOT");
    const bot = await importBot();
    const { runProfitableMEVBot, startContinuousMonitoring, CFG, ADDR } = bot;
    // Provider with explicit Arbitrum chain hint (prevents v6 "detect network" blips)
    const rpcUrl = process.env.ARB_RPC_URL || "https://arb1.arbitrum.io/rpc";
    const provider = new ethers_1.ethers.JsonRpcProvider(rpcUrl, { name: "arbitrum", chainId: 42161 });
    try {
        // ---- RPC sanity
        console.log("Testing RPC connection...");
        const [blockNumber, chainIdHex] = await Promise.all([
            provider.getBlockNumber(),
            provider.send("eth_chainId", []),
        ]);
        console.log(`Connected to Arbitrum. Block: ${blockNumber} | ChainId: ${parseInt(chainIdHex, 16)}`);
        // ---- Config preview
        header("Configuration");
        console.log(`Trade Size (A): ${fmt18(CFG.PROBE_NOTIONAL_A)} ARB`);
        console.log(`Min Profit     : ${fmt18(CFG.MIN_PROFIT_ARB)} ARB`);
        console.log(`Cross-DEX?     : ${!!CFG.ENABLE_CROSS_DEX}`);
        console.log(`Triangular?    : ${!!CFG.ENABLE_TRIANGULAR}`);
        // ---- Key Flags (new)
        header("Key Flags");
        console.log(`Multi-Pair?       : ${!!CFG.ENABLE_MULTI_PAIR}`);
        console.log(`Deep Scanning?    : ${!!CFG.ENABLE_DEEP_SCANNING}`);
        console.log(`Curve Enabled?    : ${!!CFG.ENABLE_CURVE}`);
        console.log(`Balancer Enabled? : ${!!CFG.ENABLE_BALANCER}`);
        console.log(`Log DEX Perf?     : ${!!CFG.LOG_DEX_PERFORMANCE}`);
        // ---- Addresses
        header("Addresses");
        if (ADDR.ARB)
            console.log(`ARB       : ${ADDR.ARB}`);
        if (ADDR.WETH)
            console.log(`WETH      : ${ADDR.WETH}`);
        if (ADDR.UNI_QUOTER)
            console.log(`Quoter    : ${ADDR.UNI_QUOTER}`);
        const poolAddr = ADDR.UNIV3_ARB_WETH_03 || ADDR.UNIV3_ARB_WETH_3000;
        if (poolAddr)
            console.log(`ARB/WETH  : ${poolAddr}`);
        // ---- Routers (new diagnostics for your extended .env)
        header("Routers (V2-compatible & others)");
        const show = (k) => (ADDR[k] ? console.log(`${k}: ${ADDR[k]}`) : 0);
        [
            "SUSHI_ROUTER",
            "CAMELOT_ROUTER",
            "TRADERJOE_ROUTER",
            "ARBIDEX_ROUTER",
            "ZYBERSWAP_ROUTER",
            "RAMSES_ROUTER", // placeholder (Solidly)
            "SUSHIXSWAP_ROUTER", // placeholder (aggregator)
            "ONEINCH_ROUTER", // placeholder (aggregator)
            "PARASWAP_ROUTER" // placeholder (aggregator)
        ].forEach(show);
        // ---- Mode
        const mode = (process.argv[2] || process.env.MODE || "single").toLowerCase();
        if (mode === "single" || mode === "test") {
            header("Single Scan");
            const t0 = Date.now();
            const result = await runProfitableMEVBot(provider);
            const ms = Date.now() - t0;
            console.log(`Scan completed in ${ms} ms`);
            if (result && result.profitable) {
                console.log("🎉 PROFITABLE OPPORTUNITY FOUND!");
                if (result.strategy)
                    console.log("Strategy:", result.strategy);
                const profitOut = typeof result.profit === "bigint" || typeof result.profit === "number" || (typeof result.profit === "string" && /^\d+$/.test(result.profit))
                    ? `${fmt18(result.profit)} ARB`
                    : String(result.profit ?? "Unknown");
                console.log("Profit:", profitOut);
                if (result.path)
                    console.log("Path:", Array.isArray(result.path) ? result.path.join(" -> ") : String(result.path));
                console.log(JSON.stringify(result, null, 2));
            }
            else {
                console.log("❌ No profitable opportunities found");
                console.log("\n💡 Try these adjustments:");
                console.log("   - Increase trade size: PROBE_NOTIONAL_A=0.02");
                console.log("   - Lower profit threshold: MIN_PROFIT_ARB=0.001");
                console.log("   - Enable deep scanning: ENABLE_DEEP_SCANNING=true");
                console.log("   - Wait for higher market volatility");
            }
        }
        else if (mode === "monitor" || mode === "continuous") {
            header("Continuous Monitoring");
            console.log("Press Ctrl+C to stop.");
            await startContinuousMonitoring(provider);
        }
        else if (mode === "validate") {
            header("Validation Tests");
            const tests = [
                {
                    name: "RPC reachable",
                    test: async () => (await provider.getBlockNumber()) > 0,
                },
                {
                    name: "On Arbitrum (chainId 42161)",
                    test: async () => parseInt(await provider.send("eth_chainId", []), 16) === 42161,
                },
                ADDR.UNI_QUOTER
                    ? {
                        name: "Quoter contract code present",
                        test: async () => (await provider.getCode(ADDR.UNI_QUOTER)) !== "0x",
                    }
                    : { name: "Quoter contract configured", test: async () => false },
                poolAddr
                    ? {
                        name: "ARB/WETH pool code present",
                        test: async () => (await provider.getCode(poolAddr)) !== "0x",
                    }
                    : { name: "ARB/WETH pool configured", test: async () => false },
            ];
            for (const t of tests) {
                try {
                    process.stdout.write(` - ${t.name} ... `);
                    const ok = await t.test();
                    console.log(ok ? "✅ PASS" : "❌ FAIL");
                }
                catch (err) {
                    console.log(`💥 ERROR: ${err.message}`);
                }
            }
        }
        else {
            console.log("\n❓ Unknown mode. Available modes:");
            console.log("   single | test        - Run one scan");
            console.log("   monitor | continuous - Continuous monitoring");
            console.log("   validate             - Contract & network checks");
            process.exitCode = 1;
        }
    }
    catch (error) {
        console.error("💥 Test failed:", error);
        process.exit(1);
    }
}
/* ------------------------------ CLI entry (CJS) ------------------------------ */
// @ts-ignore CJS globals provided by ts-node
const isDirectRun = typeof require !== "undefined" &&
    typeof module !== "undefined" &&
    require.main === module;
if (isDirectRun) {
    testBot()
        .then(() => {
        const mode = (process.argv[2] || process.env.MODE || "single").toLowerCase();
        if (mode !== "monitor" && mode !== "continuous")
            process.exit(0);
    })
        .catch((err) => {
        console.error("Test script failed:", err);
        process.exit(1);
    });
}
