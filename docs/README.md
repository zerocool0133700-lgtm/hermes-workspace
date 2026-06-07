# Hermes Workspace — Documentation Index

This directory collects the design specs, guides, and working notes for Hermes
Workspace. Use this index to find the right doc. Where useful, entries are
marked **(canonical)** for authoritative specs/contracts, or
**(working notes)** for status reports, logs, and point-in-time material that
may go stale.

Top-level repo docs not in this folder: [`../README.md`](../README.md),
[`../AGENTS.md`](../AGENTS.md), [`../SECURITY.md`](../SECURITY.md),
[`../CHANGELOG.md`](../CHANGELOG.md),
[`../CONTRIBUTING.md`](../CONTRIBUTING.md),
[`../FEATURES-INVENTORY.md`](../FEATURES-INVENTORY.md),
[`../FUTURE-FEATURES.md`](../FUTURE-FEATURES.md). The canonical swarm worker
roster/contract is [`../swarm.yaml`](../swarm.yaml) (Zod-validated and
unit-tested); see also [`../agents/README.md`](../agents/README.md).

## Architecture & Swarm

- [swarm/README.md](./swarm/README.md) — Swarm Mode overview **(canonical entry point)**
- [swarm/ARCHITECTURE.md](./swarm/ARCHITECTURE.md) — swarm architecture & SwarmBrief shape
- [swarm/QUICKSTART.md](./swarm/QUICKSTART.md) — get a swarm running
- [swarm/ROLES.md](./swarm/ROLES.md) — worker roles & default models (mirrors `../swarm.yaml`)
- [swarm/SKILLS.md](./swarm/SKILLS.md) — skills available to swarm workers
- [swarm/AUTORESEARCH.md](./swarm/AUTORESEARCH.md) — autoresearch behavior
- [agent-authored-ui-state.md](./agent-authored-ui-state.md) — agent-authored UI state model
- [dashboard-service.md](./dashboard-service.md) — dashboard service design
- [workspace-chat-session-routing.md](./workspace-chat-session-routing.md) — chat/session routing
- [hermes-workspace-naming-contract.md](./hermes-workspace-naming-contract.md) — naming contract **(canonical)**

## Setup & Onboarding

- [docker.md](./docker.md) — Docker setup
- [windows-setup-guide.md](./windows-setup-guide.md) — Windows setup
- [AGENT-PAIRING.md](./AGENT-PAIRING.md) — pairing the workspace to a Hermes Agent
- [troubleshooting.md](./troubleshooting.md) — troubleshooting guide
- [i18n-contributing.md](./i18n-contributing.md) — contributing translations

## API, Specs & Contracts

- [claude-openai-compat-spec.md](./claude-openai-compat-spec.md) — OpenAI-compat spec **(canonical)**
- [multi-gateway-pool-spec.md](./multi-gateway-pool-spec.md) — multi-gateway pool spec
- [api-key-registry.md](./api-key-registry.md) — API-key registry & rotation checklist
- [desktop-update-system.md](./desktop-update-system.md) — desktop update system
- [tool-artifacts-context-plan.md](./tool-artifacts-context-plan.md) — tool artifacts / context plan
- [swarm2-agent-ide-spec.md](./swarm2-agent-ide-spec.md) — Swarm2 agent IDE spec
- [swarm2-autopilot-orchestration-spec.md](./swarm2-autopilot-orchestration-spec.md) — Swarm2 autopilot orchestration spec
- [swarm2-frankengpu-control-plane.md](./swarm2-frankengpu-control-plane.md) — Swarm2 FrankenGPU control plane
- [swarm2-memory-framework-spec.md](./swarm2-memory-framework-spec.md) — Swarm2 memory framework spec
- [swarm2-worker-lifecycle-compaction-spec.md](./swarm2-worker-lifecycle-compaction-spec.md) — Swarm2 worker lifecycle / compaction spec

## Design & Requirements

- [design/dirsize-tool.md](./design/dirsize-tool.md) — dirsize tool design
- [requirements/dirsize-tool.md](./requirements/dirsize-tool.md) — dirsize tool requirements

## Operations & Working Notes

- [release-2.1.0.md](./release-2.1.0.md) — v2.1.0 release notes **(working notes)**
- [conductor-bug-log.md](./conductor-bug-log.md) — Conductor bug log **(working notes)**
- [mobile-perf-report.md](./mobile-perf-report.md) — mobile performance baseline **(working notes)**

## HermesWorld / Playground (agent MMO)

In-world game and playground docs. The bulk of this set is design/lore and
**(working notes)** for an evolving project.

