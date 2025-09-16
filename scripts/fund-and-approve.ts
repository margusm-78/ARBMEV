// scripts/fund-and-approve.ts
import 'dotenv/config';
import { ethers } from 'ethers';

/* ---------- Utils ---------- */
function normalizePk(raw?: string): string {
  const pk = (raw ?? '').trim().toLowerCase().replace(/^0x+/, '');
  if (!pk || pk.length !== 64 || !/^[0-9a-f]+$/.test(pk)) {
    throw new Error(`PRIVATE_KEY must be 32 bytes hex (64 chars), got length=${pk.length}`);
  }
  return '0x' + pk;
}
function cleanAddr(a: string) { return a.toLowerCase().replace(/^0x/, ''); }
function fee3Bytes(fee: number) { return fee.toString(16).padStart(6, '0'); }
function encodePath2Hop(a: string, feeAB: number, b: string, feeBC: number, c: string): string {
  return '0x' + cleanAddr(a) + fee3Bytes(feeAB) + cleanAddr(b) + fee3Bytes(feeBC) + cleanAddr(c);
}

/* ---------- Provider (Arbitrum One) ---------- */
const provider = new ethers.JsonRpcProvider(
  process.env.ANVIL_URL || 'http://127.0.0.1:8545',
  { name: 'arbitrum', chainId: 42161 }
);

/* ---------- Addresses (lowercased to avoid checksum issues) ---------- */
const WETH        = (process.env.TOKEN_WETH        || '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1').toLowerCase();
const USDC_NATIVE = (process.env.TOKEN_USDC        || process.env.TOKEN_USDC_NATIVE || '0xaf88d065e77c8cC2239327C5EDb3A432268e5831').toLowerCase();
const USDC_E      = (process.env.TOKEN_USDC_E      || '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8').toLowerCase();
const USDT        = (process.env.TOKEN_USDT        || '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9').toLowerCase();

const QUOTER_V2   = (process.env.UNISWAP_V3_QUOTER_V2 || '0x61fFE014bA17989E743c5F6cB21bF9697530B21e').toLowerCase();
const V3_ROUTER   = (process.env.UNISWAP_V3_ROUTER    || '0xE592427A0AEce92De3Edee1F18E0157C05861564').toLowerCase();
const SUSHI_V2_ROUTER   = (process.env.SUSHI_V2_ROUTER   || '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506').toLowerCase();
const CAMELOT_V2_ROUTER = (process.env.CAMELOT_V2_ROUTER || '0xc873fEcbD354f5A56E00E710B90Ef4201db2448d').toLowerCase();

/* ---------- Config ---------- */
const WETH_IN       = process.env.WETH_IN || '2';
const SLIPPAGE_BPS  = Number(process.env.SLIPPAGE_BPS || 1000); // 10%
const FEES          = [500, 3000, 10000] as const;

/* ---------- ABIs ---------- */
const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function approve(address,uint256) returns (bool)',
  'function allowance(address,address) view returns (uint256)',
] as const;

const WETH9_ABI = [
  'function deposit() payable',
  'function approve(address,uint256) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
] as const;

const QUOTER_V2_ABI = [
  'function quoteExactInputSingle((address tokenIn,address tokenOut,uint24 fee,uint256 amountIn,uint160 sqrtPriceLimitX96)) view returns (uint256 amountOut, uint160, uint32, uint256)',
  'function quoteExactInput(bytes path) view returns (uint256 amountOut, uint160, uint32, uint256)'
] as const;

const V3_ROUTER_ABI = [
  'function exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160)) payable returns (uint256)',
  'function exactInput((bytes,address,uint256,uint256,uint256)) payable returns (uint256)'
] as const;

const V2_ROUTER_ABI = [
  'function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)',
  'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)'
] as const;

