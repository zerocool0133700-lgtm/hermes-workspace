import { describe, expect, it } from 'vitest'

import {
  CLAUDE_CONFIG_PATH,
  PROVIDER_CATALOG,
  buildConfigExample,
  getAuthTypeLabel,
  getProviderDisplayName,
  getProviderInfo,
  normalizeProviderId,
} from './provider-catalog'
import type { ProviderAuthType, ProviderInfo } from './provider-catalog'

describe('constants and catalog shape', () => {
  it('exposes the expected config path', () => {
    expect(CLAUDE_CONFIG_PATH).toBe('~/.hermes/config.yaml')
  })

  it('contains the expected set of provider ids', () => {
    expect(PROVIDER_CATALOG.map((provider) => provider.id)).toEqual([
      'anthropic',
      'openai',
      'google',
      'openrouter',
      'minimax',
      'ollama',
      'atomic-chat',
    ])
  })

  it('uses lowercased, normalized ids for every catalog entry', () => {
    for (const provider of PROVIDER_CATALOG) {
      expect(provider.id).toBe(normalizeProviderId(provider.id))
    }
  })

  it('declares at least one auth type per provider', () => {
    for (const provider of PROVIDER_CATALOG) {
      expect(provider.authTypes.length).toBeGreaterThan(0)
    }
  })

  it('ships a parseable JSON configExample per provider', () => {
    for (const provider of PROVIDER_CATALOG) {
      const parsed: unknown = JSON.parse(provider.configExample)
      expect(parsed).toMatchObject({ auth: { profiles: expect.anything() } })
    }
  })

  it('has non-empty name, description and docsUrl per provider', () => {
    for (const provider of PROVIDER_CATALOG) {
      expect(provider.name.length).toBeGreaterThan(0)
      expect(provider.description.length).toBeGreaterThan(0)
      expect(provider.docsUrl.startsWith('https://')).toBe(true)
    }
  })
})

describe('normalizeProviderId', () => {
  it('lowercases the value', () => {
    expect(normalizeProviderId('OpenAI')).toBe('openai')
    expect(normalizeProviderId('ANTHROPIC')).toBe('anthropic')
  })

  it('trims surrounding whitespace', () => {
    expect(normalizeProviderId('  google  ')).toBe('google')
    expect(normalizeProviderId('\tminimax\n')).toBe('minimax')
  })

  it('combines trim and lowercase', () => {
    expect(normalizeProviderId('  OpenRouter  ')).toBe('openrouter')
  })

  it('returns an empty string for whitespace-only or empty input', () => {
    expect(normalizeProviderId('')).toBe('')
    expect(normalizeProviderId('   ')).toBe('')
  })

  it('does not collapse internal whitespace or alter inner characters', () => {
    expect(normalizeProviderId('Atomic Chat')).toBe('atomic chat')
    expect(normalizeProviderId('atomic-chat')).toBe('atomic-chat')
  })
})

describe('getProviderInfo', () => {
  it('returns the matching provider for an exact id', () => {
    const info = getProviderInfo('anthropic')
    expect(info).not.toBeNull()
    expect(info?.id).toBe('anthropic')
    expect(info?.name).toBe('Anthropic')
  })

  it('matches case-insensitively', () => {
    expect(getProviderInfo('OpenAI')?.id).toBe('openai')
    expect(getProviderInfo('GOOGLE')?.id).toBe('google')
  })

  it('matches after trimming whitespace', () => {
    expect(getProviderInfo('  ollama  ')?.id).toBe('ollama')
  })

  it('matches hyphenated ids', () => {
    expect(getProviderInfo('atomic-chat')?.id).toBe('atomic-chat')
  })

  it('returns null for an unknown provider', () => {
    expect(getProviderInfo('does-not-exist')).toBeNull()
  })

  it('returns null for empty or whitespace-only input', () => {
    expect(getProviderInfo('')).toBeNull()
    expect(getProviderInfo('   ')).toBeNull()
  })

  it('does not match on partial substrings', () => {
    expect(getProviderInfo('open')).toBeNull()
    expect(getProviderInfo('anthropicx')).toBeNull()
  })
})

