# Changelog

All notable changes to Hermes Workspace are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- **Enforced CI quality gate** — lint (`--max-warnings 0`), strict typecheck, prettier check, file-size/debt/duplication ratchets, and a coverage-ratcheted test run, plus separate build and Playwright e2e jobs. Node pinned, frozen lockfile.
- **Deny-by-default API auth** — a `requireAuth` guard plus an `api-auth-coverage` test that fails CI if any `/api` route is neither guarded nor allowlisted; closed the events-SSE / swarm-kanban / playground-admin gaps.
- **Tests** — coverage for the API clients (gateway/cron/tasks), the streaming hook, send-stream validation, and an agents↔swarm.yaml parity test; `@vitest/coverage-v8` ratchet.
- **House docs** — `CLAUDE.md` (agent/dev guide) and `SPEC.md` (design record).

### Changed

- **Type-safety hardened to the ecosystem bar** — `noUnusedLocals`, `noUnusedParameters`, and `noUncheckedIndexedAccess` enabled (614 issues fixed type-honestly), and **explicit `any` banned** (228 occurrences replaced with real types).
- **Security** — path-traversal guard in the desktop static server; installers now download-verify-execute over pinned TLS; removed a dead localStorage token field.
- **Cruft purge** — stopped committing the 300k-line generated bundle and deleted ~16.5k LOC of proven-dead gateway code; consolidated `formatRelativeTime` (fixing a crew-screen ms-vs-seconds bug); refactored gateway-api onto a shared request helper.
- **`docker compose up` now pulls pre-built images by default** (#82) — `nousresearch/hermes-agent:latest` for the gateway and `ghcr.io/outsourc-e/hermes-workspace:latest` for the UI. Agent state persists in the `claude-data` named volume. Adds `docker-compose.dev.yml` overlay for building from source.

## [2.3.0] — 2026-05-07

### Added

- **SciFi theme** — full dark + light variants with Tailwind v4 token remaps (#303, #320)
- **HermesWorld** expansion — hosted runtime embed, brand asset pack, MJ asset wiring, photosensitive safety mode, public name-reservation/claim flow, speech bubbles + toasts, Founders Vault inventory skeleton, and Wave Chat RPG panels (#365, #366, #367, #369, #374, #383)
- **Workspace ↔ Hermes Kanban** integration — unified task board on the Hermes Kanban backend, kanban-plugin capability detection, dashboard deep-link, and proxy mode with 5s polling (#311, #348)
- **HTML preview mode** in the file browser (#296)
- **Inline artifact cards** in chat, including local MEDIA artifacts rendered inline (#295, #328, #349)
- **MCP marketplace** offset-based pagination for search (#325)
- **`VITE_HERMESWORLD_ENABLED`** env var to optionally hide the HermesWorld link (#322)
- **Groq STT controls** in workspace settings (#347)
- **VT Capital** guardian OMS cockpit (#364)
- HermesWorld bible, player guides, and guild/event/economy data contracts; dirsize tool requirement + design docs (#338, #368)

### Changed

- **Tasks backend auto-detection** between `hermes-tasks` and `claude-tasks` (#361)
- Operations model picker now merges in Hermes models (#342)
- "Hermes updated" modal shows only once per release (#386)
- Docker Compose now starts the Hermes Agent gateway (#385)

### Fixed

- Cross-session response contamination and `/new` opening a previous chat (#297, #300)
- Workspace session identity preserved during streams; sends scoped to the active workspace (#310, #340, #343)
- Terminal PTY kept alive across SSE disconnects with auto-reattach (#298)
- Swarm process spawning stabilized; tmux startup failures preserved; prompt submission hardened (#302, #307, #341)
- Jobs API response shape normalized to always return `{ jobs: [] }`; structured error bodies rendered as readable text (#162, #304, #305)
- Added `kimi-k2.6` 256k context-window support (#357)
- Legacy `claude-workspace` / `claude-agent` remote aliases for the update checker (#306, #359)
- Codex OAuth tokens bridged to portable-mode chat bearer auth (#332)
- Gateway recovery from disconnected state sped up; config capability fields reported correctly (#275, #318)
- Conductor falls back when the dashboard mission API is unavailable; mission goals sanitized before spawn (#317, #335)

## [2.2.0] — 2026-05-04

### Added

- **Premium dashboard rebuild** — hero metrics, analytics + logs widgets, sessions intelligence with server-side insights, provider-mix donut, cache-efficiency tile, cost ledger / velocity menu, attention card, edit mode, and contextual Operator Tip card
- **HermesWorld playground** — rebranded from Playground, with premium title screen, training-grounds onboarding loop, quests/gear/action bar, ASCII NPC portraits, cinematic camera, mouse camera controls, offline-first NPC dialog, and a featured nav slot with gold NEW badge
- **Multiplayer for the playground** — Cloudflare Hibernation-API WebSocket hub with HTTP-polling fallback, cross-device support out of the box, speech bubbles, and MP diagnostics
- **Custom OpenAI-compatible providers** — settings UI for custom endpoints with API-key management, stored in `.env` with base_url in config (#287)
- **Matrix** dark/light theme (#279)
- **Japanese (ja)** locale translations (#290)
- `HERMES_TMUX_BIN` override for non-standard tmux installs (#244)

### Changed

- Search "chats" scope now matches derived title/preview, not just session id; recent-search history is real localStorage-backed (#291, #292)

### Fixed

- Vite dev proxy port and `/cron` route link corrected; `/api/sessions` probe pointed at the dashboard URL with auth header (#283)
- Connection-status returns the full capabilities payload in dev (#285)
- Update banner shows full block reason, repo path, and blocking files (#293)
- Startup warning when Secure cookies would break plain-HTTP LAN login (#281)
- Clean repos realign to remote on update (#901ffcd5)

## [2.1.3] — 2026-05-01

### Added

- Configurable SSE activity timeouts via env vars, with heartbeat to keep long silent agent runs alive (#195)
- API dashboard fallback for `createSession`, `updateSession`, and `forkSession`

### Changed

- **Branding pass** — removed all visible Claude / "Project Workspace" labels and restored Hermes naming across UI and GitHub surfaces
- `RUNS_ROOT` and related paths consistently routed through `getHermesRoot()` / `HERMES_HOME` to avoid double-nesting

### Fixed

- Login screen now shown before the onboarding wizard on fresh devices (#180)
- Memory listing scans only canonical paths (#177)
- SSR onboarding component crash and routed-surface blocking when the backend is ready
- Terminal `sessionId` cleared on PTY close/exit so input/resize stop 404ing (#80, #155)
- Approval banner wired to the real store instead of a no-op stub
- Pairing accepts both Hermes and dashboard session-token names; local-only sessions deletable in portable mode
- Russian locale strings added
- Default model always pinned first in the `/api/models` response

## [2.1.2] — 2026-04-03

Re-tagged release identical in content to 2.1.1 (no source changes; tree matches 2.1.1).

## [2.1.1] — 2026-05-01

### Added

- **Swarm v1 surface** — `/swarm` office UI with Inbox, Auto/Manual mode toggle, Add-Swarm presets, switchable role chips, embedded routing plan, and checkpoints routed through the orchestrator
- **Operations** (`/operations`) and **Conductor** (`/conductor`) screens ported from Clawsuite, wired to Hermes profiles + the job runner; bundled `workspace-dispatch` skill
- **Docker images on GHCR** — `hermes-workspace` published to GHCR; compose defaults to pre-built images (#82, #83)
- Chat quality-of-life: resizable content column (#89, #112), Enter-as-newline toggle (#90, #110), optional hover-to-expand collapsed sidebar (#115), opt-in finish sound (#148), sort sessions by last activity with preview fallback titles (#98)
- UI-side backend URL override with no restart required (#101, #113)
- Multi-gateway pool design spec and agent-pairing/Tailscale remote-setup docs (#108, #134)

### Changed

- Default theme set to Hermes Nous
- `$HERMES_HOME` honored instead of hardcoding `~/.hermes`; `PORT` env var respected by the dev server (#105, #109)
- Mobile nav: Conductor and Operations added to the hamburger menu

### Fixed

- **Auth/files/deployment defaults hardened** (#121–#125, #133); dashboard auth no longer falls back to `HERMES_API_TOKEN` (#146); token store written with `chmod 0600` (#102)
- Multi-profile config awareness, YAML parsing, and deep-merge `saveConfig` to prevent data loss (#85, #106, #119)
- Chat-width setting and tied-timestamp history order respected (#139, #150)
- New chat no longer loads previous session history; IME composition Enter no longer submits (#97, #99)
- Skills Hub search bundled fallback; MCP servers loaded from dashboard config (#151, #152)
- Installer hardened for local Hermes API with PEP 668 detection and gateway auto-recovery (#79)

## [2.1.0] — 2026-04-03

### Added

- **Portable mode** — chat works against a vanilla gateway with no fork, via an OpenAI-compatible streaming backend abstraction, local thread persistence, and portable-first onboarding
- Expandable tool cards, advanced-screen capability gating, and vision/multimodal support

### Fixed

- Streaming pipeline: tool-data preservation, duplicate-message suppression, and stale streaming-text clearing
- Client-side capability detection after SSR hydration (#19)
- Bearer-token auth sent on all gateway API calls (#15)
- Clipboard fallback for insecure origins; Docker setup + troubleshooting docs (#21)

## [2.0.0] — 2026-04-20

**Zero-fork release.** Clone, don't fork. Hermes Workspace now runs on vanilla `pip install hermes-agent` with no patches, no drift, no custom gateway required.

### Added

- **Zero-fork architecture** — dual gateway/dashboard routing; workspace talks directly to vanilla `hermes-agent` 0.10.0+ via standard endpoints (`/v1/models`, `/api/sessions`, `/api/skills`, `/api/config`, `/api/jobs`)
- **One-liner curl installer** — `curl -fsSL … | bash` provisions workspace + gateway + defaults
- **Claude-Nous theme** — dark + light editorial variants with cobalt/paper surface pass, thin 1px architectural borders, editorial type accents
- **Conductor** (`/conductor`) — mission-control surface ported from Clawsuite; spawn missions, assign workers, watch live output and costs
- **Operations** (`/operations`) — agent registry / sessions manager ported from Clawsuite; pause, steer, kill live agents with role and model insight
- **Synthesized tool pills** — inline tool-call rendering from dashboard stream markers when running against zero-fork gateway
- **Landing parity pass** — hero, features, screenshots, setup, OG image, mobile theme toggle
- **Task board status vs. assignee** decoupling
- **Local-model chat session persistence** — local sessions appear in history + session list
- **Memory is local-fs first** — honors `HERMES_HOME`, no gateway dependency
- **Splash + screenshots refresh** — Conductor, Dashboard, Tasks, Jobs captured in new editorial theme

### Changed

- **Model picker** — fetches from gateway (`~/.hermes/models.json` for user-configured models), matches OCPlatform behavior; shows only configured providers instead of all upstream
- **`enhanced-fork` mode label** no longer implies a fork is required; it indicates streaming route availability on vanilla gateway
- **Dashboard + enhanced-chat capabilities** marked optional; missing endpoints no longer trigger warnings
- **Feature-gate + install copy** — all fork-era references purged
- **Theme family allowlist** — `claude-nous` promoted to the enterprise allowlist
- **Session pill** — solid dark-mode background, matches model selector

### Fixed

- Duplicate responses and disappearing history on interrupt (#62)
- Portable-mode double user message, uncleaned timeouts, orphaned unregister callbacks
- Local model selection actually propagates to chat (no silent fallback)
- Strip provider prefix correctly for local routing
- Dashboard token injection on `/` (not `/index.html`)
- Onboarding no longer stacks behind workspace shell
- Root bootstrap guards against uncaught errors
- Preserve assistant text during tool-call streaming
- Installer output uses defined escape vars (removed undefined BOLD/RESET)

### Removed

- All references to the legacy "enhanced fork" as a requirement
- Stale fork-era gateway instructions and feature-gate copy

---

## [1.0.0] — 2026-04-10

Initial public release. Chat, files, memory, skills, terminal, dashboard, settings — the foundational workspace.
