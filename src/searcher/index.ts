import 'dotenv/config';
import { ethers } from 'ethers';
import { makeProvider } from '../utils/provider';
import { quoteEthToUsdc } from '../sim/price';

async function main() {
  const provider = makeProvider();
  const me = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);
  const addr = await me.getAddress();
  const net = await provider.getNetwork();
  console.log('=== ARBITRUM PREFLIGHT ===');
  console.log('Account:', addr);
  console.log('Chain:', net.chainId.toString());

  const out = await quoteEthToUsdc(provider as any, ethers.parseEther('0.1'));
  console.log('Quoter ok:', out.amountOutFormatted, 'USDC → looks good');
}

main().catch((e) => { console.error(e); process.exit(1); });