- [hermesworld/README.md](./hermesworld/README.md) — HermesWorld docs entry point
- [playground/README.md](./playground/README.md) — Hermes Playground overview
- [hermesworld/MASTER-PLAN.md](./hermesworld/MASTER-PLAN.md) — master plan
- [hermesworld/master-roadmap.md](./hermesworld/master-roadmap.md) — master roadmap
- [hermesworld/PUBLIC-ROADMAP.md](./hermesworld/PUBLIC-ROADMAP.md) — public roadmap
- [hermesworld/VISION-BEST-AI-MMO.md](./hermesworld/VISION-BEST-AI-MMO.md) — vision
- [hermesworld/SWARM-GAME-ARCHITECTURE.md](./hermesworld/SWARM-GAME-ARCHITECTURE.md) — game architecture
- [hermesworld/GAMEPLAY-SYSTEMS-BOUNDARIES.md](./hermesworld/GAMEPLAY-SYSTEMS-BOUNDARIES.md) — gameplay systems boundaries
- [hermesworld/INGAME-TARGET-SPEC.md](./hermesworld/INGAME-TARGET-SPEC.md) — in-game target spec
- [hermesworld/GUILD-EVENT-CONTRACTS.md](./hermesworld/GUILD-EVENT-CONTRACTS.md) — guild/event contracts
- [hermesworld/GUILDS-AGENTS-COMPANION-ECONOMY.md](./hermesworld/GUILDS-AGENTS-COMPANION-ECONOMY.md) — guilds / companion economy
- [hermesworld/AGENTIC-WOW-ROHAN-SYSTEMS.md](./hermesworld/AGENTIC-WOW-ROHAN-SYSTEMS.md) — agentic systems
- [hermesworld/AGORA-INSO-IMPLEMENTATION.md](./hermesworld/AGORA-INSO-IMPLEMENTATION.md) — Agora implementation
- [hermesworld/AGORA-INSO-ASSET-PROMPTS.md](./hermesworld/AGORA-INSO-ASSET-PROMPTS.md) — Agora asset prompts
- [hermesworld/agora-believable-checklist.md](./hermesworld/agora-believable-checklist.md) — Agora believability checklist
- [hermesworld/ART-BIBLE-REALISM-LOOP.md](./hermesworld/ART-BIBLE-REALISM-LOOP.md) — art bible
- [hermesworld/STYLE-LOCK.md](./hermesworld/STYLE-LOCK.md) — visual style lock
- [hermesworld/visual-upgrade-spec.md](./hermesworld/visual-upgrade-spec.md) — visual upgrade spec
- [hermesworld/graphics-usability-plan.md](./hermesworld/graphics-usability-plan.md) — graphics/usability plan
- [hermesworld/ASSET-GENERATION-V2-STATUS.md](./hermesworld/ASSET-GENERATION-V2-STATUS.md) — asset generation v2 status **(working notes)**
- [hermesworld/PROMPT-LIBRARY.md](./hermesworld/PROMPT-LIBRARY.md) — prompt library
- [hermesworld/CHATGPT-PROMPT-BATCH-001.md](./hermesworld/CHATGPT-PROMPT-BATCH-001.md) — prompt batch 001
- [hermesworld/game-audit-roadmap-2026-05-05.md](./hermesworld/game-audit-roadmap-2026-05-05.md) — game audit roadmap (dated) **(working notes)**
- [hermesworld/FAQ.md](./hermesworld/FAQ.md) — FAQ

### Player guides

- [hermesworld/guides/GETTING-STARTED.md](./hermesworld/guides/GETTING-STARTED.md)
- [hermesworld/guides/CONTROLS.md](./hermesworld/guides/CONTROLS.md)
- [hermesworld/guides/QUESTS.md](./hermesworld/guides/QUESTS.md)
- [hermesworld/guides/INVENTORY-CRAFTING.md](./hermesworld/guides/INVENTORY-CRAFTING.md)
- [hermesworld/guides/AGENT-COMPANIONS.md](./hermesworld/guides/AGENT-COMPANIONS.md)
- [hermesworld/guides/SOCIAL.md](./hermesworld/guides/SOCIAL.md)
- [hermesworld/guides/FOUNDERS.md](./hermesworld/guides/FOUNDERS.md)

### Lore

- [hermesworld/lore/WORLD-LORE.md](./hermesworld/lore/WORLD-LORE.md)
- [hermesworld/lore/TIMELINE.md](./hermesworld/lore/TIMELINE.md)
- [hermesworld/lore/ZONES-LORE.md](./hermesworld/lore/ZONES-LORE.md)
- [hermesworld/lore/FACTIONS-LORE.md](./hermesworld/lore/FACTIONS-LORE.md)
- [hermesworld/lore/CLASSES-LORE.md](./hermesworld/lore/CLASSES-LORE.md)
- [hermesworld/lore/SIGILS-LORE.md](./hermesworld/lore/SIGILS-LORE.md)

### Walkthroughs

- [hermesworld/walkthroughs/QUEST-001-ATHENAS-INTRO.md](./hermesworld/walkthroughs/QUEST-001-ATHENAS-INTRO.md)
- [hermesworld/walkthroughs/QUEST-002-FIRST-COMPANION.md](./hermesworld/walkthroughs/QUEST-002-FIRST-COMPANION.md)
- [hermesworld/walkthroughs/QUEST-003-FORGE-FIRST-CRAFT.md](./hermesworld/walkthroughs/QUEST-003-FORGE-FIRST-CRAFT.md)
- [hermesworld/walkthroughs/WORLD-EVENTS.md](./hermesworld/walkthroughs/WORLD-EVENTS.md)