/* ---------- Quote helpers ---------- */
async function quoteV3Best(amountIn: bigint, targetStable: string) {
  const quoter = new ethers.Contract(QUOTER_V2, QUOTER_V2_ABI, provider);
  let best:
    | { dex: 'V3', kind: 'single', fee: number, amountOut: bigint, tokenOut: string }
    | { dex: 'V3', kind: 'multi',  feeAB: number, feeBC: number, amountOut: bigint, tokenOut: string }
    | null = null;

  // single-hop
  for (const fee of FEES) {
    try {
      const params = { tokenIn: WETH, tokenOut: targetStable, fee, amountIn, sqrtPriceLimitX96: 0n };
      const [out] = await quoter.quoteExactInputSingle(params);
      if (!best || out > best.amountOut) best = { dex: 'V3', kind: 'single', fee, amountOut: out, tokenOut: targetStable };
    } catch {}
  }
  // two-hop via USDT
  for (const feeAB of FEES) for (const feeBC of FEES) {
    try {
      const path = encodePath2Hop(WETH, feeAB, USDT, feeBC, targetStable);
      const [out] = await quoter.quoteExactInput(path);
      if (!best || out > best.amountOut) best = { dex: 'V3', kind: 'multi', feeAB, feeBC, amountOut: out, tokenOut: targetStable };
    } catch {}
  }

  return best;
}

async function quoteV2(routerAddr: string, amountIn: bigint, path: string[]) {
  const r = new ethers.Contract(routerAddr, V2_ROUTER_ABI, provider);
  try {
    const amounts: bigint[] = await r.getAmountsOut(amountIn, path);
    return amounts[amounts.length - 1];
  } catch {
    return 0n;
  }
}

async function quoteV2Best(amountIn: bigint) {
  const candidates: { router: string; path: string[]; label: string; }[] = [
    { router: SUSHI_V2_ROUTER,   path: [WETH, USDC_NATIVE],          label: 'Sushi V2 WETH→USDC' },
    { router: SUSHI_V2_ROUTER,   path: [WETH, USDT, USDC_NATIVE],    label: 'Sushi V2 WETH→USDT→USDC' },
    { router: SUSHI_V2_ROUTER,   path: [WETH, USDC_E],               label: 'Sushi V2 WETH→USDC.e' },
    { router: SUSHI_V2_ROUTER,   path: [WETH, USDT, USDC_E],         label: 'Sushi V2 WETH→USDT→USDC.e' },
    { router: CAMELOT_V2_ROUTER, path: [WETH, USDC_NATIVE],          label: 'Camelot V2 WETH→USDC' },
    { router: CAMELOT_V2_ROUTER, path: [WETH, USDT, USDC_NATIVE],    label: 'Camelot V2 WETH→USDT→USDC' },
    { router: CAMELOT_V2_ROUTER, path: [WETH, USDC_E],               label: 'Camelot V2 WETH→USDC.e' },
    { router: CAMELOT_V2_ROUTER, path: [WETH, USDT, USDC_E],         label: 'Camelot V2 WETH→USDT→USDC.e' },
  ];

  let best: null | { router: string, path: string[], label: string, amountOut: bigint } = null;
  for (const c of candidates) {
    const out = await quoteV2(c.router, amountIn, c.path);
    if (out > 0n && (!best || out > best.amountOut)) best = { router: c.router, path: c.path, label: c.label, amountOut: out };
  }
  return best;
}

