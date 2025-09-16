"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PriorityQueue = exports.Priority = void 0;
// src/searcher/priorityQueue.ts
var Priority;
(function (Priority) {
    Priority[Priority["EMERGENCY"] = 10] = "EMERGENCY";
    Priority[Priority["HIGH"] = 8] = "HIGH";
    Priority[Priority["MEDIUM"] = 5] = "MEDIUM";
    Priority[Priority["LOW"] = 2] = "LOW";
})(Priority || (exports.Priority = Priority = {}));
class PriorityQueue {
    maxConcurrent;
    q = [];
    active = 0;
    constructor(maxConcurrent = 5) {
        this.maxConcurrent = maxConcurrent;
    }
    add(p, run) {
        return new Promise((resolve, reject) => {
            this.q.push({ p, run, resolve, reject });
            this.q.sort((a, b) => b.p - a.p);
            this.pump();
        });
    }
    pump() {
        while (this.active < this.maxConcurrent && this.q.length > 0) {
            const t = this.q.shift();
            this.active++;
            t.run().then(v => { this.active--; t.resolve(v); this.pump(); }, e => { this.active--; t.reject(e); this.pump(); });
        }
    }
}
exports.PriorityQueue = PriorityQueue;
