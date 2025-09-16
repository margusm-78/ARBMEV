"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.simulateTwoHopArbWeth = simulateTwoHopArbWeth;
exports.evEstimateARB = evEstimateARB;
const univ3_1 = require("./univ3");
/**
 * Simulate ARB->WETH on feeA, then WETH->ARB on feeB.
 * Returns gross/min outputs in ARB plus intermediate WETH.
 */
async function simulateTwoHopArbWeth(fees, amountInARB) {
    const ARB = (0, univ3_1.tokenAddress)("ARB");
    const WETH = (0, univ3_1.tokenAddress)("WETH");
    // Hop 1: ARB -> WETH on feeA
    const hop1OutWETH = await (0, univ3_1.quoteExactInputSingle)(null, fees[0], ARB, WETH, amountInARB);
    // Hop 2: WETH -> ARB on feeB
    const grossOutARB = await (0, univ3_1.quoteExactInputSingle)(null, fees[1], WETH, ARB, hop1OutWETH);
    const minOutARB = (0, univ3_1.applySlippage)(grossOutARB, Number(process.env.MAX_SLIPPAGE_BPS ?? "50"), true);
    return { inARB: amountInARB, hop1OutWETH, grossOutARB, minOutARB };
}
/** EV in ARB: gross - in - gasInARB (we convert gas WETH→ARB) */
function evEstimateARB(grossOutARB, inARB, gasARB) {
    return grossOutARB - inARB - gasARB;
}
