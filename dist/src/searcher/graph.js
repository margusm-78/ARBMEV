"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildTwoPoolLoop = buildTwoPoolLoop;
function buildTwoPoolLoop(p0, p1) {
    return [
        { edges: [{ pool: p0, direction: "token0->token1" }, { pool: p1, direction: "token1->token0" }], description: `${p0.name} -> ${p1.name}` },
        { edges: [{ pool: p1, direction: "token0->token1" }, { pool: p0, direction: "token1->token0" }], description: `${p1.name} -> ${p0.name}` }
    ];
}
