# CLAUDE.md

Agent-facing guide to the **hermes-workspace** codebase. Read this before
working in the repo. Pairs with `SPEC.md` (design record), `AGENTS.md` (the
swarm worker roster / runtime contract), and `CONTRIBUTING.md` (process).

## What this is

hermes-workspace is the React 19 / TanStack Start / Vite 7 / TypeScript desktop
and web workspace for **Hermes Agent** — chat, multi-agent orchestration
(conductor/swarm), terminals, files, MCP, jobs/cron, and an embedded playground.
It is served three ways: `vite dev` (dev), `server-entry.js` (the built SSR
server), and the Electron desktop shell (`electron/`). The renderer talks to its
own `/api` server routes, which proxy to the local **hermes-agent gateway**
(default `http://127.0.0.1:8642`).

Package manager: **pnpm via corepack** (`corepack pnpm <script>`). Node 22
(pinned in `.nvmrc` + `engines`).

## Build, test & quality-gate commands

```bash
corepack pnpm install --frozen-lockfile   # install (CI uses --frozen-lockfile)
corepack pnpm dev                          # vite dev server
corepack pnpm build                        # production build
corepack pnpm typecheck                    # tsc --noEmit (strict, all flags)
corepack pnpm lint                         # eslint . --max-warnings 0
corepack pnpm format:check                 # prettier --check .
corepack pnpm test                         # vitest run
corepack pnpm test:coverage                # vitest + coverage ratchet
corepack pnpm budget                       # file-size budget ratchet
corepack pnpm debt                         # TODO/FIXME/HACK ceiling
corepack pnpm dup                          # jscpd duplication threshold (<4%)
corepack pnpm e2e                          # Playwright e2e (builds + serves app)
corepack pnpm deadcode                     # knip (advisory — noisy for r3f/3D)
```

**The CI gate (`.github/workflows/ci.yml`) is enforced — not advisory.** The
`quality` job runs lint → typecheck → format:check → ratchets (budget/debt/dup)
→ test:coverage; `build` and `e2e` are separate jobs. Run the relevant commands
before committing.

## Architecture

One app, layered (see `SPEC.md` for the full design record):

- **`src/main.tsx` / `src/router.tsx`** — entry + TanStack router wiring.
- **`src/routes/`** — file-based routes. `src/routes/api/**` are the **server**
  route handlers (131 of them); the rest are page routes.
- **`src/screens/`** — feature screens (chat, conductor/gateway, swarm2,
  dashboard, playground, mcp, files, agents, settings, …).
- **`src/components/`** — shared UI.
- **`src/hooks/`** — shared React hooks.
- **`src/stores/`** — zustand stores (chat-store, mission-store, …).
- **`src/lib/`** — pure domain + the API clients (`gateway-api`, `jobs-api`,
  `cron-api`, `tasks-api`, `format-time`, `workspace-checkpoints`, …).
- **`src/server/`** — server-side logic the api routes call (auth-middleware,
  kanban-backend, swarm-\*, mcp-hub, gateway, dashboard-aggregator, …).
- **`electron/`** — desktop main/preload/prod-server (`.cjs`).
- **`server-entry.js`** — the built SSR server entry.
- **`playground-ws-worker/`** — Cloudflare-style WS worker (separate package).
- **`agents/`** — the swarm worker docs; **`swarm.yaml`** is the source of truth
  (a parity test enforces agents/<id>/README ⇄ swarm.yaml).

## Key conventions (enforced)

- **TypeScript is fully strict**: `strict` + `noUnusedLocals` +
  `noUnusedParameters` + `noUncheckedIndexedAccess`. Indexed access is
  `T | undefined` — guard it (`.at()`, `const x = arr[i]; if (x === undefined)…`,
  `?? fallback`, `Object.hasOwn`). **Never** `!` non-null assertions.
- **No explicit `any`** (`@typescript-eslint/no-explicit-any: error`). Use
  `unknown` + runtime narrowing for untrusted data; real types otherwise;
  generics for helpers.
- **Auth is deny-by-default**: every `/api` route must call an auth primitive
  (`requireAuth`/`isAuthenticated`/`requireLocalOrAuth`) or be listed in the
  `PUBLIC_API_ROUTES` allowlist — `api-auth-coverage.test.ts` fails CI otherwise.
  Auth uses an httpOnly+SameSite `claude-auth` cookie; no tokens in localStorage.
- **Network only through the `src/lib/*-api.ts` clients** (or the server
  modules) — they handle timeouts, abort, and defensive response parsing.
- **File size**: keep files under 600 LOC. Over-budget files are tracked in
  `scripts/file-size-budgets.json` and may only shrink (`pnpm budget`).
- **Tests**: vitest (`*.test.ts[x]`), real-fs server tests, mock fetch via
  `vi.stubGlobal`. e2e stubs the gateway via `page.route` (see `e2e/fixtures.ts`).

## Before you finish

1. Run the gate: `corepack pnpm lint && pnpm typecheck && pnpm format:check &&
pnpm budget && pnpm debt && pnpm dup && pnpm test:coverage && pnpm build`.
2. Branch off `main`; conventional-ish commit; PR with the template.
3. Commit trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
4. Update `CHANGELOG.md` (Unreleased) and any affected doc.
