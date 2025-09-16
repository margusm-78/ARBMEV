"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const ethers_1 = require("ethers");
const ERC20_ABI = [
    'function balanceOf(address) view returns (uint256)',
    'function decimals() view returns (uint8)',
];
async function main() {
    const url = process.env.ANVIL_URL ||
        process.env.ARB_RPC_URL ||
        process.env.ARB_RPC_URL_BACKUP;
    if (!url)
        throw new Error('Set ANVIL_URL or ARB_RPC_URL');
    // Force Arbitrum One params locally
    const provider = new ethers_1.ethers.JsonRpcProvider(url, { name: 'arbitrum', chainId: 42161 });
    const wallet = new ethers_1.ethers.Wallet((process.env.PRIVATE_KEY ?? '').trim(), provider);
    const addr = await wallet.getAddress();
    const WETH = (process.env.TOKEN_WETH || '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1');
    const USDCn = (process.env.TOKEN_USDC_NATIVE || process.env.TOKEN_USDC || '0xaf88d065e77c8cC2239327C5EDb3A432268e5831'); // native USDC
    const USDCe = (process.env.TOKEN_USDC_E || '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8'); // USDC.e
    const ethBal = await provider.getBalance(addr);
    const weth = new ethers_1.ethers.Contract(WETH, ERC20_ABI, provider);
    const usdcN = new ethers_1.ethers.Contract(USDCn, ERC20_ABI, provider);
    const usdcE = new ethers_1.ethers.Contract(USDCe, ERC20_ABI, provider);
    const [wethBal, wethDec] = [await weth.balanceOf(addr), await weth.decimals()];
    const [usdcNBal, usdcNDec] = [await usdcN.balanceOf(addr), await usdcN.decimals()];
    const [usdcEBal, usdcEDec] = [await usdcE.balanceOf(addr), await usdcE.decimals()];
    console.log('Address:', addr);
    console.log('ETH  :', ethers_1.ethers.formatEther(ethBal));
    console.log('WETH :', ethers_1.ethers.formatUnits(wethBal, wethDec));
    console.log('USDC :', ethers_1.ethers.formatUnits(usdcNBal, usdcNDec), '(native)');
    console.log('USDCe:', ethers_1.ethers.formatUnits(usdcEBal, usdcEDec), '(bridged)');
}
main().catch((e) => { console.error(e); process.exit(1); });
