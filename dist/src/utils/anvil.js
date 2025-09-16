"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureLocalFork = ensureLocalFork;
exports.setAutomine = setAutomine;
exports.mineOne = mineOne;
exports.snapshot = snapshot;
exports.revertTo = revertTo;
exports.impersonate = impersonate;
exports.stopImpersonate = stopImpersonate;
exports.setBalance = setBalance;
exports.setNonce = setNonce;
async function rawRpc(provider, method, params = []) {
    const url = typeof provider === "string" ? provider : provider._getConnection().url;
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
    const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
    });
    if (!res.ok)
        throw new Error(`RPC ${method} failed: HTTP ${res.status}`);
    const json = await res.json();
    if (json.error)
        throw new Error(`RPC ${method} error: ${JSON.stringify(json.error)}`);
    return json.result;
}
async function ensureLocalFork(p) {
    const chainIdHex = await p.send("eth_chainId", []);
    const chainId = Number(chainIdHex);
    if (chainId !== 42161) {
        console.warn(`[anvil] Warning: chainId=${chainId} (expected 42161 Arbitrum One). You may be forking another chain.`);
    }
    try {
        const v = await p.send("web3_clientVersion", []);
        console.log(`[anvil] node=${v}`);
    }
    catch { }
}
async function setAutomine(p, on) {
    try {
        await p.send("anvil_setAutoMine", [on]);
        return;
    }
    catch { }
    try {
        await p.send("evm_setAutomine", [on]);
        return;
    }
    catch { }
    console.warn("[anvil] Could not set automine flag (anvil_setAutoMine/evm_setAutomine unsupported).");
}
async function mineOne(p) {
    try {
        await p.send("anvil_mine", []);
        return;
    }
    catch { }
    try {
        await p.send("evm_mine", []);
        return;
    }
    catch { }
    console.warn("[anvil] Could not mine (anvil_mine/evm_mine unavailable).");
}
async function snapshot(p) {
    try {
        return await p.send("evm_snapshot", []);
    }
    catch (e) {
        throw new Error(`snapshot failed: ${String(e?.message || e)}`);
    }
}
async function revertTo(p, snapId) {
    try {
        return await p.send("evm_revert", [snapId]);
    }
    catch (e) {
        throw new Error(`revert failed: ${String(e?.message || e)}`);
    }
}
async function impersonate(p, addr) {
    try {
        await p.send("anvil_impersonateAccount", [addr]);
        return;
    }
    catch { }
    try {
        await p.send("hardhat_impersonateAccount", [addr]);
        return;
    }
    catch { }
    throw new Error("impersonate not supported by node");
}
async function stopImpersonate(p, addr) {
    try {
        await p.send("anvil_stopImpersonatingAccount", [addr]);
        return;
    }
    catch { }
    try {
        await p.send("hardhat_stopImpersonatingAccount", [addr]);
        return;
    }
    catch { }
    // not fatal
}
function toHexWei(v) {
    if (typeof v === "bigint")
        return "0x" + v.toString(16);
    if (/^0x/i.test(v))
        return v;
    // decimal string -> hex
    return "0x" + BigInt(v).toString(16);
}
async function setBalance(p, addr, wei) {
    const hex = toHexWei(wei);
    try {
        await p.send("anvil_setBalance", [addr, hex]);
        return;
    }
    catch { }
    try {
        await p.send("hardhat_setBalance", [addr, hex]);
        return;
    }
    catch { }
    // last resort: raw rpc (some nodes accept it)
    await rawRpc(p, "anvil_setBalance", [addr, hex]);
}
async function setNonce(p, addr, nonceNumber) {
    const hexNonce = "0x" + BigInt(nonceNumber).toString(16);
    try {
        await p.send("anvil_setNonce", [addr, hexNonce]);
        return;
    }
    catch { }
    try {
        await p.send("hardhat_setNonce", [addr, hexNonce]);
        return;
    }
    catch { }
    // If not supported, we let eth_sendTransaction with explicit nonce handle it.
}
