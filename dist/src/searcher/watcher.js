"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Watcher = void 0;
const ethers_1 = require("ethers");
const AAVE_POOL_DATA_PROVIDER_ABI = [
    { "inputs": [{ "internalType": "address", "name": "user", "type": "address" }], "name": "getUserAccountData", "outputs": [
            { "internalType": "uint256", "name": "totalCollateralBase", "type": "uint256" },
            { "internalType": "uint256", "name": "totalDebtBase", "type": "uint256" },
            { "internalType": "uint256", "name": "availableBorrowsBase", "type": "uint256" },
            { "internalType": "uint256", "name": "currentLiquidationThreshold", "type": "uint256" },
            { "internalType": "uint256", "name": "ltv", "type": "uint256" },
            { "internalType": "uint256", "name": "healthFactor", "type": "uint256" }
        ], "stateMutability": "view", "type": "function" }
];
const RADIANT_DATA_PROVIDER_ABI = AAVE_POOL_DATA_PROVIDER_ABI;
class Watcher {
    provider;
    aaveData;
    radiantData;
    users;
    constructor(provider, cfg) {
        this.provider = provider;
        if (cfg.aaveData)
            this.aaveData = new ethers_1.ethers.Contract(cfg.aaveData, AAVE_POOL_DATA_PROVIDER_ABI, provider);
        if (cfg.radiantData)
            this.radiantData = new ethers_1.ethers.Contract(cfg.radiantData, RADIANT_DATA_PROVIDER_ABI, provider);
        this.users = cfg.users;
    }
    async tick() {
        const out = [];
        for (const u of this.users) {
            if (this.aaveData) {
                try {
                    const [, , , , , hf] = await this.aaveData.getUserAccountData(u);
                    if (hf > 0n && hf < 1000000000000000000n)
                        out.push({ user: u, protocol: "aave", healthFactorRay: hf });
                }
                catch { }
            }
            if (this.radiantData) {
                try {
                    const [, , , , , hf] = await this.radiantData.getUserAccountData(u);
                    if (hf > 0n && hf < 1000000000000000000n)
                        out.push({ user: u, protocol: "radiant", healthFactorRay: hf });
                }
                catch { }
            }
        }
        return out;
    }
}
exports.Watcher = Watcher;
