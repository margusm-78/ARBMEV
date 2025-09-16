"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const ethers_1 = require("ethers");
const provider_1 = require("../utils/provider");
const price_1 = require("../sim/price");
async function main() {
    const provider = (0, provider_1.makeProvider)();
    const me = new ethers_1.ethers.Wallet(process.env.PRIVATE_KEY, provider);
    const addr = await me.getAddress();
    const net = await provider.getNetwork();
    console.log('=== ARBITRUM PREFLIGHT ===');
    console.log('Account:', addr);
    console.log('Chain:', net.chainId.toString());
    const out = await (0, price_1.quoteEthToUsdc)(provider, ethers_1.ethers.parseEther('0.1'));
    console.log('Quoter ok:', out.amountOutFormatted, 'USDC → looks good');
}
main().catch((e) => { console.error(e); process.exit(1); });
