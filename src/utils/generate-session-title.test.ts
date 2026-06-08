import { describe, expect, it } from 'vitest'

import { generateSessionTitle } from './generate-session-title'
import type { SessionTitleSnippet } from './generate-session-title'

/**
 * `generate-session-title` is a fully deterministic heuristic title generator.
 * It performs no network / LLM calls, so every branch is exercised directly
 * with crafted snippets. The expected strings below were captured from the
 * real implementation and pin its observable behaviour.
 */

function user(text: string): SessionTitleSnippet[number] {
  return { role: 'user', text }
}

function assistant(text: string): SessionTitleSnippet[number] {
  return { role: 'assistant', text }
}

describe('generateSessionTitle', () => {
  describe('typical prompts', () => {
    it('prefixes a detected action verb and capitalised subject tokens', () => {
      const title = generateSessionTitle([
        user('Please fix the bug in my React component'),
      ])

      // 'fix'/'bug' both match the Fix action pattern (one from primary tokens,
      // one as a deduped context token), then the subject tokens follow.
      expect(title).toBe('Fix Fix Bug React Component')
    })

    it('detects a build action for implementation requests', () => {
      const title = generateSessionTitle([
        user('I want to optimize the performance of my database query'),
      ])

      expect(title).toBe('Optimize Optimize Performance Database')
    })

    it('falls back to the assistant message when there is no user text', () => {
      const title = generateSessionTitle([
        assistant('I will help you debug the typescript error'),
      ])

      expect(title).toBe('Fix Help Debug TypeScript Error')
    })

    it('uses the first user message even when an assistant precedes it', () => {
      const title = generateSessionTitle([
        assistant('assistant goes first here'),
        user('optimize performance metrics'),
      ])

      expect(title).toBe('Optimize Optimize Performance Metrics')
    })
  })

  describe('empty / whitespace / missing input', () => {
    it('returns the chat fallback for an empty user message', () => {
      expect(generateSessionTitle([user('')])).toBe('Discuss Chat')
    })

    it('returns the chat fallback for whitespace-only text', () => {
      expect(generateSessionTitle([user('   \n\t  ')])).toBe('Discuss Chat')
    })

    it('returns the chat fallback for an empty snippet', () => {
      expect(generateSessionTitle([])).toBe('Discuss Chat')
    })

    it('returns the chat fallback when every word is a stop word', () => {
      expect(
        generateSessionTitle([user('i need to do this with the and or but')]),
      ).toBe('Discuss Chat')
    })

    it('returns the chat fallback when only numeric tokens remain', () => {
      expect(generateSessionTitle([user('123 4567 89')])).toBe('Discuss Chat')
    })

    it('returns the chat fallback when only punctuation is present', () => {
      expect(generateSessionTitle([user('!!! @@@ ### $$$ %%%')])).toBe(
        'Discuss Chat',
      )
    })
  })

  describe('category detection', () => {
    it('detects the coding category by default action when no verb matches', () => {
      // 'code' is a coding keyword but matches no ACTION_PATTERN, so the
      // category default action ('Fix') is used.
      const title = generateSessionTitle([user('a an code')])
      expect(title).toBe('Fix Code')
    })

    it('detects the config category and its default action', () => {
      const title = generateSessionTitle([
        assistant('docker config deploy pipeline ci'),
      ])
      expect(title.startsWith('Configure ')).toBe(true)
    })

    it('detects the creative category', () => {
      const title = generateSessionTitle([
        user('brainstorm some names for my story poem'),
      ])
      expect(title).toBe('Draft Brainstorm Names Story Poem')
    })

    it('detects the analysis category', () => {
      const title = generateSessionTitle([
        user('analyze the tradeoff between these metrics and data'),
      ])
      expect(title).toBe('Analyze Analyze Tradeoff Between')
    })

    it('breaks category ties in priority order (coding before research)', () => {
      // 'code' (coding) and 'research' (research) each score 1; coding is
      // evaluated first and the comparison is strictly greater-than, so the
      // earlier category wins the tie. The action verb still comes from the
      // matched pattern ('research' -> Research).
      const title = generateSessionTitle([user('code research')])
      expect(title).toBe('Research Code Research')
    })

    it('treats messages with unknown roles for category but not candidates', () => {
      // A non user/assistant role contributes to detectCategory (which maps all
      // messages) but primaryCandidate/scoreContextTokens ignore it, so the
      // title degrades to the category subject fallback.
      const title = generateSessionTitle([
        { role: 'system', text: 'hello configure docker deploy pipeline' },
      ])
      expect(title).toBe('Configure Setup')
    })
  })

  describe('noise-prefix stripping', () => {
    it('strips conversational lead-ins before tokenising', () => {
      const title = generateSessionTitle([
        user('Hey, can you help me write a test for the api function'),
      ])
      expect(title).toBe('Build Write Test API Function')
    })
  })

  describe('markdown, code, and url cleaning', () => {
    it('removes fenced code blocks before deriving the title', () => {
      const title = generateSessionTitle([
        user('```js\nconst x = 1\n```\nexplain this code'),
      ])
      expect(title).toBe('Explain Explain Code')
    })

    it('removes inline code spans', () => {
      const title = generateSessionTitle([
        user('what does `useEffect` do in react'),
      ])
      expect(title).toBe('Fix What React')
    })

    it('keeps the link text but drops the url for markdown links', () => {
      const title = generateSessionTitle([
        user('check out [the docs](https://example.com) for research'),
      ])
      expect(title).toBe('Research Check Out Docs Research')
    })

    it('strips bare urls', () => {
      const title = generateSessionTitle([
        user('summarize https://example.com/article please'),
      ])
      expect(title).toBe('Summarize Summarize')
    })

    it('collapses multi-line input into a single derived title', () => {
      const title = generateSessionTitle([
        user('first line\nsecond line about react\nthird config docker'),
      ])
      expect(title).toBe('Configure First Line Second About React')
    })
  })

  describe('token formatting', () => {
    it('upper-cases known acronym tokens', () => {
      const title = generateSessionTitle([
        user('configure the API and SQL and JSON settings'),
      ])
      expect(title).toBe('Configure Configure API SQL JSON')
    })

    it('applies brand-name overrides', () => {
      const title = generateSessionTitle([
        user('help with typescript and javascript and nextjs and tailwind'),
      ])
      expect(title).toBe('Fix Help TypeScript JavaScript Next.js')
    })

    it('strips hyphens when normalising tokens', () => {
      const title = generateSessionTitle([
        user('fix the trade-off in look-up logic'),
      ])
      expect(title).toBe('Fix Fix Tradeoff Lookup Logic')
    })

    it('capitalises non-special tokens for the chat fallback subjects', () => {
      const title = generateSessionTitle([user('qq zz xx')])
      expect(title).toBe('Discuss Qq Zz Xx')
    })
  })

  describe('token de-duplication', () => {
    it('does not repeat the same subject token from primary and context', () => {
      const title = generateSessionTitle([user('react react react component')])
      expect(title).toBe('Fix React Component')
    })
  })

  describe('maxWords option', () => {
    it('limits the total number of words including the action verb', () => {
      const title = generateSessionTitle(
        [
          user(
            'build a react app with typescript and tailwind and css and html and json',
          ),
        ],
        { maxWords: 3 },
      )
      expect(title).toBe('Build Build React')
    })

    it('keeps only the action verb when maxWords is 1', () => {
      const title = generateSessionTitle(
        [user('build a react app with typescript')],
        { maxWords: 1 },
      )
      expect(title).toBe('Build')
    })

    it('yields an empty title when maxWords is 0', () => {
      // maxFocusTokens clamps to 1 so a subject is selected, but the final
      // coreTokens.slice(0, 0) removes everything.
      const title = generateSessionTitle(
        [user('build a react app with typescript')],
        { maxWords: 0 },
      )
      expect(title).toBe('')
    })
  })

  describe('maxLength option', () => {
    it('truncates at the last word boundary within the limit', () => {
      const title = generateSessionTitle(
        [user('implement comprehensive authentication systems globally')],
        { maxLength: 20 },
      )
      expect(title).toBe('Build Implement')
      expect(title.length).toBeLessThanOrEqual(20)
    })

    it('hard-clips when there is no space within the limit', () => {
      const title = generateSessionTitle(
        [user('Authenticationsystemverylongword')],
        { maxLength: 5 },
      )
      expect(title).toBe('Discu')
    })

    it('respects the default 40 character ceiling', () => {
      const title = generateSessionTitle([
        assistant('docker config deploy pipeline ci'),
      ])
      expect(title.length).toBeLessThanOrEqual(40)
      expect(title).toBe('Configure Docker Config Deploy Pipeline')
    })
  })

  describe('subject fallback', () => {
    it('uses the chat subject fallback when no meaningful tokens survive', () => {
      // Category resolves to chat and there are no focus tokens, so the
      // CATEGORY_SUBJECT_FALLBACK ('Chat', normalised) is used.
      expect(generateSessionTitle([user('the a an it is')])).toBe(
        'Discuss Chat',
      )
    })
  })

  describe('determinism', () => {
    it('produces identical output across repeated calls', () => {
      const snippet: SessionTitleSnippet = [
        user('Please fix the bug in my React component'),
        assistant('Sure, let me look at the typescript error'),
      ]
      const first = generateSessionTitle(snippet)
      const second = generateSessionTitle(snippet)
      expect(second).toBe(first)
    })
  })
})
