import 'dotenv/config';
import { ethers } from 'ethers';

async function tryProvider(url: string) {
  // Force Arbitrum One chain id for sanity in dev
  const provider = new ethers.JsonRpcProvider(url, { name: 'arbitrum', chainId: 42161 });
  const chainIdHex = await provider.send('eth_chainId', []);
  const net = await provider.getNetwork();
  return { provider, chainIdHex, net };
}

async function main() {
  const candidates = [
    process.env.ANVIL_URL,
    process.env.ARB_RPC_URL,
    process.env.ARB_RPC_URL_BACKUP,
  ].filter(Boolean) as string[];

  if (candidates.length === 0) {
    throw new Error('No RPCs configured. Set ANVIL_URL or ARB_RPC_URL (or ARB_RPC_URL_BACKUP).');
  }

  let chosen: { provider: ethers.JsonRpcProvider; chainIdHex: string; net: any } | null = null;

  for (const url of candidates) {
    try {
      console.log(`Probing ${url} ...`);
      const r = await tryProvider(url);
      chosen = r;
      console.log(`✔ Connected to ${url}`);
      break;
    } catch (e) {
      console.warn(`✖ Failed to connect ${url}: ${(e as Error).message}`);
      continue;
    }
  }

  if (!chosen) {
    throw new Error('Could not connect to any configured RPC (ANVIL_URL / ARB_RPC_URL / ARB_RPC_URL_BACKUP).');
  }

  const { provider, chainIdHex, net } = chosen;
  console.log('eth_chainId:', chainIdHex);
  console.log('getNetwork.chainId:', net.chainId.toString());

  if (net.chainId !== 42161n) {
    throw new Error(`Expected Arbitrum One (42161), got ${net.chainId.toString()}`);
  }

  // Optional Arbitrum precompile: ArbSys (0x64)
  const ARBSYS = '0x0000000000000000000000000000000000000064';
  const abi = ['function arbBlockNumber() view returns (uint256)'];
  try {
    const c = new ethers.Contract(ARBSYS, abi, provider);
    const arbBn: bigint = await c.arbBlockNumber();
    console.log('ArbSys.arbBlockNumber():', arbBn.toString());
  } catch (e) {
    console.warn('ArbSys check skipped/failed:', (e as Error).message);
  }

  const WETH  = process.env.TOKEN_WETH        || '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1';
  const USDCn = process.env.TOKEN_USDC_NATIVE || '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
  const USDCe = process.env.TOKEN_USDC_E      || '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8';

  for (const [label, addr] of [['WETH', WETH], ['USDC(native)', USDCn], ['USDC.e', USDCe]] as const) {
    const code = await provider.getCode(addr);
    console.log(`${label} @ ${addr} codeSize=${(code.length - 2) / 2} bytes`);
  }

  console.log('✅ RPC is reachable and chain is Arbitrum One (42161).');
}

main().catch((e) => { console.error(e); process.exit(1); });
