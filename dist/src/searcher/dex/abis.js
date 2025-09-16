"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UNIV3_FACTORY_ABI = exports.UNIV3_QUOTER_V2_ABI = exports.UNIV2_ROUTER_ABI = exports.ERC20_ABI = void 0;
// src/searcher/dex/abis.ts
// Minimal ABIs (Ethers v6 compatible fragments)
exports.ERC20_ABI = [
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)",
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address owner, address spender) view returns (uint256)",
    "function approve(address spender, uint256 value) returns (bool)"
];
// Uniswap V2-style Router (Camelot V2-compatible)
exports.UNIV2_ROUTER_ABI = [
    "function getAmountsOut(uint256 amountIn, address[] memory path) view returns (uint256[] memory amounts)",
    "function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) returns (uint256[] memory amounts)",
    // supporting-fee functions are not required for quoting
];
// Uniswap V3 QuoterV2 (preferred)
exports.UNIV3_QUOTER_V2_ABI = [
    "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut,uint160 sqrtPriceX96After,int24 initializedTicksCrossed,uint256 gasEstimate)",
    "function quoteExactOutputSingle((address tokenIn,address tokenOut,uint256 amountOut,uint24 fee,uint160 sqrtPriceLimitX96)) external returns (uint256 amountIn,uint160 sqrtPriceX96After,int24 initializedTicksCrossed,uint256 gasEstimate)"
];
// Uniswap V3 Factory for pool discovery
exports.UNIV3_FACTORY_ABI = [
    "function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address)"
];
