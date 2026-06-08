#!/usr/bin/env node
/**
 * Debt-marker ceiling. Fails if the number of TODO/FIXME/HACK/XXX markers in
 * src (excluding tests) exceeds MAX. Ratchet MAX down as debt is paid off;
 * never raise it without a deliberate decision.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const MAX = 3
const MARKER = /\b(TODO|FIXME|HACK|XXX)\b/

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (
      (entry.endsWith('.ts') || entry.endsWith('.tsx')) &&
      !entry.includes('.test.')
    )
      out.push(full)
  }
  return out
}

const hits = []
for (const file of walk(SRC)) {
  const lines = readFileSync(file, 'utf8').split('\n')
  lines.forEach((line, i) => {
    if (MARKER.test(line)) hits.push(`${relative(ROOT, file)}:${i + 1}`)
  })
}

if (hits.length > MAX) {
  console.error(`✗ ${hits.length} debt markers (max ${MAX}):`)
  for (const h of hits) console.error(`  ${h}`)
  console.error(
    '\nResolve the marker, or lower it deliberately and adjust MAX.',
  )
  process.exit(1)
}
console.log(`Debt-marker check OK (${hits.length}/${MAX}).`)
