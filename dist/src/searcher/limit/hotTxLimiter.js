"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initHotTxLimiter = initHotTxLimiter;
exports.canSend = canSend;
exports.recordSend = recordSend;
exports.remaining = remaining;
exports.currentCount = currentCount;
exports.currentMax = currentMax;
exports.describeLimiter = describeLimiter;
// src/searcher/limit/hotTxLimiter.ts
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
/**
 * Simple hot-TX limiter.
 * - HOT_TX_MAX=3 limits to 3 sends (0 or negative => unlimited)
 * - HOT_TX_PERSIST=true writes count to HOT_TX_STATE_PATH (default .state/hot_tx_counter.json)
 *   so a restart won't reset the counter.
 */
const MAX = Number(process.env.HOT_TX_MAX ?? "0"); // 0 => unlimited
const PERSIST = (process.env.HOT_TX_PERSIST ?? "false").toLowerCase() === "true";
const STATE_PATH = process.env.HOT_TX_STATE_PATH ?? path_1.default.join(process.cwd(), ".state", "hot_tx_counter.json");
let count = 0;
function ensureDir(p) {
    const dir = path_1.default.dirname(p);
    if (!fs_1.default.existsSync(dir))
        fs_1.default.mkdirSync(dir, { recursive: true });
}
function load() {
    if (!PERSIST)
        return;
    try {
        if (fs_1.default.existsSync(STATE_PATH)) {
            const raw = fs_1.default.readFileSync(STATE_PATH, "utf-8");
            const j = JSON.parse(raw);
            if (typeof j.count === "number")
                count = j.count;
        }
    }
    catch { /* ignore */ }
}
function save() {
    if (!PERSIST)
        return;
    try {
        ensureDir(STATE_PATH);
        fs_1.default.writeFileSync(STATE_PATH, JSON.stringify({ count, max: MAX, ts: Date.now() }, null, 2), "utf-8");
    }
    catch { /* ignore */ }
}
function initHotTxLimiter() {
    load();
}
function canSend() {
    if (MAX <= 0)
        return true;
    return count < MAX;
}
function recordSend() {
    count++;
    save();
}
function remaining() {
    if (MAX <= 0)
        return Number.POSITIVE_INFINITY;
    return Math.max(0, MAX - count);
}
function currentCount() { return count; }
function currentMax() { return MAX; }
function describeLimiter() {
    return {
        max: MAX,
        persistent: PERSIST,
        statePath: PERSIST ? STATE_PATH : "(none)",
        used: count,
        remaining: remaining(),
    };
}
