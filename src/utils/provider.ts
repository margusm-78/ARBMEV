import 'dotenv/config';
import { ethers } from 'ethers';

export function makeProvider(): ethers.Provider {
  const url =
    process.env.ANVIL_URL ||
    process.env.ARB_RPC_URL ||
    process.env.ARB_RPC_URL_BACKUP;

  if (!url) throw new Error('Set ANVIL_URL or ARB_RPC_URL');
  // Force Arbitrum One chain id in dev
  return new ethers.JsonRpcProvider(url, { name: 'arbitrum', chainId: 42161 });
}
