# Hermes Roadmap

> **Status:** Working draft — started by Claude, to be refined together.
> **Purpose:** Get the whole Hermes vision out of our heads and into one place, so we can prioritize and start writing specs.
> **How to read this:** This is a *consolidation* draft. I pulled it together from `README.md`, `FUTURE-FEATURES.md`, and `docs/hermesworld/master-roadmap.md`. Anything marked **[ASSUMPTION]** is my inference — correct it. Anything in the **Decisions I need from you** block is a real fork in the road I can't resolve alone.

---

## 0. Decisions I need from you (read this first)

These shape everything below. We don't have to answer all of them now, but the top two unblock the most.

1. **What's the headline goal for the next push?** Three plausible answers, and they pull in different directions:
   - **(A) Agent Factory** — make autonomous overnight multi-agent builds reliable (the `FUTURE-FEATURES` direction).
   - **(B) HermesWorld** — make the playable human+agent world premium and agent-operable.
   - **(C) Workspace hardening** — polish the shipped command center, close the Conductor upstream gap, ship the desktop app.
2. **Who is this for?** Personal tool / open-source product / hosted SaaS — or all three on a timeline? (README shows sponsors + ghcr images + a "cloud coming soon," which reads like *OSS product now, hosted later*. **[ASSUMPTION]**)
3. **Does Hermes integrate with the Ellie/Forest ecosystem, or stay standalone?** There's a `FOREST_CROSSWALK.md` in this repo and your whole machine is Ellie/Forest. Is Hermes meant to plug into Forest (memory/identity/scopes), or is it a clean-room product?
4. **Upstream posture.** v2 is "clone, don't fork" on `NousResearch/hermes-agent`. Conductor already needs an upstream plugin that isn't merged (#262). How much do we build *on top of* upstream vs. ship our own plugins/patches when upstream lags?
5. **Single-user vs. multi-tenant — and when?** Team collaboration and hosted both imply multi-tenant. That's a large architectural fork; the sooner we know the timing, the cheaper it is.

---

## 1. North star

**Hermes is the command center *and* the world for AI agents.** One place where a human can chat with agents, browse their memory and skills, run a terminal, orchestrate a swarm, and — increasingly — watch and direct that work as a living, playable world.

Three pillars, one product:

| Pillar | One-liner | Maturity |
|---|---|---|
| **Workspace** | The agent command center (chat, files, memory, skills, terminal, dashboard). | Shipped (v2.1.3) |
| **Swarm / Agent Factory** | Many agents, one orchestrator, zero humans manually dispatching — reliable autonomous builds. | Partially built |
| **HermesWorld** | A persistent RPG/MMO layer where humans and agents move, talk, quest, and progress. | Experimental |

The bet: these aren't three products. The Workspace is the control plane, the Swarm is the engine, and HermesWorld is the *visible, playable surface* over both — agent work made legible (and eventually, agent benchmarking made into a battle loop).

---

## 2. Where we are today (the baseline we build on)

So the roadmap doesn't re-list shipped work as "future":

**Shipped ✅**
- Chat with SSE streaming, tool-call rendering, multi-session, markdown + syntax highlighting
- Memory browser/editor; Skills browser (2,000+ with origin badges, filters, marketplace)
- MCP page (catalog + marketplace + sources) with local-config fallback
- Files + Monaco editor; cross-platform PTY terminal
- Operations (multi-agent dashboard, persona presets: Sage/Trader/Builder/Scribe/Ops)
- Agent View (live agent panel in chat: avatar, queue, history, usage meter)
- Swarm Mode (persistent tmux-backed workers, role-based dispatch, review gate)
- Dashboard (sessions, model mix, cost ledger, attention card, ops strip)
- Themes (Hermes/Nous/Bronze/Slate/Mono, light + dark)
- Security (auth on every route, CSP, path-traversal guard, fail-closed remote bind)
- Distribution: PWA + Tailscale, Docker Compose, ghcr images, multi-provider

