import { test as base, type Page } from '@playwright/test'

/**
 * Stub the backend gateway calls the e2e specs depend on, so the suite is
 * deterministic without a live hermes-agent. The SSR app still renders; only
 * the data-bearing endpoints the assertions hinge on are seeded here.
 *
 * Extend this as specs grow — keep stubs minimal and shaped like the real API.
 */
export async function seedBackend(page: Page): Promise<void> {
  // The active-run check is what clears a stale "thinking/waiting" entry on
  // reload (issue #449). Seed it as "no active run" so the check resolves
  // deterministically instead of depending on a live session.
  await page.route('**/api/sessions/*/active-run**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, active: false, run: null }),
    }),
  )
}

/** Dismiss the "Hermes updated" modal if it appears. */
export async function dismissUpdateModal(page: Page): Promise<void> {
  const continueBtn = page.getByRole('button', { name: 'Continue' })
  if (await continueBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await continueBtn.click()
  }
}

/**
 * `test` with the backend auto-seeded before each spec. Import this instead of
 * the bare `@playwright/test` `test` in specs that touch backend data.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    await seedBackend(page)
    await use(page)
  },
})

export { expect } from '@playwright/test'
