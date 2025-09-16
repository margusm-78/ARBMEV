"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const SRC_DIR = path_1.default.resolve("src");
function walk(dir, acc = []) {
    const ents = fs_1.default.readdirSync(dir, { withFileTypes: true });
    for (const e of ents) {
        const p = path_1.default.join(dir, e.name);
        if (e.isDirectory())
            walk(p, acc);
        else if (/\.(ts|tsx)$/.test(e.name))
            acc.push(p);
    }
    return acc;
}
function ensureImports(src, filePath) {
    const hasInterfaceAbi = /from\s+["']ethers["']/.test(src) && /InterfaceAbi/.test(src);
    const hasHelper = /from\s+["'][.\/].*abi-helpers["']/.test(src) && /asInterfaceAbi/.test(src);
    let out = src;
    const rel = path_1.default.relative(path_1.default.dirname(filePath), path_1.default.resolve("src/abi/abi-helpers")).replace(/\\/g, "/");
    const helperImport = `import { asInterfaceAbi } from "${rel.startsWith(".") ? rel : "./" + rel}";\n`;
    if (!hasInterfaceAbi)
        out = `import type { InterfaceAbi } from "ethers";\n` + out;
    if (!hasHelper)
        out = helperImport + out;
    return out;
}
function fixOne(file) {
    let src = fs_1.default.readFileSync(file, "utf8");
    const before = src;
    if (!/new\s+ethers\.Contract\(/.test(src))
        return;
    // Enforce InterfaceAbi for any "*Abi" identifier
    src = src.replace(/new\s+ethers\.Contract\(\s*([^,]+),\s*([A-Za-z0-9_]+Abi)\s*,/g, (_m, a1, a2) => `new ethers.Contract(${a1}, asInterfaceAbi(${a2}) as InterfaceAbi,`);
    if (src !== before) {
        src = ensureImports(src, file);
        fs_1.default.writeFileSync(file, src, "utf8");
        console.log("patched:", path_1.default.relative(process.cwd(), file));
    }
}
walk(SRC_DIR).forEach(fixOne);
console.log("done.");
