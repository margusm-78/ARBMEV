"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isRateLimit = isRateLimit;
exports.withRetry = withRetry;
// src/searcher/rpc.ts
const promises_1 = require("timers/promises");
// Env-driven retry/backoff with sane defaults
const RETRIES = Number(process.env.RPC_RETRIES ?? "3");
const BASE_MS = Number(process.env.RPC_BACKOFF_BASE_MS ?? "120");
const MAX_MS = Number(process.env.RPC_BACKOFF_MAX_MS ?? "1200");
const JITTER = Number(process.env.RPC_BACKOFF_JITTER ?? "0.25"); // +/-25%
function isRateLimit(e) {
    const code = e?.info?.error?.code;
    const msg = (e?.shortMessage || e?.message || "").toLowerCase();
    // common vendor phrases
    return code === 429
        || msg.includes("rate")
        || msg.includes("capacity")
        || msg.includes("compute units per second")
        || msg.includes("exceeded");
}
async function withRetry(label, fn) {
    let attempt = 0;
    let lastErr;
    while (attempt <= RETRIES) {
        try {
            return await fn();
        }
        catch (e) {
            lastErr = e;
            if (!isRateLimit(e))
                throw e;
            const backoff = Math.min(BASE_MS * 2 ** attempt, MAX_MS);
            const jitter = 1 + (Math.random() * 2 - 1) * JITTER; // +/- jitter
            const wait = Math.max(0, Math.floor(backoff * jitter));
            if (attempt === RETRIES)
                break;
            console.warn(`[retry] ${label}: rate-limited (attempt ${attempt + 1}/${RETRIES}); waiting ${wait}ms`);
            await (0, promises_1.setTimeout)(wait);
            attempt++;
        }
    }
    throw lastErr;
}
