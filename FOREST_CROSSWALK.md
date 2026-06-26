# LE Forest Crosswalk: Dev vs. Proving Ground

**Generated:** 2026-05-05 21:40 CST  
**Scope:** Comparing scope hierarchies between the two Forest instances to seed proving ground and resolve semantic overlap.

---

## Executive Summary

|| Metric | Dev Forest | Proving Ground | Status |
||--------|-----------|-----------------|--------|
|| **Total scopes** | 172 | 911 | PG heavily loaded with test data |
|| **Common scopes** | — | 4 (`2`, `2/4`, `E`, `S`) | Foundational system scopes |
|| **Unique to Dev** | 168 scopes | — | Rich hierarchy not yet in PG |
|| **Unique to PG** | — | 907 scopes | Mostly test/analyzer scaffolding |

**Key Finding:** The two forests have **radically different scope structures**. The Dev forest is lean with semantic business hierarchy. The Proving Ground is heavily instrumented with test data. **The S (Sasha) scope is already seeded in PG** — suggesting agent scopes (E=Ellie, S=Sasha) are being actively populated.

The crosswalk reveals that Dave needs to either:

1. **Seed PG with the core Dev scope structure** (let tests accumulate separately), or
2. **Consolidate test/analyzer scopes into a dedicated test root** before production cutover

---

## Detailed Crosswalk

### ✓ Common Scopes (Both Forests)

These scopes exist in both and are structurally aligned:

|| Path | Dev Name | PG Name | Type |
||------|----------|---------|------|
|| `2` | Projects | Projects | Shared root |
|| `2/4` | ellie-os-app | Workshop Host | Project (redefined in PG) |
|| `E` | Ellie | Ellie | Person/Agent |
|| `S` | Sasha | Sasha | Person/Agent |

**Notes:**
- `2` is the project root in both systems
- `2/4` diverges semantically: Dev="ellie-os-app", PG="Workshop Host" — these may be intentionally different
- `E` and `S` are agent scopes in both, with parallel branch structures (soul, identity, memory, relationships, sessions, skills)
- S scope in PG contains: S/soul, S/identity, S/memory, S/sessions, S/skills, S/relationships (7 total)

---

### → Dev-Only Scopes (Need Seeding into PG)

The **Dev forest has 169 scopes** not yet in Proving Ground. These form the core business semantics of the system. **Priority tiers for seeding:**

#### Tier 1: Core Projects & People (MUST HAVE)

| Dev Path | Name | Type | PG Status |
|----------|------|------|-----------|
| `1` | Global | Root scope | ❌ Missing |
| `2/1` | ellie-dev | Project | ❌ Missing |
| `2/1/1` | relay | Subsystem | ❌ Missing |
| `2/1/2` | agents | Subsystem | ❌ Missing |
| `2/1/3` | memory | Subsystem | ❌ Missing |
| `2/1/4` | integrations | Subsystem | ❌ Missing |
| `2/1/5` | context | Subsystem | ❌ Missing |
| `2/2` | ellie-forest | Project | ❌ Missing |
| `2/2/1` | trees | Subsystem | ❌ Missing |
| `2/2/2` | branches | Subsystem | ❌ Missing |
| `2/3` | ellie-home | Project | ❌ Missing |
| `2/4/1` | mobile | Feature (under ellie-os-app) | ❌ Missing |
| `2/4/2` | ui | Feature (under ellie-os-app) | ❌ Missing |
| `2/5` | ellie-life | Project | ❌ Missing |
| `2/6` | ellie-learn | Project | ❌ Missing |
| `2/7` | ellie-work | Project | ❌ Missing |
| `2/8` | ellie-pro | Project | ❌ Missing |
| `3` | Agents | Agent root | ❌ Missing |
| `3/alan` | Alan (Agent) | Person | ❌ Missing |
| `3/amy` | Amy (Agent) | Person | ❌ Missing |
| `3/brian` | Brian (Agent) | Person | ❌ Missing |
| `3/ellie` | Ellie (Agent) | Person | ❌ Missing |
| `3/james` | James (Agent) | Person | ❌ Missing |
| `3/jason` | Jason (Agent) | Person | ❌ Missing |
| `3/kate` | Kate (Agent) | Person | ❌ Missing |
| `3/marcus` | Marcus (Agent) | Person | ❌ Missing |
| `E/1` | Soul | Entity | ❌ Missing |
| `E/2` | Species | Category | ❌ Missing |
| `E/3` | Roles | Capability | ❌ Missing |
| `E/4` | Relationships | Connection | ✓ Exists (E/relationships in PG) |
| `E/5` | Adaptations | Capability | ❌ Missing |
| `E/6` | Growth | Trajectory | ❌ Missing |

**Seed Impact:** ~42 foundational scopes that represent the core operational structure of Ellie OS and Dave's team.

#### Tier 2: Special Systems (Capture These)

