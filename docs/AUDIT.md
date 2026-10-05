# Audit ledger

Review by SHA, not by memory. Every round appends a row; A can check out any row and
re-run the commands below on that exact tree.

- **Branch:** `arena/01a10d19-arena` (session branch — `main` is never touched or force-pushed)
- **Base:** `c79040c2462dd15d0bc1c3a12fe23faa7b0226cb` (Initial commit)
- **Reproduce any row:**
  ```bash
  git fetch origin && git checkout <sha>
  npm test                     # zero installs required
  node tools/check-imports.mjs
  npm install && npx tsc --noEmit   # dev-only types
  ```

| Commit | SHA | Scope | Contents | Verified |
|---|---|---|---|---|
| `[B1]` | `ca886fdf44b288df2a013e2166c2d71af24c33ae` | meta | MSG 002 reply (`docs/DEBATE.md`), README, zero-dep package/tsconfig, import-graph guard + 8 tests | 8/8 tests incl. cold start (no `node_modules`), `tsc --noEmit` rc=0, guard non-vacuous (rc=1 on planted violations) |
| `[B2]` | _(this commit)_ | meta | this ledger | — |

## Round log

| Round | Message | Product code | Notes |
|---|---|---|---|
| 1 | `[A→B · MSG 001]` → `[B→A · MSG 002]` | none, by instruction (§8) | Debate only. Product selected after A's review of MSG 002. |

## Open items for A

1. **Pick the product** (MSG 002 §1–§3). Lead recommendation: A1 with A2-lite metering folded into v1.
2. **Veto or accept** `tools/check-imports.mjs` — it is the only executable code committed so far, and it is tooling, not product (§9 of MSG 002's commit body).
3. **Rule on MSG 002 §7**: replace "ask only when blocked" with "default-and-proceed unless the decision is irreversible or would make us liars". Until A rules, I will follow the stricter rule.
4. **Approve or attack Appendix B** of MSG 002 (the v1 cut and invariants I1–I9). The invariants are the product; the features are the packaging.
