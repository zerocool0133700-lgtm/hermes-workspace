import type { Page } from '@playwright/test'
import { dismissUpdateModal, expect, test } from './fixtures'

test.describe('Conductor mobile rendering', () => {
  test.use({
    viewport: { width: 375, height: 667 }, // iPhone SE
  })

  // State-based readiness: the conductor shell is up once <main> is visible.
  // Replaces the fixed waitForTimeout sleeps the spec used to rely on.
  async function gotoConductor(page: Page) {
    await page.goto('/conductor')
    await page.waitForLoadState('domcontentloaded')
    await dismissUpdateModal(page)
    await expect(page.locator('main').first()).toBeVisible()
  }

  test('conductor home page renders without clipping on mobile', async ({
    page,
  }) => {
    await gotoConductor(page)

    await expect(page.locator('body')).toContainText('Conductor')

    // Page is scrollable — bottom content is reachable.
    const { scrollHeight, clientHeight } = await page.evaluate(() => ({
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
    }))
    expect(scrollHeight).toBeGreaterThanOrEqual(clientHeight)

    await page.evaluate(() =>
      window.scrollTo(0, document.documentElement.scrollHeight),
    )

    // body bottom is within the document (not clipped off-screen).
    const bottom = await page.evaluate(
      () => document.body.getBoundingClientRect().bottom,
    )
    expect(bottom).toBeGreaterThan(0)
  })

  test('conductor page has no horizontal overflow on mobile', async ({
    page,
  }) => {
    await gotoConductor(page)

    const hasHorizontalOverflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    )
    expect(hasHorizontalOverflow).toBe(false)
  })

  test('conductor action buttons are present on mobile', async ({ page }) => {
    await gotoConductor(page)
    await expect(page.locator('button').first()).toBeVisible()
  })

  test('conductor main container has proper bottom padding on mobile', async ({
    page,
  }) => {
    await gotoConductor(page)

    const bottomPadding = await page.evaluate(() => {
      const mains = document.querySelectorAll('main')
      const last = mains[mains.length - 1]
      if (!last) return -1
      return parseInt(window.getComputedStyle(last).paddingBottom, 10) || 0
    })
    // Bottom padding must exist so content isn't flush with the mobile tab bar.
    expect(bottomPadding).toBeGreaterThanOrEqual(4)
  })

  test('conductor page body fills viewport height without clipping at bottom', async ({
    page,
  }) => {
    await gotoConductor(page)

    const { bodyHeight, vpHeight } = await page.evaluate(() => ({
      bodyHeight: document.body.scrollHeight,
      vpHeight: window.innerHeight,
    }))
    expect(bodyHeight).toBeGreaterThanOrEqual(vpHeight * 0.5)

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))

    const lastElBottom = await page.evaluate(() => {
      const all = document.querySelectorAll('main > div, main > section')
      const last = all[all.length - 1]
      if (!last) return -1
      return last.getBoundingClientRect().bottom
    })
    expect(lastElBottom).toBeGreaterThan(0)
  })
})
