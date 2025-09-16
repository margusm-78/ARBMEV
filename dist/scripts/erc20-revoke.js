"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// scripts/erc20-revoke.ts
require("dotenv/config");
const ethers_1 = require("ethers");
const utils_1 = require("./utils");
/** Simple argv parser supporting "--key=value" and "--key value". */
function parseArgs(argv = process.argv.slice(2)) {
    const out = {};
    for (let i = 0; i < argv.length; i++) {
        const t = argv[i];
        if (!t.startsWith("--"))
            continue;
        const eq = t.indexOf("=");
        if (eq > -1) {
            out[t.slice(2, eq)] = t.slice(eq + 1);
        }
        else {
            const key = t.slice(2);
            const next = argv[i + 1];
            if (next && !next.startsWith("--")) {
                out[key] = next;
                i++;
            }
            else {
                out[key] = true;
            }
        }
    }
    return out;
}
function getOptString(args, key) {
    const v = args[key];
    return typeof v === "string" ? v.trim().replace(/^['"]|['"]$/g, "") : undefined;
}
async function main() {
    const args = parseArgs();
    const provider = (0, utils_1.makeProvider)();
    const wallet = (0, utils_1.makeWallet)(provider);
    const me = await wallet.getAddress();
    const tokensArg = getOptString(args, "tokens") ?? process.env.ARB_REF_TOKENS ?? "ARB,WETH";
    const tokenKeys = tokensArg.split(",").map(utils_1.asTrimmedString).filter(Boolean);
    const spenderRaw = getOptString(args, "spender") ?? (process.env.ROUTER_ADDRESS || "").trim();
    if (!spenderRaw)
        throw new Error("Missing --spender and ROUTER_ADDRESS.");
    const spender = (0, utils_1.toAddress)(spenderRaw);
    console.log("EOA:", me);
    console.log("Revoke spender:", spender);
    console.log("Tokens:", tokenKeys.join(", "));
    const eth = await provider.getBalance(me);
    console.log(`ETH: ${ethers_1.ethers.formatEther(eth)} ETH`);
    for (const key of tokenKeys) {
        let tokenAddr;
        if ((0, utils_1.isHex40)(key))
            tokenAddr = ethers_1.ethers.getAddress(key);
        else
            tokenAddr = utils_1.TOKENS_LC[key.toLowerCase()];
        if (!tokenAddr) {
            console.log(`- ${key}: unknown symbol (add to TOKENS_LC or pass 0x address)`);
            continue;
        }
        const erc20 = new ethers_1.ethers.Contract(tokenAddr, utils_1.ERC20_ABI, wallet);
        const [sym, dp, current] = await Promise.all([
            erc20.symbol().catch(() => "ERC20"),
            erc20.decimals().catch(() => 18),
            erc20.allowance(me, spender).catch(() => 0n),
        ]);
        console.log(`- ${key} -> ${tokenAddr} (${sym}, ${dp} dp)`);
        console.log(`  current allowance : ${current} (${(0, utils_1.formatUnitsSafe)(current, Number(dp))})`);
        if (current === 0n) {
            console.log(`  ✔ already zero`);
            continue;
        }
        const tx = await erc20.approve(spender, 0n);
        console.log(`  → sent ${tx.hash}`);
        const rc = await tx.wait();
        console.log(`  ✓ confirmed in block ${rc?.blockNumber}`);
    }
}
main().catch((e) => {
    console.error(e);
    process.exit(1);
});
