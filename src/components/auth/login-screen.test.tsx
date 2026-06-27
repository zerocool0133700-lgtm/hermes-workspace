// @vitest-environment jsdom
import React from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LoginScreen } from './login-screen'

const reactActGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean
}
reactActGlobal.IS_REACT_ACT_ENVIRONMENT = true

async function renderLoginScreen(props: { idpEnabled?: boolean }) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await React.act(() => {
    root.render(<LoginScreen {...props} />)
  })
  return {
    container,
    unmount: async () => {
      await React.act(() => root.unmount())
      document.body.removeChild(container)
    },
  }
}

describe('LoginScreen', () => {
  it('renders "Sign in with Ellie" button when idpEnabled is true', async () => {
    const { container, unmount } = await renderLoginScreen({ idpEnabled: true })
    const buttons = Array.from(container.querySelectorAll('button'))
    const idpButton = buttons.find((b) => b.textContent?.trim() === 'Sign in with Ellie')
    expect(idpButton).not.toBeUndefined()
    const passwordInput = container.querySelector('input[type="password"]')
    expect(passwordInput).toBeNull()
    await unmount()
  })

  it('renders password form when idpEnabled is false', async () => {
    const { container, unmount } = await renderLoginScreen({ idpEnabled: false })
    const passwordInput = container.querySelector('input[type="password"]')
    expect(passwordInput).not.toBeNull()
    const buttons = Array.from(container.querySelectorAll('button'))
    const idpButton = buttons.find((b) => b.textContent?.trim() === 'Sign in with Ellie')
    expect(idpButton).toBeUndefined()
    await unmount()
  })

  it('renders password form when idpEnabled is omitted', async () => {
    const { container, unmount } = await renderLoginScreen({})
    const passwordInput = container.querySelector('input[type="password"]')
    expect(passwordInput).not.toBeNull()
    await unmount()
  })
})