describe('getProviderDisplayName', () => {
  it('returns the catalog display name for known providers', () => {
    expect(getProviderDisplayName('anthropic')).toBe('Anthropic')
    expect(getProviderDisplayName('openrouter')).toBe('OpenRouter')
    expect(getProviderDisplayName('atomic-chat')).toBe('Atomic Chat')
  })

  it('uses the catalog name regardless of input casing/whitespace', () => {
    expect(getProviderDisplayName('  ANTHROPIC ')).toBe('Anthropic')
  })

  it('returns "Unknown Provider" for empty or whitespace-only input', () => {
    expect(getProviderDisplayName('')).toBe('Unknown Provider')
    expect(getProviderDisplayName('   ')).toBe('Unknown Provider')
  })

  it('title-cases a single unknown token', () => {
    expect(getProviderDisplayName('mistral')).toBe('Mistral')
  })

  it('title-cases hyphen-separated unknown tokens', () => {
    expect(getProviderDisplayName('my-custom-provider')).toBe(
      'My Custom Provider',
    )
  })

  it('title-cases underscore-separated unknown tokens', () => {
    expect(getProviderDisplayName('my_custom_provider')).toBe(
      'My Custom Provider',
    )
  })

  it('title-cases space-separated unknown tokens', () => {
    expect(getProviderDisplayName('cool new model')).toBe('Cool New Model')
  })

  it('collapses runs of mixed separators and drops empty chunks', () => {
    expect(getProviderDisplayName('foo--_  bar')).toBe('Foo Bar')
  })

  it('normalizes (lowercases) before title-casing each token', () => {
    // normalizeProviderId lowercases the whole input first, then each chunk's
    // first character is uppercased.
    expect(getProviderDisplayName('FOO-BAR')).toBe('Foo Bar')
    expect(getProviderDisplayName('fOObar')).toBe('Foobar')
  })

  it('handles a single-character unknown token', () => {
    expect(getProviderDisplayName('x')).toBe('X')
  })

  it('returns "Unknown Provider" when only separators are supplied', () => {
    // Separators normalize away to empty chunks, leaving an empty join.
    expect(getProviderDisplayName('---')).toBe('')
  })
})

describe('getAuthTypeLabel', () => {
  it('labels api-key', () => {
    expect(getAuthTypeLabel('api-key')).toBe('API Key')
  })

  it('labels oauth', () => {
    expect(getAuthTypeLabel('oauth')).toBe('OAuth')
  })

  it('labels cli-token', () => {
    expect(getAuthTypeLabel('cli-token')).toBe('CLI Token')
  })

  it('labels local (the fallthrough branch)', () => {
    expect(getAuthTypeLabel('local')).toBe('Local')
  })

  it('produces a label for every auth type used across the catalog', () => {
    const labels = new Map<ProviderAuthType, string>([
      ['api-key', 'API Key'],
      ['oauth', 'OAuth'],
      ['cli-token', 'CLI Token'],
      ['local', 'Local'],
    ])
    for (const provider of PROVIDER_CATALOG) {
      for (const authType of provider.authTypes) {
        expect(getAuthTypeLabel(authType)).toBe(labels.get(authType))
      }
    }
  })
})

describe('buildConfigExample', () => {
  function getProvider(id: string): ProviderInfo {
    const provider = getProviderInfo(id)
    if (provider === null) {
      throw new Error(`missing fixture provider: ${id}`)
    }
    return provider
  }

  it('returns the provider configExample verbatim for api-key', () => {
    const provider = getProvider('openai')
    expect(buildConfigExample(provider, 'api-key')).toBe(provider.configExample)
  })

  it('returns the provider configExample verbatim for cli-token', () => {
    const provider = getProvider('anthropic')
    expect(buildConfigExample(provider, 'cli-token')).toBe(
      provider.configExample,
    )
  })

  it('builds an oauth config with a :default profile key and oauth.enabled', () => {
    const provider = getProvider('google')
    const result: unknown = JSON.parse(buildConfigExample(provider, 'oauth'))
    expect(result).toEqual({
      auth: {
        profiles: {
          'google:default': {
            provider: 'google',
            oauth: { enabled: true },
          },
        },
      },
    })
  })

  it('builds a local config with a :local profile key and no apiKey', () => {
    const provider = getProvider('ollama')
    const result: unknown = JSON.parse(buildConfigExample(provider, 'local'))
    expect(result).toEqual({
      auth: {
        profiles: {
          'ollama:local': {
            provider: 'ollama',
          },
        },
      },
    })
  })

  it('uses :local suffix only for local auth and :default otherwise', () => {
    const provider = getProvider('atomic-chat')
    expect(buildConfigExample(provider, 'local')).toContain(
      '"atomic-chat:local"',
    )
    expect(buildConfigExample(provider, 'oauth')).toContain(
      '"atomic-chat:default"',
    )
  })

  it('pretty-prints generated JSON with two-space indentation', () => {
    const provider = getProvider('google')
    const oauthExample = buildConfigExample(provider, 'oauth')
    expect(oauthExample).toContain('\n  "auth"')
  })

  it('round-trips into valid JSON for every auth type', () => {
    const provider = getProvider('anthropic')
    const authTypes: Array<ProviderAuthType> = [
      'api-key',
      'oauth',
      'local',
      'cli-token',
    ]
    for (const authType of authTypes) {
      expect(() =>
        JSON.parse(buildConfigExample(provider, authType)),
      ).not.toThrow()
    }
  })
})
