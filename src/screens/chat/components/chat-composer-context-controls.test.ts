import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = () =>
  readFileSync(
    resolve(process.cwd(), 'src/screens/chat/components/chat-composer.tsx'),
    'utf8',
  )

describe('ChatComposer context controls', () => {
  it('wires profile selection through the existing profile APIs', () => {
    const src = source()

    expect(src).toContain("fetch('/api/profiles/list')")
    expect(src).toContain("fetch('/api/profiles/activate'")
    expect(src).toContain('Activated profile')
  })

  it('surfaces workspace context and reasoning controls next to the model picker', () => {
    const src = source()

    // Workspace context is fetched and derived in the composer.
    // NOTE: the inline workspace *picker menu* was refactored out; the orphaned
    // `workspaceSelectMutation` / `workspaceButtonLabel` / `isWorkspaceMenuOpen`
    // scaffolding is tracked for removal (cruft cleanup). Assert the live wiring.
    expect(src).toContain("fetch('/api/workspace')")
    expect(src).toContain('workspaceContextQuery')
    expect(src).toContain('workspaceEntries')
    expect(src).toContain('SEARCH_MODAL_EVENTS.TOGGLE_FILE_EXPLORER')
    // Reasoning-effort control (live).
    expect(src).toContain('Reasoning effort')
    expect(src).toContain("['medium', 'Medium']")
    expect(src).toContain("['high', 'High']")
  })
})
