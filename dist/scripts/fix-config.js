"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const json5_1 = __importDefault(require("json5"));
function argvValue(flag) {
    const i = process.argv.indexOf(flag);
    return i >= 0 ? process.argv[i + 1] : undefined;
}
const MIN_PROFIT = argvValue("--minProfit") ?? "0.0002";
const NOTIONAL_ARB = argvValue("--notionalARB") ?? "0.005";
const ENSURE_LIMITER = process.argv.includes("--ensureLimiter");
const file = path_1.default.resolve("watcher.config.json");
const raw = fs_1.default.readFileSync(file, "utf8");
// Parse tolerantly (comments / trailing commas OK)
let cfg;
try {
    cfg = json5_1.default.parse(raw);
}
catch (e) {
    console.error("Could not parse watcher.config.json. Error:\n", e?.message ?? e);
    process.exit(1);
}
// Apply changes
cfg.minProfit = String(MIN_PROFIT);
cfg.notional = { ...(cfg.notional ?? {}), ARB: String(NOTIONAL_ARB) };
// Ensure limiter is fully initialized with correct typing
function ensureLimiter(cur) {
    const src = (cur ?? {});
    return {
        max: 1,
        persistent: src.persistent ?? true,
        statePath: src.statePath ?? ".state/hot_tx_counter.json",
    };
}
if (ENSURE_LIMITER || !cfg.hotTxLimiter) {
    cfg.hotTxLimiter = ensureLimiter(cfg.hotTxLimiter);
}
// Backup and write strict JSON
const bak = file + ".bak";
fs_1.default.writeFileSync(bak, raw, "utf8");
fs_1.default.writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n", "utf8");
console.log("✅ watcher.config.json normalized and updated.");
console.log("   Backup saved at:", bak);
console.log("   minProfit:", cfg.minProfit);
console.log("   notional.ARB:", cfg.notional?.ARB);
console.log("   hotTxLimiter:", cfg.hotTxLimiter);
