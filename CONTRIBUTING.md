# Contributing

Hotbar is MIT licensed. Contributions use a Developer Certificate of Origin sign-off (`Signed-off-by: Name <email>`), not a CLA. Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/).

## Working agreement

Build milestone by milestone. Do not start milestone N+1 until milestone N's "done when" in `plan.md` passes. Shared protocol types live in `packages/shared`. Screens are built once in `apps/ui` against the `DataSource` abstraction. Game servers are children of the agent, never of the Electron process.

Every agent route needs a permission check. Mutations write an activity-log row. Do not pass a command string through a shell.

## Checks

```bash
pnpm install
pnpm --filter @hotbar/shared build
pnpm typecheck
pnpm test
```

`pnpm test` covers template validation, the path jail, a hand-registered process (start, console, stop), and a check that quitting Electron leaves that process running.
