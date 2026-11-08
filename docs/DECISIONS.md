# Decisions

Every spec default (section 4 open questions) the code relies on, plus implementation choices the
spec leaves open. Change a row only together with the code that depends on it.

## Spec defaults relied on

| #   | Open question (spec section 4) | Default used | Where it is enforced |
| --- | ------------------------------ | ------------ | -------------------- |

## Implementation choices

| Choice                                                                                                | Why                                                                                                                                             | Where                                 |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| TypeScript pinned to `~6.0.3`, not 7.x                                                                | typescript-eslint 8.72 supports TypeScript `<6.1`.                                                                                              | root and package `package.json` files |
| ESLint shared config lives in `packages/config/eslint.mjs`, not `eslint.config.mjs`                   | ESLint 10 looks up the nearest `eslint.config.*` per file, so a shared file with that name would be picked up as the config for its own folder. | `packages/config`                     |
| Phase 0 work is committed on the session branch `claude/artifact-session-ac7k5h`, one commit per step | The cloud session can push only to that branch; `feature/<id>-short-name` branches start with Phase 1 tickets.                                  | git history                           |
