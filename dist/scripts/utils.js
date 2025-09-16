"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ERC20_ABI = exports.TOKENS_LC = exports.toAddress = void 0;
exports.readFlag = readFlag;
exports.requireEnv = requireEnv;
exports.optionalEnv = optionalEnv;
exports.toAddressStrict = toAddressStrict;
exports.toAddressLenient = toAddressLenient;
exports.asTrimmedString = asTrimmedString;
exports.isHex40 = isHex40;
exports.formatUnitsSafe = formatUnitsSafe;
exports.makeProvider = makeProvider;
exports.makeWallet = makeWallet;
exports.buildTokenMap = buildTokenMap;
exports.resolveTokenOrAddress = resolveTokenOrAddress;
require("dotenv/config");
const ethers_1 = require("ethers");
/** ---------- CLI parsing (no dependencies) ---------- */
function readFlag(name) {
    const argv = process.argv.slice(2);
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === `--${name}`) {
            return argv[i + 1]; // may be undefined; caller should handle
        }
        if (a.startsWith(`--${name}=`)) {
            return a.split("=", 2)[1];
        }
    }
    return undefined;
}
/** ---------- Env & address helpers ---------- */
function requireEnv(name) {
    const v = (process.env[name] || "").trim();
    if (!v)
        throw new Error(`Missing env: ${name}`);
    return v;
}
function optionalEnv(name) {
    const v = (process.env[name] || "").trim();
    return v ? v : undefined;
}
/** Strict: require non-empty and a valid address */
function toAddressStrict(value, label) {
    const v = (value || "").trim();
    if (!v) {
        const what = label ? label : "address";
        throw new Error(`Missing ${what}. Provide --${what} or set ${what.toUpperCase()} in .env`);
    }
    if (!ethers_1.ethers.isAddress(v)) {
        throw new Error(`Invalid ${label ?? "address"}: ${JSON.stringify(value)}`);
    }
    return ethers_1.ethers.getAddress(v);
}
/** Lenient: return null when not set/invalid */
function toAddressLenient(value) {
    const v = (value || "").trim();
    if (!v)
        return null;
    if (!ethers_1.ethers.isAddress(v))
        return null;
    return ethers_1.ethers.getAddress(v);
}
/** Back-compat alias expected by some scripts */
const toAddress = (v) => toAddressStrict(v);
exports.toAddress = toAddress;
/** Utility string helpers (for older scripts expecting them) */
function asTrimmedString(v) {
    return typeof v === "string" ? v.trim() : String(v ?? "").trim();
}
function isHex40(v) {
    const s = asTrimmedString(v);
    return /^0x[a-fA-F0-9]{40}$/.test(s);
}
/** Format BigInt with decimals safely */
function formatUnitsSafe(value, decimals) {
    // ethers v6 handles BigInt fine
    return ethers_1.ethers.formatUnits(value, decimals);
}
/** ---------- Provider & wallet ---------- */
function makeProvider() {
    const url = requireEnv("ARB_RPC_URL");
    return new ethers_1.ethers.JsonRpcProvider(url, { name: "arbitrum", chainId: 42161 });
}
function makeWallet(p) {
    const pk = requireEnv("PRIVATE_KEY");
    return new ethers_1.ethers.Wallet(pk.startsWith("0x") ? pk : `0x${pk}`, p ?? makeProvider());
}
/** ---------- Tokens map from .env (symbols -> addresses) ---------- */
function buildTokenMap() {
    const m = {};
    const add = (sym, envName) => {
        const v = optionalEnv(envName);
        if (v && ethers_1.ethers.isAddress(v))
            m[sym.toUpperCase()] = ethers_1.ethers.getAddress(v);
    };
    add("WETH", "WETH");
    add("ARB", "ARB");
    add("USDC", "USDC");
    add("USDCE", "USDCe"); // alias
    return m;
}
/** Lowercase-keyed tokens map for back-compat (TOKENS_LC) */
exports.TOKENS_LC = (() => {
    const upper = buildTokenMap();
    const out = {};
    for (const [k, v] of Object.entries(upper))
        out[k.toLowerCase()] = v;
    return out;
})();
/**
 * Resolve either a symbol ("ARB","WETH") or a raw address.
 * Accepts unknown to avoid strict-narrowing to `never`.
 */
function resolveTokenOrAddress(input, tokenMap, label = "token") {
    const s = typeof input === "string" ? input.trim() : String(input ?? "").trim();
    if (!s)
        throw new Error(`Empty ${label} entry`);
    if (ethers_1.ethers.isAddress(s))
        return ethers_1.ethers.getAddress(s);
    // force string ops to avoid 'never' complaints
    const k = (s + "").toUpperCase();
    const addr = tokenMap[k] ?? exports.TOKENS_LC[k.toLowerCase()];
    if (!addr) {
        throw new Error(`Unknown ${label} symbol "${s}". Add ${k}=0x... to .env or pass a full address.`);
    }
    return addr;
}
/** Minimal ERC20 ABI */
exports.ERC20_ABI = [
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)",
    "function balanceOf(address owner) view returns (uint256)",
    "function allowance(address owner, address spender) view returns (uint256)",
    "function approve(address spender, uint256 amount) returns (bool)",
];
