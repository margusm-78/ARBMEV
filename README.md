# ARB MEV — Anvil Fork + Local Simulation

**Goal:** run your MEV scanner/bot against a *local Anvil fork* of Arbitrum to reduce Alchemy CU usage, debug quickly, and simulate safely.

## Quickstart

1) Install deps
```bash
pnpm i
cp .env.example .env
# fill ARB_RPC_URL (or ANVIL_FORK_URL), PRIVATE_KEY, tokens if needed
```

2) Start an Anvil fork (new terminal)
```bash
pnpm anvil:arb
```
3) Seed balances & approvals (optional)
```bash
pnpm anvil:impersonate
```

4) Run a one-off simulation
```bash
pnpm sim:scan-once
```

5) Or loop
```bash
pnpm sim:loop
```

## Provider resolution

- If `ANVIL_URL` is set, all scripts will talk to local Anvil.
- Otherwise they use `ARB_RPC_URL` then `ARB_RPC_URL_BACKUP`.

## Notes

- Use `ANVIL_FORK_BLOCK` to get reproducible runs.
- Script `fund-and-approve.ts` uses `anvil_impersonateAccount` to move test USDC to your target account.
