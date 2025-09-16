"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CU_WEIGHTS = void 0;
exports.getCUStatus = getCUStatus;
exports.chargeCU = chargeCU;
// src/searcher/cuBudget.ts
require("dotenv/config");
const priorityQueue_1 = require("./priorityQueue");
const dailyLimit = Number(process.env.DAILY_CU_LIMIT || 1_000_000);
const monthlyLimit = Number(process.env.MONTHLY_CU_LIMIT || 30_000_000);
const alertPct = Number(process.env.CU_ALERT_THRESHOLD || 80);
const emergencyPct = Number(process.env.CU_EMERGENCY_THRESHOLD || 95);
const state = { daily: 0, monthly: 0, dayKey: "", monthKey: "" };
function dayKeyUTC() { const d = new Date(); return d.toISOString().slice(0, 10); }
function monthKeyUTC() { const d = new Date(); return d.toISOString().slice(0, 7); }
function rollover() {
    const d = dayKeyUTC();
    const m = monthKeyUTC();
    if (state.dayKey !== d) {
        state.daily = 0;
        state.dayKey = d;
        console.log("[CU] Daily budget reset.");
    }
    if (state.monthKey !== m) {
        state.monthly = 0;
        state.monthKey = m;
        console.log("[CU] Monthly budget reset.");
    }
}
function pct(n, of) { return Math.round((n / of) * 1000) / 10; }
function getCUStatus() {
    rollover();
    return {
        daily: state.daily, dailyLimit,
        monthly: state.monthly, monthlyLimit,
        dailyPct: pct(state.daily, dailyLimit),
        monthlyPct: pct(state.monthly, monthlyLimit),
    };
}
function chargeCU(units, p) {
    rollover();
    // allow EMERGENCY operations to bypass emergency brake slightly
    const s = getCUStatus();
    if (s.daily >= dailyLimit * (emergencyPct / 100) && p < priorityQueue_1.Priority.EMERGENCY) {
        throw new Error(`[CU] Emergency brake: ${s.daily}/${dailyLimit} (${s.dailyPct}%).`);
    }
    state.daily += units;
    state.monthly += units;
    const after = getCUStatus();
    if (after.dailyPct >= alertPct && after.dailyPct < emergencyPct) {
        console.log(`[CU] ⚠ ${after.daily}/${dailyLimit} used (${after.dailyPct}%).`);
    }
    else if (after.dailyPct >= emergencyPct) {
        console.log(`[CU] 🛑 ${after.daily}/${dailyLimit} used (${after.dailyPct}%). Emergency throttling.`);
    }
}
// Rough cost weights (tunable). We only need relative scale for budget control.
exports.CU_WEIGHTS = {
    "eth_blockNumber": 1,
    "eth_getBalance": 2,
    "eth_getTransactionByHash": 2,
    "eth_getTransactionReceipt": 2,
    "eth_getCode": 5,
    "eth_call": 25, // quoter & view calls
    "eth_estimateGas": 30,
    "eth_getLogs": 150, // can be very expensive at providers
    // add more as you see patterns
};
