#!/usr/bin/env node
/**
 * File-size budget ratchet.
 *
 * Every src/*.{ts,tsx} (excluding tests + generated) must stay under
 * DEFAULT_BUDGET lines, OR be recorded in scripts/file-size-budgets.json with a
 * per-file ceiling. Recorded ceilings may only SHRINK — run with `--write` to
 * regenerate the baseline (it lowers existing entries to current size, drops
 * files now under budget, and adds any new over-budget files for review).
 *
 *   node scripts/file-size-budget.mjs          # check (CI)
 *   node scripts/file-size-budget.mjs --write  # ratchet the baseline down
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const BUDGETS_FILE = join(ROOT, 'scripts', 'file-size-budgets.json')
const DEFAULT_BUDGET = 600

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      out.push(...walk(full))
    } else if (
      (entry.endsWith('.ts') || entry.endsWith('.tsx')) &&
      !entry.includes('.test.') &&
      !entry.endsWith('.d.ts') &&
      entry !== 'routeTree.gen.ts'
    ) {
      out.push(full)
    }
  }
  return out
}

const loc = (file) => readFileSync(file, 'utf8').split('\n').length
const write = process.argv.includes('--write')

let budgets = {}
try {
  budgets = JSON.parse(readFileSync(BUDGETS_FILE, 'utf8'))
} catch {
  budgets = {}
}

const files = walk(SRC).map((f) => ({ rel: relative(ROOT, f), lines: loc(f) }))

if (write) {
  const next = {}
  for (const { rel, lines } of files) {
    if (lines <= DEFAULT_BUDGET) continue
    const prior = budgets[rel]
    // Only shrink: keep the lower of prior ceiling and current size.
    next[rel] = prior === undefined ? lines : Math.min(prior, lines)
  }
  writeFileSync(BUDGETS_FILE, JSON.stringify(next, null, 2) + '\n')
  console.log(
    `Wrote ${Object.keys(next).length} over-budget entries to ${relative(ROOT, BUDGETS_FILE)}`,
  )
  process.exit(0)
}

let failed = false
for (const { rel, lines } of files) {
  const ceiling = budgets[rel] ?? DEFAULT_BUDGET
  if (lines > ceiling) {
    failed = true
    console.error(
      `✗ ${rel}: ${lines} LOC exceeds ${budgets[rel] !== undefined ? 'recorded ceiling' : 'default budget'} of ${ceiling}`,
    )
  }
}
// Stale entries: a tracked file that dropped under default should be removed.
const present = new Set(files.map((f) => f.rel))
for (const rel of Object.keys(budgets)) {
  const cur = files.find((f) => f.rel === rel)
  if (!present.has(rel) || (cur && cur.lines <= DEFAULT_BUDGET)) {
    failed = true
    console.error(
      `✗ ${rel}: stale budget entry — file removed or now under budget; run --write`,
    )
  }
}

if (failed) {
  console.error('\nFile-size budget check failed. Split the file, or run')
  console.error(
    '`node scripts/file-size-budget.mjs --write` if a shrink is real.',
  )
  process.exit(1)
}
console.log(
  `File-size budget OK (${files.length} files; ${Object.keys(budgets).length} over the ${DEFAULT_BUDGET}-LOC default, all within ceiling).`,
)
