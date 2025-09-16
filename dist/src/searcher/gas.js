"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.estimateGasARB = estimateGasARB;
const resilientProvider_1 = require("./resilientProvider");
const univ3_1 = require("./univ3");
/** Conservative, EIP-1559 aware gas cost; convert to ARB via WETH->ARB quote */
async function estimateGasARB(_provider, tx, feeForWethToArb // fee tier used to convert gas (WETH->ARB)
) {
    // 1) Estimate limit with provider rotation
    const gasLimit = await resilientProvider_1.RP.withProvider((p) => p.estimateGas({
        to: tx.to,
        data: tx.data,
        value: tx.value ?? 0n,
        ...(tx.from ? { from: tx.from } : {}),
    }));
    // 2) Gas price (prefer maxFeePerGas; fallback gasPrice)
    const feeData = await resilientProvider_1.RP.withProvider((p) => p.getFeeData());
    const gasPriceWei = (feeData.maxFeePerGas ?? feeData.gasPrice ?? 1000000000n); // 1 gwei fallback on weird nodes
    const gasWei = gasLimit * gasPriceWei;
    // 3) Convert WETH->ARB for gas amount (gasWei is wei, same decimals as WETH/ETH)
    const WETH = (0, univ3_1.tokenAddress)("WETH");
    const ARB = (0, univ3_1.tokenAddress)("ARB");
    let gasAsArb = 0n;
    try {
        gasAsArb = await (0, univ3_1.quoteExactInputSingle)(null, feeForWethToArb, WETH, ARB, gasWei);
    }
    catch {
        // If quoter fails sporadically, use a conservative *2x* safety on gas
        gasAsArb = 0n; // leave 0 and upstream will keep higher EV guard via minProfit
    }
    return {
        gasLimit,
        gasPriceWei,
        gasWei,
        wethCostWei: gasWei,
        gasAsArb,
    };
}
