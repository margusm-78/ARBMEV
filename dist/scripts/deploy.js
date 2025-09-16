"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const ethers_1 = require("ethers");
const typechain_types_1 = require("../typechain-types");
// Small env helpers
function env(key) {
    const v = (process.env[key] || "").trim();
    if (!v)
        throw new Error(`Missing env: ${key}`);
    return v;
}
async function main() {
    const RPC = env("ARB_RPC_URL");
    const PK = env("PRIVATE_KEY");
    const provider = new ethers_1.ethers.JsonRpcProvider(RPC, { name: "arbitrum", chainId: 42161 });
    const wallet = new ethers_1.ethers.Wallet(PK, provider);
    const owner = await wallet.getAddress();
    console.log("Deployer:", owner);
    // Typechain factory; your router constructor expects _owner
    const factory = new typechain_types_1.ArbiSearcherRouter__factory(wallet);
    const contract = await factory.deploy(owner); // <— pass constructor arg
    await contract.waitForDeployment();
    const addr = await contract.getAddress();
    const hash = contract.deploymentTransaction()?.hash;
    console.log("Deployed ArbiSearcherRouter at:", addr);
    if (hash)
        console.log("Deployment tx:", hash);
}
main().catch((e) => {
    console.error(e);
    process.exit(1);
});