| Dev Path | Name | Type | Notes |
|----------|------|------|-------|
| `C` | Capability | Root | Agent capability framework |
| `C/1-4` | Perf/Lineage/Archive/Capacity | Categories | Decision and performance tracking |
| `J` | Jobs — The Workshop | Root | Execution framework |
| `J/1-5` | Definitions/Execution/Trails/Patterns/Governance | Categories | Operational taxonomy |
| `L` | Land | Root | Property/venue scope (White River NF) |
| `R` | River — The Oak Bridge | Root | Knowledge indexing/catalog |
| `Y` | You | Root | Dave's personal forest (distinct from `E` = Ellie) |

**Seed Impact:** ~30+ scopes representing decision systems, execution patterns, and personal knowledge.

#### Tier 3: Formations & Tests (Optional)

Dev has `2/formations/*` with multiple test formation scopes. These are integration test artifacts and can be seeded selectively or rebuilt from test harnesses. PG already has `test/analyzer/*` (400+ scopes) so this may be redundant.

---

### PG-Only Scopes (Status, Consider Consolidation)

PG has **908 scopes** not in Dev. These fall into three categories:

#### Category 1: Intentional PG-Specific Architecture
| Path | Name | Purpose | Keep? |
|------|------|---------|-------|
| `A/*` | Agents (80 scopes) | Per-agent scope hierarchy for contracts | ✓ Yes — contract org |
| `K1-K6` | Knowledge domains | Architecture, patterns, decisions, etc. | ✓ Yes — semantic org |
| `0/*` | Land/OS messaging | Infrastructure scope | ✓ Yes — system roots |
| `land/lake`, `land/mountain` | Component infrastructure | Mountain/Lake components | ✓ Yes — engine roots |
| `M` | Max | Coordination engine scope | ✓ Yes — operational |

**Decision:** Keep these. They serve the Contract Builder's organizational model and don't conflict with Dev scopes.

#### Category 2: Test Scaffolding (SHOULD CONSOLIDATE)

- `test/analyzer/*` (400+ scopes) — isolated test runs
- `test-bind-*` (20+ scopes) — binding tests
- `test/` root scopes

**Decision:** These are valuable during development but should migrate to a `_test` or `archive/` root before production. They clutter the scope tree.

#### Category 3: Multi-Tenant User Forests (REMOVE OR ARCHIVE)

- `U/*` (400+ scopes) — Personal user forests (test invitations, embed users, etc.)

**Decision:** Archive or prune these. They're test fixtures and don't represent real users.

---

## Seed Plan: Bridging the Gap

### Phase 1: Core Structure (IMMEDIATE)

Seed into PG's Contract Builder forest:

```sql
-- Root scopes
1              Global
2/1            ellie-dev (+ subsystems 1-5)
2/2            ellie-forest (+ subsystems 1-5)
2/3            ellie-home
2/5-2/8        ellie-life, ellie-learn, ellie-work, ellie-pro

-- Agent root
3              Agents
3/alan .. 3/marcus    Individual agents (8 scopes)

-- Ellie entity breakdown
E/1-E/6        Soul, Species, Roles, Relationships, Adaptations, Growth
```

**Count:** ~42 scopes  
**Effort:** SQL seed data (migrations or direct insert + seeding service)  
**Validation:** Verify paths exist and are readable via forest-bridge after seeding  

### Phase 2: Special Systems (NEXT ITERATION)

```
C         Capability framework (4 scopes)
J         Jobs/Workshop (5 scopes)
L         Land / White River NF (5 scopes)
R         River / Oak Bridge (1-2 scopes)
Y         You / Dave's forest (8 scopes)
```

**Count:** ~25 scopes  
**Effort:** Coordinate with Dave on scope_type definitions for each  

### Phase 3: Housekeeping (OPTIONAL)

- Rename `test/analyzer/*` → `archive/test-analyzer/*` in PG
- Archive `U/*` user forests under `archive/test-users/*`
- Move `test-bind-*` to `_test/binding/*`

**Benefit:** Cleans up the scope tree for operational clarity.

---

## Recommendations

1. **Run the seed immediately** after this assessment. Tier 1 scopes (42) are quick to load and unlock semantic consistency between forests.

2. **Keep both forests running independently** until the migration is complete. This provides a safety net — if PG data gets corrupted, Dev forest is still authoritative.

3. **Update bridge key documentation** to clarify which scopes route to which forest. Currently both bridges are wired, but queries may resolve ambiguously if scopes exist in both.

4. **After seeding Phase 1**, consider a **unified query protocol** that transparently routes `2/1*` queries to either forest based on document type (operational vs. analytical).

5. **Archive/consolidate test scopes** in PG before cutover to production to avoid test bleed into operational queries.

---

## File Locations for Implementation

- **Dev Forest Seeds:** `/home/ellie/ellie-dev/packages/server/src/seeds/knowledge-scopes.ts` (or equivalent)
- **PG Seeds:** `/home/ellie/ellie-proving-ground/packages/server/src/contract-builder/seed-scopes/` (or migrations)
- **Forest Bridge Keys:**
  - Dev: `bk_d81869ef1556947b38376429ab2d9752ec0ed2799dc85d968532a6e740f6577a`
  - PG: `bk_346631a8edafd15e90f7212aa485e5968b964e1c711022d887d7f541832c5037`

