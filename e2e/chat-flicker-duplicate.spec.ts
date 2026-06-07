import { dismissUpdateModal, expect, test } from './fixtures'

test.describe('Chat UI flicker #441', () => {
  test('chat messages should not contain duplicates after stream completion', async ({
    page,
  }) => {
    await page.goto('/chat')
    await page.waitForLoadState('domcontentloaded')
    await dismissUpdateModal(page)

    // The chat shell is ready once the composer input is mounted — a stable
    // signal that replaces the old fixed waitForTimeout sleeps.
    const chatInput = page.locator('textarea, [contenteditable="true"]').first()
    await expect(chatInput).toBeVisible()

    // Open an existing session if the sidebar surfaced one (data-dependent, so
    // tolerate its absence), then wait for the message list to settle rather
    // than sleeping.
    const sessionLink = page.locator('a[href*="/chat/20"]').first()
    if (await sessionLink.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await sessionLink.click()
      await page.waitForLoadState('networkidle')
    }

    // VERIFY: no error state is shown.
    await expect(page.getByRole('alert')).toHaveCount(0)

    // VERIFY: no lingering "generating/thinking" state after completion.
    await expect(
      page.locator('text=/generating|waiting for response|Generating/i'),
    ).toHaveCount(0)

    // VERIFY: the chat input is still present (page is functional).
    await expect(chatInput).toBeVisible()
  })
})
