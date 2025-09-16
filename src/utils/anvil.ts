import { ethers } from "ethers";

async function rawRpc(provider: ethers.JsonRpcProvider | string, method: string, params: any[] = []): Promise<any> {
  const url = typeof provider === "string" ? provider : (provider as any)._getConnection().url;
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  if (!res.ok) throw new Error(`RPC ${method} failed: HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(`RPC ${method} error: ${JSON.stringify(json.error)}`);
  return json.result;
}

export async function ensureLocalFork(p: ethers.JsonRpcProvider) {
  const chainIdHex = await p.send("eth_chainId", []);
  const chainId = Number(chainIdHex);
  if (chainId !== 42161) {
    console.warn(`[anvil] Warning: chainId=${chainId} (expected 42161 Arbitrum One). You may be forking another chain.`);
  }
  try {
    const v = await p.send("web3_clientVersion", []);
    console.log(`[anvil] node=${v}`);
  } catch {}
}

export async function setAutomine(p: ethers.JsonRpcProvider, on: boolean) {
  try { await p.send("anvil_setAutoMine", [on]); return; } catch {}
  try { await p.send("evm_setAutomine", [on]); return; } catch {}
  console.warn("[anvil] Could not set automine flag (anvil_setAutoMine/evm_setAutomine unsupported).");
}

export async function mineOne(p: ethers.JsonRpcProvider) {
  try { await p.send("anvil_mine", []); return; } catch {}
  try { await p.send("evm_mine", []); return; } catch {}
  console.warn("[anvil] Could not mine (anvil_mine/evm_mine unavailable).");
}

export async function snapshot(p: ethers.JsonRpcProvider): Promise<string> {
  try { return await p.send("evm_snapshot", []); }
  catch (e) { throw new Error(`snapshot failed: ${String((e as any)?.message || e)}`); }
}

export async function revertTo(p: ethers.JsonRpcProvider, snapId: string): Promise<boolean> {
  try { return await p.send("evm_revert", [snapId]); }
  catch (e) { throw new Error(`revert failed: ${String((e as any)?.message || e)}`); }
}

export async function impersonate(p: ethers.JsonRpcProvider, addr: string) {
  try { await p.send("anvil_impersonateAccount", [addr]); return; } catch {}
  try { await p.send("hardhat_impersonateAccount", [addr]); return; } catch {}
  throw new Error("impersonate not supported by node");
}

export async function stopImpersonate(p: ethers.JsonRpcProvider, addr: string) {
  try { await p.send("anvil_stopImpersonatingAccount", [addr]); return; } catch {}
  try { await p.send("hardhat_stopImpersonatingAccount", [addr]); return; } catch {}
  // not fatal
}

function toHexWei(v: string | bigint): string {
  if (typeof v === "bigint") return "0x" + v.toString(16);
  if (/^0x/i.test(v)) return v;
  // decimal string -> hex
  return "0x" + BigInt(v).toString(16);
}

export async function setBalance(p: ethers.JsonRpcProvider, addr: string, wei: string | bigint) {
  const hex = toHexWei(wei);
  try { await p.send("anvil_setBalance", [addr, hex]); return; } catch {}
  try { await p.send("hardhat_setBalance", [addr, hex]); return; } catch {}
  // last resort: raw rpc (some nodes accept it)
  await rawRpc(p, "anvil_setBalance", [addr, hex]);
}

export async function setNonce(p: ethers.JsonRpcProvider, addr: string, nonceNumber: number) {
  const hexNonce = "0x" + BigInt(nonceNumber).toString(16);
  try { await p.send("anvil_setNonce", [addr, hexNonce]); return; } catch {}
  try { await p.send("hardhat_setNonce", [addr, hexNonce]); return; } catch {}
  // If not supported, we let eth_sendTransaction with explicit nonce handle it.
}