**In progress 🔨**
- **Conductor** missions — UI shipped, blocked on an upstream dashboard plugin (#262)
- **Native desktop app** (Electron) — spec'd; PWA path works today

**Architecture facts to keep in mind**
- Runs on vanilla `NousResearch/hermes-agent` (zero-fork). Gateway `:8642` (OpenAI-compatible) + dashboard `:9119` (sessions/skills/memory/config/jobs).
- Frontend: TanStack Start, React 19, pnpm. Profile system (active profile dir, not `~/.hermes`).
- Capability gating: features needing upstream endpoints degrade to a clean placeholder instead of failing mid-action. **This is a pattern worth reusing everywhere.**

---

## 3. The roadmap, by horizon

Framing: **Now** (this sprint), **Next** (this quarter-ish), **Later** (vision). Each item tagged with its pillar: `[W]` Workspace · `[S]` Swarm · `[HW]` HermesWorld · `[X]` Cross-cutting.

### Now — finish what's in flight, remove the biggest blockers
- `[W]` **Close the Conductor gap.** Either land the upstream dashboard plugin or ship our own so missions work end-to-end (not just placeholder). Decide build-vs-wait. (#262)
- `[S]` **Iterative refinement loop.** Verification retries (tsc → fix → re-run, max N, then escalate). `FUTURE-FEATURES` calls this the single highest-leverage reliability fix. **[low effort, high impact]**
- `[S]` **Rollback on checkpoint rejection.** Auto-revert to pre-task git state so a rejected checkpoint doesn't poison the next agent. **[low effort]**
- `[HW]` **Truthful analytics + admin surface.** Private admin panel; never count NPC/bot chatter as human users; reconnect/churn signal.
- `[X]` **Decide single-user vs multi-tenant timing** (Decision #5) — it gates desktop, cloud, and team work.

### Next — make the engine reliable and the world premium
- `[S]` **Agent handoffs.** Structured context passing between agents (git diff, error log, what was built/skipped) so overnight runs stay coherent.
- `[S]` **Specialized agent roles.** Researcher → Planner → Builder → Validator → Deployer, instead of one generic adapter.
- `[S]` **Parallel guardrails.** tsc/test watchers running *alongside* the agent, not just at checkpoints.
- `[W]` **Native desktop app (Electron).** Tray, OS notifications for agent/mission events, auto-launch, deep OS integration.
- `[HW]` **Deterministic agent action layer.** A world API both the human UI and agents call — `move_to`, `talk_to`, `accept_quest`, `complete_objective`, `equip`, `travel`, `attack`, `loot`, `rest`. Server-validated, returns structured state diffs. (No agents clicking DOM nodes.)
- `[HW]` **Visual + chat polish pass.** Per-zone lighting/landmarks, premium HUD, human-vs-NPC chat separation.
- `[X]` **Persistence ladder.** localStorage → dashboard/plugin-backed profile → account/cloud profile. Pick how far we go now.

### Later — autonomy, scale, and the playable benchmark
- `[S]` **Context-aware tool selection.** Route by task type/size/context (big refactor → Codex; surgical fix → Claude session; research → web search).
- `[S]` **Session persistence surfaced to agents** + **progressive skill loading** + **portable SKILL.md skills marketplace.**
- `[HW]` **Agent takeover + offline progression.** Hand control to an agent with a bounded goal/budget/allowlist; it keeps progressing while you sleep; you get a summarized event log on return. No irreversible public actions without approval.
- `[HW]` **Agent-vs-agent battle loop as evals.** Arena match = structured eval; scoring blends result/speed/cost/quality; rewards map back to workspace abilities. HermesWorld becomes a *visible benchmarking layer*, not a toy.
- `[W]/[X]` **Cloud / hosted + team collaboration.** Managed uptime, cross-device sync, shared memory/workspaces, webhook/external triggers, multi-tenant.

---

## 4. Cross-cutting concerns (true for every pillar)

- **Identity & profiles** — durable player/agent identity beyond localStorage; ties into persistence ladder and (maybe) Forest scopes. *(Open: Decision #3.)*
- **Security & multi-tenancy** — current model is single-tenant + fail-closed remote. Team/cloud forces real tenant isolation. Don't bolt it on late.
- **Upstream dependency management** — formalize the "capability gate + placeholder" pattern as policy: every upstream-dependent feature ships a graceful fallback, and we track which need our own plugin.
- **Distribution matrix** — PWA, Electron, Docker, ghcr, cloud. Each new surface multiplies test/release cost; decide which are first-class.
- **Analytics truth model** — one event taxonomy (human presence/chat, NPC ambient, agent actions, churn, quest, combat) shared by Workspace dashboard *and* HermesWorld admin.

---

## 5. Spec backlog — candidates to write *today*

Ordered by my read of leverage. Pick one (or reorder) and I'll start the spec via the brainstorming → spec → plan flow.

1. **Iterative Refinement Loop spec** `[S]` — small, high-impact, well-scoped. Great first spec to prove the pipeline.
2. **Conductor end-to-end spec** `[W]` — decide build-our-own-plugin vs wait-for-upstream, then spec the missions flow.
3. **Deterministic Agent Action Layer spec** `[HW]` — the foundation everything agent-operable in HermesWorld depends on; worth specifying early even if built later.
4. **Agent Handoff protocol spec** `[S]` — the structured-context contract between roles.
5. **Persistence ladder spec** `[X]` — profile storage stages + the migration path between them.

---

## 6. Open threads / parking lot
- `FOREST_CROSSWALK.md` lives in this repo but is really an Ellie/Forest scope-migration analysis. Decide if Hermes↔Forest integration is in-scope (Decision #3); if not, that doc should move out.
- "Eric / Aurora" own the HermesWorld roadmap; reconcile ownership/naming with how we want this consolidated doc attributed.
- Cloud infra is the gating dependency for both hosted and team features — nothing in that lane moves until it exists.

---

_Next step: tell me which Decision-block answers you can give, and which spec from §5 to start. I'll take it from there._
