# SPEC.md — hermes-workspace design record

The durable "why" behind the codebase. Pairs with `CLAUDE.md` (how to work in
the repo) and `AGENTS.md` (the swarm runtime contract). Update this when an
architectural decision changes.

## 1. Purpose

hermes-workspace is the operator surface for **Hermes Agent**: a single app for
chatting with agents, orchestrating multi-agent work (conductor + swarm),
driving terminals/files, managing MCP servers, scheduling jobs/cron, and an
embedded HermesWorld playground. It is a thin operator client over the local
hermes-agent **gateway** — it holds UI/session state, not model state.

## 2. Topology

The app is served three ways, all rendering the same TanStack Start build:

- **`vite dev`** — development; also auto-starts the local gateway.
- **`server-entry.js`** — the built SSR server (Node `http`), the production web
  surface (localhost by default; refuses non-loopback `HOST` without a password).
- **Electron** (`electron/main.cjs` → `prod-server.cjs`) — the desktop shell,
  which serves the same SSR build on a local port.

A request flows: **browser → SSR/page route → `/api/*` server route →
`src/server/*` logic → hermes-agent gateway (127.0.0.1:8642)**. The renderer
never talks to the gateway directly; the `/api` layer is the only egress and the
only auth boundary.

## 3. Layering

`routes` (pages + `/api` handlers) → `screens` (features) → `components`/`hooks`
(shared UI/logic) → `stores` (zustand) and `lib` (pure domain + API clients) →
`server` (server-only logic) → gateway. Pure logic lives in `lib`; React-free
server logic in `server`; the `lib/*-api.ts` clients are the only place that
hand-rolls fetch (with timeouts, abort, and defensive response normalization,
because gateway responses are treated as untrusted).

## 4. Security model

- **Auth is deny-by-default.** Every `/api` route must enforce auth
  (`requireAuth`/`isAuthenticated`/`requireLocalOrAuth`) or be explicitly listed
  as public; `src/server/__tests__/api-auth-coverage.test.ts` fails CI if a new
  route is neither. Sessions are an httpOnly + `SameSite=Strict` `claude-auth`
  cookie (file-backed token store, 0600). No credentials in localStorage.
- **Password gate.** When `HERMES_PASSWORD` is set, auth is enforced; with no
  password, `isAuthenticated` is permissive but `server-entry.js` refuses to
  bind a non-loopback `HOST`, so a network-exposed instance must have a password.
- **Hardening.** Static handlers confine to the client dir (no path traversal);
  installers download-verify-execute over pinned TLS; the desktop IPC surface
  (`window.hermesDesktop`) is typed and feature-detected.

## 5. Quality bar (the ecosystem standard)

Quality is **enforced in CI**, not aspirational:

- **Strict TypeScript** — `strict` + `noUnusedLocals` + `noUnusedParameters` +
  `noUncheckedIndexedAccess`; **no explicit `any`** (lint rule).
- **Lint/format** — eslint `--max-warnings 0`, prettier `--check`.
- **Tests** — vitest with a coverage ratchet; real-fs server tests; Playwright
  e2e with a stubbed gateway.
- **Ratchets** — file-size budget (600 LOC default; over-budget files baselined,
  may only shrink), debt-marker ceiling, jscpd duplication threshold (<4%).
- **Parity** — `agents/<id>/README` mirrors `swarm.yaml` (enforced by test);
  `swarm.yaml` is the single source of truth for the worker roster.

## 6. Known shape / deliberate choices

- **`ChatMessage` carries an index signature** (`[key: string]: unknown`) plus
  explicit known fields — the chat surface tolerates server-payload variance
  while keeping the hot fields typed.
- **Some screens are previews/mocks** (agora = BETA + mock room; echo-studio =
  non-functional design preview) and are labeled as such in-source.
- **The conductor replaced the old "agent-hub" gateway UI**; the dead island was
  removed. `knip` is advisory-only here — r3f JSX intrinsics and build-time deps
  produce false positives that would make it a noisy gate.

## 7. Open / roadmap

- Coverage is enforced but low (UI/route/store surface largely untested) — the
  ratchet is set to guard against regression and ratchet up over time.
- Several god-files (>2.5k LOC: playground-world-3d, chat-composer, conductor,
  settings) are budget-locked pending decomposition.
