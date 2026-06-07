import { dismissUpdateModal, expect, test } from './fixtures'

test.describe('Chat thinking state #449', () => {
  test('should not show stale thinking state after page refresh for completed session', async ({
    page,
  }) => {
    // Reproduces #449: a completed session whose stream cleared the waiting
    // state shows a brief stale "thinking" indicator after refresh. The seeded
    // active-run check (see fixtures.ts → "no active run") must clear it.
    const SESSION_KEY = '20260515_150106_4be3a000'
    const SESSION_PATH = `/chat/${SESSION_KEY}`

    // Inject a stale waiting entry for THIS session before the page loads.
    await page.addInitScript((sessionKey) => {
      window.sessionStorage.setItem(
        `claude_waiting_${sessionKey}`,
        JSON.stringify({
          since: Date.now() - 30_000, // 30s ago — within the 120s TTL
          runId: 'stale-run-id',
        }),
      )
    }, SESSION_KEY)

    await page.goto(SESSION_PATH)
    await page.waitForLoadState('domcontentloaded')
    await dismissUpdateModal(page)

    // State-based wait: the fix clears the stale sessionStorage entry once the
    // active-run check resolves. Poll for that condition instead of sleeping.
    await expect
      .poll(
        () =>
          page.evaluate(
            (key) =>
              window.sessionStorage.getItem(`claude_waiting_${key}`) === null,
            SESSION_KEY,
          ),
        { timeout: 15_000 },
      )
      .toBe(true)

    // And no thinking indicator is visible after refresh.
    const thinkingIndicator = page.locator(
      '[data-testid="thinking-indicator"], [aria-label="Assistant thinking"], .thinking-indicator, [data-thinking="true"]',
    )
    await expect(thinkingIndicator).toHaveCount(0)
  })
})
