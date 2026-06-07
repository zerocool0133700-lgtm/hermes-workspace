import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

/**
 * Parity guard: the per-agent docs under agents/<id>/README.md are a
 * hand-maintained mirror of swarm.yaml (the single source of truth). This test
 * fails if they drift — every worker must have a README, every README dir must
 * map to a worker, and each README must list the worker's profile/tools/skills.
 * Edit swarm.yaml + the matching README together.
 */

const ROOT = process.cwd()
const SWARM_YAML = join(ROOT, 'swarm.yaml')
const AGENTS_DIR = join(ROOT, 'agents')

interface SwarmWorker {
  id: string
  profile?: string
  modes?: Array<string>
  tools?: Array<string>
  skills?: Array<string>
}

function loadWorkers(): Array<SwarmWorker> {
  const doc = parse(readFileSync(SWARM_YAML, 'utf8')) as {
    workers?: Array<SwarmWorker>
  }
  return doc.workers ?? []
}

function agentReadmeDirs(): Array<string> {
  return readdirSync(AGENTS_DIR).filter((entry) => {
    const full = join(AGENTS_DIR, entry)
    return statSync(full).isDirectory() && existsSync(join(full, 'README.md'))
  })
}

const workers = loadWorkers()

describe('agents/ ↔ swarm.yaml parity', () => {
  it('swarm.yaml defines at least one worker', () => {
    expect(workers.length).toBeGreaterThan(0)
  })

  it('every swarm.yaml worker has an agents/<id>/README.md', () => {
    const missing = workers
      .filter((w) => !existsSync(join(AGENTS_DIR, w.id, 'README.md')))
      .map((w) => w.id)
    expect(missing).toEqual([])
  })

  it('every agents/<dir> maps to a swarm.yaml worker', () => {
    const ids = new Set(workers.map((w) => w.id))
    const orphans = agentReadmeDirs().filter((dir) => !ids.has(dir))
    expect(orphans).toEqual([])
  })

  it.each(workers.map((w) => [w.id, w] as const))(
    'agents/%s/README mirrors swarm.yaml profile/tools/skills',
    (id, worker) => {
      const readme = readFileSync(join(AGENTS_DIR, id, 'README.md'), 'utf8')
      if (worker.profile) expect(readme).toContain(worker.profile)
      for (const tool of worker.tools ?? []) {
        expect(readme, `${id} README missing tool "${tool}"`).toContain(tool)
      }
      for (const skill of worker.skills ?? []) {
        expect(readme, `${id} README missing skill "${skill}"`).toContain(skill)
      }
    },
  )
})