/* ---------- Main ---------- */
async function main() {
  const sys = await provider.getSigner(0);
  const wallet = new ethers.Wallet(normalizePk(process.env.PRIVATE_KEY), provider);
  const addr = await wallet.getAddress();

  console.log('Anvil sys:', await sys.getAddress(), ' Target:', addr);

  // Give gas
  await provider.send('anvil_setBalance', [addr, '0x56BC75E2D63100000']); // 100 ETH

  // Get a baseline nonce (pending)
  let nonce = await provider.getTransactionCount(addr, 'pending');

  // 1) Wrap ETH -> WETH (with explicit nonce)
  const weth = new ethers.Contract(WETH, WETH9_ABI, wallet);
  const amountIn = ethers.parseEther(WETH_IN);
  console.log(`Wrapping ${WETH_IN} ETH to WETH...`);
  await (await weth.deposit({ value: amountIn, nonce: nonce++ })).wait();

  // 2) Quote V3 (native then e)
  console.log('Quoting Uniswap V3 routes...');
  let bestV3 = await quoteV3Best(amountIn, USDC_NATIVE);
  if (!bestV3) bestV3 = await quoteV3Best(amountIn, USDC_E);

  // 3) Quote V2 (Sushi/Camelot)
  console.log('Quoting V2 (Sushi/Camelot) routes...');
  const bestV2 = await quoteV2Best(amountIn);

  // 4) Choose best
  type Choice =
    | { which: 'V3-single', fee: number, amountOut: bigint, tokenOut: string }
    | { which: 'V3-multi',  feeAB: number, feeBC: number, amountOut: bigint, tokenOut: string }
    | { which: 'V2', router: string, path: string[], label: string, amountOut: bigint };

  let choice: Choice | null = null;
  if (bestV3 && (!bestV2 || bestV3.amountOut >= bestV2.amountOut)) {
    choice = bestV3.kind === 'single'
      ? { which: 'V3-single', fee: (bestV3 as any).fee, amountOut: bestV3.amountOut, tokenOut: bestV3.tokenOut }
      : { which: 'V3-multi',  feeAB: (bestV3 as any).feeAB, feeBC: (bestV3 as any).feeBC, amountOut: bestV3.amountOut, tokenOut: bestV3.tokenOut };
  } else if (bestV2) {
    choice = { which: 'V2', router: bestV2.router, path: bestV2.path, label: bestV2.label, amountOut: bestV2.amountOut };
  }
  if (!choice) throw new Error('No viable route on V3 or V2 — try a newer fork block or increase WETH_IN.');

  const outDecimals = 6; // USDC/USDC.e
  const minOut = (choice.amountOut * BigInt(10000 - SLIPPAGE_BPS)) / 10000n;
  console.log(`Best route: ${choice.which === 'V2' ? (choice as any).label : choice.which} | quoted ≈ ${(Number(choice.amountOut)/(10**outDecimals)).toFixed(2)} USDC(e), minOut=${minOut}`);

  // 5) Approve ONLY the chosen router, with explicit nonce
  if (choice.which.startsWith('V3')) {
    console.log('Approving Uniswap V3 router to spend WETH...');
    await (await weth.approve(V3_ROUTER, ethers.MaxUint256, { nonce: nonce++ })).wait();
  } else {
    const routerAddr = (choice as any).router;
    console.log(`Approving V2 router to spend WETH: ${routerAddr}`);
    await (await weth.approve(routerAddr, ethers.MaxUint256, { nonce: nonce++ })).wait();
  }

  // 6) Execute the swap (explicit nonce)
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);

  if (choice.which === 'V3-single') {
    const router = new ethers.Contract(V3_ROUTER, V3_ROUTER_ABI, wallet);
    const params = [ WETH, (choice as any).tokenOut, (choice as any).fee, addr, deadline, amountIn, minOut, 0n ];
    console.log('Swapping on Uniswap V3 (exactInputSingle)...');
    await (await router.exactInputSingle(params, { value: 0n, nonce: nonce++ })).wait();
  } else if (choice.which === 'V3-multi') {
    const router = new ethers.Contract(V3_ROUTER, V3_ROUTER_ABI, wallet);
    const path = encodePath2Hop(WETH, (choice as any).feeAB, USDT, (choice as any).feeBC, (choice as any).tokenOut);
    const params = [ path, addr, deadline, amountIn, minOut ];
    console.log('Swapping on Uniswap V3 (exactInput multi-hop via USDT)...');
    await (await router.exactInput(params, { value: 0n, nonce: nonce++ })).wait();
  } else {
    const router = new ethers.Contract((choice as any).router, V2_ROUTER_ABI, wallet);
    console.log(`Swapping on V2 router: ${ (choice as any).router } ...`);
    await (await router.swapExactTokensForTokens(
      amountIn, minOut, (choice as any).path, addr, Number(deadline), { nonce: nonce++ }
    )).wait();
  }

  // 7) Approve V3 router for the resulting stable so later code can spend it (explicit nonce)
  const tokenOutFinal = (choice.which === 'V2') ? (choice as any).path.slice(-1)[0] : (choice as any).tokenOut;
  const stable = new ethers.Contract(tokenOutFinal, ERC20_ABI, wallet);
  const allowance: bigint = await stable.allowance(addr, V3_ROUTER);
  if (allowance < ethers.MaxUint256 / 2n) {
    console.log('Approving Uniswap V3 router for stable (MaxUint256)...');
    await (await stable.approve(V3_ROUTER, ethers.MaxUint256, { nonce: nonce++ })).wait();
  }

  const dec = 6;
  const bal: bigint = await (new ethers.Contract(tokenOutFinal, ERC20_ABI, provider)).balanceOf(addr);
  console.log(`Stable balance now: ${Number(bal) / 10 ** dec} — Done.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
