"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// src/searcher/preflight-checks.ts
require("dotenv/config");
const ethers_1 = require("ethers");
const utils_1 = require("./utils");
async function main() {
    const provider = (0, utils_1.makeProvider)();
    const wallet = (0, utils_1.makeWallet)(provider);
    const me = await wallet.getAddress();
    const spenderArg = process.env.ROUTER_ADDRESS || "";
    const spender = (0, utils_1.toAddress)(spenderArg);
    // Use ARB_REF_TOKENS or default to ARB,WETH (USDC removed)
    const list = (process.env.ARB_REF_TOKENS || "ARB,WETH")
        .split(",")
        .map(utils_1.asTrimmedString)
        .filter(Boolean);
    console.log("EOA:", me);
    console.log("Spender (router):", spender);
    console.log("Tokens:", list.join(", "));
    // Native ETH balance (on Arbitrum)
    const eth = await provider.getBalance(me);
    console.log(`ETH: ${ethers_1.ethers.formatEther(eth)} ETH`);
    for (const it of list) {
        let tokenAddr;
        if ((0, utils_1.isHex40)(it))
            tokenAddr = ethers_1.ethers.getAddress(it);
        else {
            tokenAddr = utils_1.TOKENS_LC[it.toLowerCase()];
            if (!tokenAddr) {
                console.log(`- ${it}: unknown symbol (set in .env or TOKENS map)`);
                continue;
            }
        }
        const erc20 = new ethers_1.ethers.Contract(tokenAddr, utils_1.ERC20_ABI, provider);
        const [sym, dec, bal, allowance] = await Promise.all([
            erc20.symbol().catch(() => "ERC20"),
            erc20.decimals().catch(() => 18),
            erc20.balanceOf(me),
            erc20.allowance(me, spender),
        ]);
        const dp = Number(dec);
        console.log(`- ${it} -> ${tokenAddr} (${sym}, ${dp} dp)`);
        console.log(`  balance   : ${bal} (${(0, utils_1.formatUnitsSafe)(bal, dp)})`);
        console.log(`  allowance : ${allowance} (${(0, utils_1.formatUnitsSafe)(allowance, dp)})`);
    }
}
main().catch((e) => {
    console.error(e);
    process.exit(1);
});
