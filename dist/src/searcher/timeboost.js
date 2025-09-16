"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendWithTimeboostStub = sendWithTimeboostStub;
const resilientProvider_1 = require("./resilientProvider");
/**
 * Minimal stub that just sends the signed raw tx via the rotating HTTP provider.
 * Keeps the signature used elsewhere: (provider, signedTx, bidWei) -> txHash
 */
async function sendWithTimeboostStub(_provider, signedTx, _bidWei) {
    const hash = await resilientProvider_1.RP.withProvider(async (p) => {
        const h = (await p.send("eth_sendRawTransaction", [signedTx]));
        return h;
    });
    return String(hash);
}
