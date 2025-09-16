"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCUProvider = getCUProvider;
// src/searcher/cuWrappedProvider.ts
require("dotenv/config");
const resilientProvider_1 = require("./resilientProvider");
const cache_1 = require("./cache");
const priorityQueue_1 = require("./priorityQueue");
const cuBudget_1 = require("./cuBudget");
const enableAggressive = String(process.env.ENABLE_AGGRESSIVE_CACHING || "true").toLowerCase() === "true";
const baseTtl = Number(process.env.CACHE_TTL_SECONDS || 15) * 1000;
const balTtl = Number(process.env.BALANCE_CACHE_TTL_SECONDS || 30) * 1000;
const txTtl = Number(process.env.TX_CACHE_TTL_SECONDS || 5) * 1000;
const maxConc = Number(process.env.MAX_CONCURRENT_OPERATIONS || 5);
const queue = new priorityQueue_1.PriorityQueue(maxConc);
// Simple caches
const cacheCall = new cache_1.TTLCache(baseTtl);
const cacheBal = new cache_1.TTLCache(balTtl);
const cacheTx = new cache_1.TTLCache(txTtl);
function cacheKey(method, params) {
    return `${method}:${JSON.stringify(params)}`;
}
async function getCUProvider() {
    await resilientProvider_1.RP.ensureReady();
    const p = resilientProvider_1.RP.provider;
    const prox = new Proxy(p, {
        get(target, prop, receiver) {
            if (prop === "send") {
                return async (method, params) => {
                    // Priority heuristic by method
                    const priority = method === "eth_call" ? priorityQueue_1.Priority.HIGH :
                        method === "eth_getLogs" ? priorityQueue_1.Priority.HIGH :
                            method === "eth_blockNumber" ? priorityQueue_1.Priority.LOW :
                                priorityQueue_1.Priority.MEDIUM;
                    // Caching fast paths
                    if (enableAggressive) {
                        if (method === "eth_getBalance") {
                            const key = cacheKey(method, params);
                            const hit = cacheBal.get(key);
                            if (hit !== undefined)
                                return hit;
                            const out = await queue.add(priority, async () => {
                                (0, cuBudget_1.chargeCU)(cuBudget_1.CU_WEIGHTS[method] || 2, priority);
                                return target.send(method, params);
                            });
                            cacheBal.set(key, out);
                            return out;
                        }
                        if (method === "eth_getTransactionByHash") {
                            const key = cacheKey(method, params);
                            const hit = cacheTx.get(key);
                            if (hit !== undefined)
                                return hit;
                            const out = await queue.add(priority, async () => {
                                (0, cuBudget_1.chargeCU)(cuBudget_1.CU_WEIGHTS[method] || 2, priority);
                                return target.send(method, params);
                            });
                            cacheTx.set(key, out);
                            return out;
                        }
                        if (method === "eth_call") {
                            // quoter & other read calls
                            const key = cacheKey(method, params);
                            const hit = cacheCall.get(key);
                            if (hit !== undefined)
                                return hit;
                            const out = await queue.add(priority, async () => {
                                (0, cuBudget_1.chargeCU)(cuBudget_1.CU_WEIGHTS[method] || 25, priority);
                                return target.send(method, params);
                            });
                            cacheCall.set(key, out);
                            return out;
                        }
                    }
                    // Default path
                    return queue.add(priority, async () => {
                        (0, cuBudget_1.chargeCU)(cuBudget_1.CU_WEIGHTS[method] || 5, priority);
                        return target.send(method, params);
                    });
                };
            }
            // passthrough
            // @ts-ignore
            return Reflect.get(target, prop, receiver);
        }
    });
    return prox;
}
