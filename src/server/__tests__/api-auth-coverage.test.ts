import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Deny-by-default auth coverage.
 *
 * Every `/api` server route MUST either enforce authentication (reference one
 * of the shared auth primitives below) or be explicitly listed as public.
 * A new route that does neither fails this test — so the default for any new
 * endpoint is "denied unless authenticated", enforced in CI rather than by
 * per-handler convention.
 *
 * To add a genuinely public endpoint, add it to PUBLIC_API_ROUTES with a
 * one-line justification. To protect a route, call `requireAuth(request)`
 * (or isAuthenticated / requireLocalOrAuth) at the top of each handler.
 */

const API_DIR = join(process.cwd(), 'src', 'routes', 'api')

// Tokens whose presence indicates a route enforces auth. `handleHermesConfig`
// delegates to a shared handler that calls authorize()/isAuthenticated.
const GUARD_TOKENS = [
  'isAuthenticated',
  'requireLocalOrAuth',
  'requireAuth',
  'protectedHandlers',
  'handleHermesConfig',
]

// Intentionally-public routes (no session required), each with a reason.
// Paths are relative to src/routes/api, POSIX separators.
const PUBLIC_API_ROUTES = new Set<string>([
  'auth.ts', // login endpoint — establishes the session
  'oauth.device-code.ts', // OAuth device flow — pre-auth
  'oauth.poll-token.ts', // OAuth device flow — pre-auth
  'playground-npc.ts', // public play surface — players have no workspace session
  'hermesworld/reservations.ts', // public world early-access reservation
  'hermesworld/reservations/confirm.ts', // public world reservation confirm
])

function walk(dir: string): Array<string> {
  const out: Array<string> = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      out.push(...walk(full))
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      out.push(full)
    }
  }
  return out
}

function routeFiles(): Array<string> {
  return walk(API_DIR).filter((file) => {
    if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) return false
    const src = readFileSync(file, 'utf8')
    // Only files that actually declare an /api server route.
    return (
      src.includes("createFileRoute('/api") ||
      src.includes('createFileRoute("/api')
    )
  })
}

describe('API auth coverage (deny-by-default)', () => {
  it('every /api route is guarded or explicitly public', () => {
    const unprotected: Array<string> = []
    for (const file of routeFiles()) {
      const rel = relative(API_DIR, file).split('\\').join('/')
      if (PUBLIC_API_ROUTES.has(rel)) continue
      const src = readFileSync(file, 'utf8')
      if (!GUARD_TOKENS.some((token) => src.includes(token))) {
        unprotected.push(rel)
      }
    }

    expect(
      unprotected,
      `These /api routes neither enforce auth nor are listed in PUBLIC_API_ROUTES:\n` +
        unprotected.map((r) => `  - ${r}`).join('\n') +
        `\nAdd requireAuth(request) to each handler, or add the route to ` +
        `PUBLIC_API_ROUTES with a justification.`,
    ).toEqual([])
  })

  it('every public route in the allowlist still exists', () => {
    const missing: Array<string> = []
    for (const rel of PUBLIC_API_ROUTES) {
      try {
        statSync(join(API_DIR, rel))
      } catch {
        missing.push(rel)
      }
    }
    expect(
      missing,
      `Stale PUBLIC_API_ROUTES entries: ${missing.join(', ')}`,
    ).toEqual([])
  })
})
